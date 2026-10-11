import { join } from 'node:path';
import { canonicalUrl } from './util.js';
import { resolvePageDialogs } from './page-dialogs.js';
import { acquireBrowserWindow } from './persistent-browser.js';
import { waitForPageReady } from './page-readiness.js';
import { scrollProductContent } from './page-scroll.js';
import { storeViewport } from './page-capture.js';
import { selectVariantOptions } from './browser-variant.js';
import {
  serveBrowserImage,
  retainBrowserImage,
} from './browser-image-cache.js';
import {
  requestedSku,
  preferredVariant,
  cachedVariantMatches,
  VARIANT_POLICY_VERSION,
} from './variant-policy.js';
import {
  inspectPageChallenge,
  assertPageNotChallenged,
  assertCollectionRunning,
  stopForChallenge,
  COLLECTION_STOP_ID,
  registerChallengeStore,
  CollectionStoppedError,
} from './page-challenge.js';

export const EXTRACTOR_VERSION = 16;

async function boundedImageBody(response, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([
      response.body(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Runs in the browser realm. Preserve all labels, descriptions, JSON-LD,
// images and variant options, including fields the normalizer cannot parse.
// eslint-disable-next-line max-lines-per-function -- This self-contained function is serialized into the browser realm; imported helpers are unavailable there.
export function extractPage(context) {
  const document = context?.document || globalThis.document;
  const pageUrl = context?.url || globalThis.location.href;
  const absolute = (value) => {
    try {
      return value ? new URL(value, pageUrl).href : undefined;
    } catch {
      return undefined;
    }
  };
  const text = (selector) => {
    const element = document.querySelector(selector);
    return (element?.innerText || element?.textContent)?.trim();
  };
  const jsonLd = [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].map((script) => {
    try {
      return JSON.parse(script.textContent);
    } catch {
      return { parseError: true, raw: script.textContent };
    }
  });
  const anchors = [...document.querySelectorAll('a[href]')];
  const images = [...document.querySelectorAll('img')]
    .flatMap((image) => [
      image.currentSrc,
      image.src,
      image.getAttribute('data-src'),
    ])
    .map(absolute)
    .filter((url) => url && /^https?:/u.test(url));
  const productImages = [
    ...document.querySelectorAll(
      '[itemprop="associatedMedia"] img, .gallery-preview-panel img, .item-gallery img, .gallery-preview-panel-v2 img, .item-gallery-v2 img, .pdp-product-desc img, .pdp-product-desc-v2 img, .product__media img, .product-single__media img, .product-information__media img, .product-images img, .product-thumb img, .product-gallery img, .product-description img, .product-description-wrapper img, #product-description img, .product__description img, .product-tabs-section img, .nutritional-info-image img, .nutrition-facts-image img, .nut-facts img, .rte img, .woocommerce-product-gallery img, img.wp-post-image, img.product-gallery-grid__image, img.product__media-item--variant, img.product__media-image, img.ps-spf-images__image, img[alt*="nutrition facts" i], img[alt*="supplement facts" i], [data-product-image]'
    ),
  ]
    .flatMap((image) => {
      const fullSize =
        image.parentElement?.getAttribute('data-zoom-image') ||
        image.parentElement?.getAttribute('data-image');
      return fullSize
        ? [fullSize]
        : [
            image.currentSrc,
            image.src,
            image.getAttribute('data-src'),
            ...[
              image.getAttribute('srcset'),
              image.getAttribute('data-srcset'),
            ].flatMap((value) =>
              (value || '')
                .split(',')
                .map((choice) => choice.trim().split(/\s+/u)[0])
            ),
          ];
    })
    .map(absolute)
    .filter((url) => url && /^https?:/u.test(url));
  const preferredImages = new Map();
  const variantGallery = {};
  for (const script of document.querySelectorAll(
    'script[type="application/json"][id^="VariantGalleryJSON-"]'
  )) {
    try {
      Object.assign(variantGallery, JSON.parse(script.textContent));
    } catch {
      /* Malformed media JSON cannot establish an image or variant. */
    }
  }
  const manufacturerVariants = [];
  for (const script of document.querySelectorAll(
    'script[type="application/json"].linked-product-selector__variants'
  )) {
    try {
      const choices = JSON.parse(script.textContent);
      if (!Array.isArray(choices)) {
        continue;
      }
      for (const choice of choices) {
        const gallery = (variantGallery[choice.id] || [])
          .map((media) => {
            const source = Object.entries(media.sources || {}).sort(
              (a, b) => Number(b[0]) - Number(a[0])
            )[0]?.[1];
            return absolute(source || media.fallback);
          })
          .filter((url) => url && /^https?:/u.test(url));
        const front = absolute(choice.featured_image?.src);
        const images = [...new Set([...gallery, front].filter(Boolean))];
        manufacturerVariants.push({
          id: String(choice.id),
          name: choice.name,
          manufacturerSku: choice.sku,
          gtin: choice.barcode,
          options: choice.options,
          available: choice.available,
          images,
        });
        productImages.push(...images);
      }
    } catch {
      /* Preserve other readable variants when metadata is malformed. */
    }
  }
  const manufacturerLabels = [
    ...document.querySelectorAll('.nut-facts option[data-file]'),
  ]
    .map((option) => ({
      url: absolute(option.getAttribute('data-file')),
      flavour: option.getAttribute('data-flavor') || option.textContent.trim(),
    }))
    .filter((label) => label.url && /^https?:/u.test(label.url));
  productImages.push(...manufacturerLabels.map((label) => label.url));
  // WooCommerce publishes the images for unselected product variants in its
  // form attribute. Keep those exact URLs as evidence for flavour matching.
  for (const form of document.querySelectorAll('[data-product_variations]')) {
    try {
      const choices = JSON.parse(form.getAttribute('data-product_variations'));
      if (!Array.isArray(choices)) {
        continue;
      }
      for (const choice of choices) {
        const url = absolute(choice.image?.full_src || choice.image?.url);
        if (url && /^https?:/u.test(url)) {
          productImages.push(url);
        }
      }
    } catch {
      // Malformed variant metadata does not supply usable image evidence.
    }
  }
  for (const url of productImages) {
    const parsed = new URL(url);
    const resized = /(?:lazcdn\.com|slatic\.net)$/u.test(parsed.hostname)
      ? parsed.pathname.match(/_(\d+)x(\d+)q\d+.*$/u)
      : undefined;
    const shopifyImage = /^\/cdn\/shop\/(?:files|products)\//u.test(
      parsed.pathname
    );
    const shopifyWidth = Number(parsed.searchParams.get('width')) || Infinity;
    if (shopifyImage) {
      parsed.searchParams.delete('width');
      parsed.searchParams.delete('height');
      parsed.searchParams.delete('crop');
    }
    const key = shopifyImage
      ? parsed.href
      : resized
        ? `${parsed.origin}${parsed.pathname.slice(0, resized.index)}`
        : url;
    const area = shopifyImage
      ? shopifyWidth
      : resized
        ? Number(resized[1]) * Number(resized[2])
        : Infinity;
    if (!preferredImages.has(key) || preferredImages.get(key).area < area) {
      preferredImages.set(key, { url, area });
    }
  }
  const cards = [
    ...document.querySelectorAll(
      '[data-qa-locator="product-item"], .Bm3ON, [data-product-card]'
    ),
  ]
    .map((card) => {
      const anchor =
        card.querySelector('a[href*="/products/"]') ||
        card.querySelector('a[href]');
      return {
        url: absolute(anchor?.getAttribute('href')),
        title:
          card
            .querySelector('[data-qa-locator="product-name"], .RfADt')
            ?.textContent?.trim() ||
          anchor?.title ||
          card.innerText,
        rawText: card.innerText,
        priceText: card
          .querySelector('.ooOxS, [data-card-price]')
          ?.textContent?.trim(),
        sku: card.getAttribute('data-sku-simple') || undefined,
      };
    })
    .filter((card) => card.url);
  const variants = [
    ...document.querySelectorAll(
      '.sku-variable-size, .sku-variable-img-wrap, .sku-variable-img-wrap-selected, .sku-variable-name, .sku-variable-name-selected, [data-sku-option]'
    ),
  ].map((element) => ({
    text:
      element.textContent?.trim() ||
      element.getAttribute('title') ||
      element.querySelector('img')?.alt,
    selected:
      /(?:selected|active)/iu.test(element.className) ||
      element.getAttribute('aria-checked') === 'true',
    sku: element.getAttribute('data-sku-id'),
  }));
  const pagination = document.querySelector(
    '.ant-pagination, [data-pagination]'
  );
  const nextButton = pagination?.querySelector(
    '.ant-pagination-next, [data-next-page]'
  );
  const pageNumbers = [
    ...(pagination?.querySelectorAll(
      '.ant-pagination-item, [data-page-number]'
    ) || []),
  ]
    .map((entry) => Number(entry.textContent))
    .filter(Number.isFinite);
  const currentPage =
    Number(
      pagination?.querySelector(
        '.ant-pagination-item-active, [aria-current="page"]'
      )?.textContent
    ) || Number(new URL(pageUrl).searchParams.get('page') || 1);
  const nextDisabled = Boolean(
    nextButton &&
    (nextButton.getAttribute('aria-disabled') === 'true' ||
      /disabled/u.test(nextButton.className) ||
      nextButton.querySelector('[disabled]'))
  );
  // Offline DOM parsers include script text in innerText. Those contents
  // are not product descriptions or visible access challenges.
  const textBody = document.body?.cloneNode(true);
  for (const element of textBody?.querySelectorAll(
    'script, style, template, noscript'
  ) || []) {
    element.remove();
  }
  const bodyText = context?.document
    ? textBody?.textContent || ''
    : document.body?.innerText || textBody?.textContent || '';
  const resultCount = bodyText.match(
    /Tìm thấy\s+([\d.,]+)\s+sản phẩm|([\d.,]+)\s+(?:items|products)\s+found/iu
  );
  let skuCatalog = [];
  let skuCatalogObserved = false;
  for (const script of document.querySelectorAll('script:not([src])')) {
    // Parse the public JSON assignment without evaluating any page JavaScript.
    const match = script.textContent.match(
      /(?:var\s+|window\.)__moduleData__\s*=\s*(\{[^\n]+\});/u
    );
    if (!match) {
      continue;
    }
    try {
      const fields = JSON.parse(match[1]).data?.root?.fields;
      const base = fields?.productOption?.skuBase;
      skuCatalogObserved = Array.isArray(base?.skus);
      skuCatalog = (base?.skus || []).map((sku) => ({
        sku: String(sku.skuId),
        url: absolute(sku.pagePath),
        options: (sku.propPath || '')
          .split(';')
          .filter(Boolean)
          .map((part) => {
            const separator = part.indexOf(':');
            const property = base.properties?.find(
              (entry) => String(entry.pid) === part.slice(0, separator)
            );
            const value = property?.values?.find(
              (entry) => String(entry.vid) === part.slice(separator + 1)
            );
            return {
              name: property?.name || part.slice(0, separator),
              value: value?.name || part.slice(separator + 1),
            };
          }),
        available: fields.skuInfos?.[sku.skuId]?.operation?.disable !== true,
        image: absolute(fields.skuInfos?.[sku.skuId]?.image),
        minQuantity: fields.skuInfos?.[sku.skuId]?.quantity?.limit?.min,
        maxQuantity: fields.skuInfos?.[sku.skuId]?.quantity?.limit?.max,
      }));
    } catch {
      // A malformed assignment is an unresolved SKU inventory, never a reason
      // to infer prices or silently claim that a listing has one variant.
    }
  }
  return {
    url: pageUrl,
    title:
      text('.pdp-mod-product-badge-title, [data-product-title], h1') ||
      document.title,
    priceText: text(
      '.pdp-price_type_normal, .pdp-v2-product-price-content-salePrice-amount, [data-product-price]'
    ),
    originalPriceText: text(
      '.pdp-price_type_deleted, .pdp-v2-product-price-content-originalPrice-amount, [data-original-price]'
    ),
    discountPercentText: text(
      '.pdp-product-price__discount, .pdp-v2-product-price-content-originalPrice-discount, [data-discount-percent]'
    ),
    promotions: [
      ...document.querySelectorAll(
        '[data-product-promotion], .pdp-block__shop_promotion, .pdp-block__redmart-promotion, .pdp-promotion-item, .voucher-item, .coupon-item'
      ),
    ]
      .map((element) => ({
        text: (element.innerText || element.textContent || '').trim(),
      }))
      .filter((entry) => entry.text),
    seller: text(
      '.seller-name__detail, .seller-name-v2__detail-name, [data-seller]'
    ),
    brand: text('.pdp-product-brand__brand-link, [data-brand]'),
    sku: [...document.querySelectorAll('.key-li')]
      .find((entry) =>
        /^SKU$/iu.test(
          entry.querySelector('.key-title')?.textContent?.trim() || ''
        )
      )
      ?.querySelector('.key-value')
      ?.textContent?.trim(),
    available: /hết hàng|out of stock/iu.test(
      text('.quantity-content-warning') || ''
    )
      ? false
      : [
            ...document.querySelectorAll(
              'button.add-to-cart-buy-now-btn, [data-product-purchase]'
            ),
          ].some(
            (element) =>
              !element.hasAttribute('disabled') &&
              /Mua ngay|Thêm vào giỏ|Add to cart/iu.test(
                element.textContent || ''
              )
          )
        ? true
        : undefined,
    minQuantity:
      Number(
        document
          .querySelector('.sku-quantity-selection-v2 input[min]')
          ?.getAttribute('min')
      ) || undefined,
    maxQuantity:
      Number(
        document
          .querySelector('.sku-quantity-selection-v2 input[max]')
          ?.getAttribute('max')
      ) || undefined,
    description: text(
      '.pdp-product-desc, .pdp-product-desc-v2, [data-description], #product-description, .product-description, .product-description-wrapper, .product__description, .product-tabs-section .tabs-content, .rte'
    ),
    selectedVariant: variants.filter((variant) => variant.selected),
    variants,
    skuCatalog,
    skuCatalogObserved,
    rawText: bodyText,
    specs: [
      ...document.querySelectorAll(
        '.key-li, .pdp-product-highlights li, [data-spec]'
      ),
    ].map((element) => element.innerText || element.textContent),
    jsonLd,
    images: [...new Set(images)],
    productImages: [...preferredImages.values()].map((image) => image.url),
    manufacturerLabels,
    manufacturerVariants,
    links: anchors.map((anchor) => ({
      url: absolute(anchor.getAttribute('href')),
      text: anchor.innerText || anchor.title || '',
    })),
    cards,
    searchCoverage: {
      currentPage,
      lastPage: pageNumbers.length ? Math.max(...pageNumbers) : null,
      reportedTotal: resultCount
        ? Number((resultCount[1] || resultCount[2]).replace(/[.,]/gu, ''))
        : null,
      terminalConfirmed: nextDisabled,
      nextAvailable: nextButton ? !nextDisabled : null,
    },
    nextUrl: absolute(
      document
        .querySelector('a[rel="next"], a[aria-label="Next"], [data-next-page]')
        ?.getAttribute('href')
    ),
  };
}

export function classifyPage(page) {
  const title = page.title || '';
  if (
    page.challenge?.detected ||
    /\/_____tmd_____\/punish|\/captcha(?:\/|\?|$)/iu.test(page.url || '') ||
    /captcha|verify (?:your|you)|security verification|access denied|robot check|xác minh/iu.test(
      title
    ) ||
    /(?:please complete the security check|performing security verification|verifies you are not a bot|slide to verify|unusual traffic)/iu.test(
      page.rawText
    )
  ) {
    return 'challenge';
  }
  if (
    /^sign in|^log in|^đăng nhập/iu.test(title) ||
    /\/user\/login|\/member\/login/iu.test(page.url || '')
  ) {
    return 'login';
  }
  if (
    /pdp-web-redirect-app/iu.test(page.url || '') ||
    (!page.priceText &&
      /chuyển sang ứng dụng di động Lazada|chỉ có trên ứng dụng di động Lazada/iu.test(
        page.rawText || ''
      ))
  ) {
    return 'app-only';
  }
  const unavailable =
    /page not found|we can['’]t find that page|product (?:no longer (?:available|exists)|does not exist)|sản phẩm(?: này)? không(?: còn)? tồn tại/iu;
  if (
    unavailable.test(title) ||
    (!page.priceText && unavailable.test(page.rawText || ''))
  ) {
    return 'unavailable';
  }
  return 'ok';
}

export class BrowserCollector {
  constructor({
    cache,
    store = cache?.store,
    browserOptions = {},
    settleMs = 1000,
    maxScrolls = 20,
    captureTimeoutMs = 240000,
    flavourScope = 'all',
  } = {}) {
    this.cache = cache;
    this.store = store;
    this.browserOptions = browserOptions;
    this.settleMs = settleMs;
    this.maxScrolls = maxScrolls;
    if (!['all', 'chocolate-or-unflavoured'].includes(flavourScope)) {
      throw new Error('Unsupported flavour scope');
    }
    this.flavourScope = flavourScope;
    if (!Number.isFinite(captureTimeoutMs) || captureTimeoutMs <= 0) {
      throw new Error('captureTimeoutMs must be positive');
    }
    this.captureTimeoutMs = captureTimeoutMs;
    this.tail = Promise.resolve();
    if (this.cache) {
      this.cache.beforeDownload = () => this.assertCollecting();
    }
  }

  async start() {
    if (!this.runtime) {
      const { launchBrowser, connectBrowser, makeBrowserCommander } =
        await import('browser-commander');
      this.attached = Boolean(this.browserOptions.cdpEndpoint);
      const launchOptions = {
        engine: 'playwright',
        headless: true,
        debug: false,
        userDataDir: join(this.store.directory, 'browser-profile'),
        ...(this.store.visibility === 'private'
          ? { persistSessionCookies: true }
          : {}),
        ...this.browserOptions,
        preferences: {
          ...this.browserOptions.preferences,
          translate: {
            ...this.browserOptions.preferences?.translate,
            enabled: false,
          },
        },
        extraArgs: [
          ...(this.browserOptions.extraArgs || []),
          '--disable-features=SessionRestoreInfobar,Translate',
        ],
      };
      this.persistent =
        !this.attached &&
        (this.browserOptions.persistentWindow ??
          (launchOptions.headless === false &&
            launchOptions.launch !== 'engine'));
      this.runtime = this.attached
        ? await connectBrowser({
            engine: 'playwright',
            cdpEndpoint: this.browserOptions.cdpEndpoint,
            timeout: 30000,
            debug: this.browserOptions.debug ?? false,
          })
        : this.persistent
          ? await acquireBrowserWindow(this.store.directory, launchOptions)
          : await launchBrowser(launchOptions);
      if (this.attached) {
        this.runtime.page = await this.runtime.page.context().newPage();
      }
      registerChallengeStore(this.runtime.page, this.store);
      this.closing = false;
      this.imageTasks = new Set();
      this.imageRoute = async (route) => {
        if (this.closing) {
          await route.abort().catch(() => {});
          return;
        }
        if (route.request().resourceType() !== 'image') {
          await route.continue();
          return;
        }
        const acquisition = serveBrowserImage({
          route,
          cache: this.cache,
          refresh: this.refreshImages,
          activePageUrl: this.activeImagePageUrl,
        }).catch((error) => {
          if (error.code === 'COLLECTION_STOPPED') {
            this.imageStop = error;
          }
        });
        this.imageTasks.add(acquisition);
        acquisition.then(() => this.imageTasks.delete(acquisition));
        await acquisition;
      };
      await this.runtime.page.route('**/*', this.imageRoute);
      this.imageResponse = (response) => {
        if (this.closing || response.request().resourceType() !== 'image') {
          return;
        }
        const capture = (async () => {
          const bytes = await boundedImageBody(response);
          await retainBrowserImage({ response, bytes, cache: this.cache });
        })().catch((error) => {
          if (error.code === 'COLLECTION_STOPPED') {
            this.imageStop = error;
          }
        });
        this.imageTasks.add(capture);
        capture.finally(() => this.imageTasks.delete(capture));
      };
      this.runtime.page.on('response', this.imageResponse);
      this.commander = makeBrowserCommander({
        page: this.runtime.page,
        debug: this.browserOptions.debug ?? false,
        enableNetworkTracking: false,
      });
    }
  }

  async page(url, options = {}) {
    const flavourScope = options.flavourScope ?? this.flavourScope;
    if (!['all', 'chocolate-or-unflavoured'].includes(flavourScope)) {
      throw new Error('Unsupported flavour scope');
    }
    const reusableUrl = await this.cachedPreferredUrl(
      url,
      options,
      flavourScope
    );
    const result = await this.cache.get(reusableUrl, {
      // A public login wall must not suppress a later account collection.
      // Account failures remain cached, so retries require explicit refresh.
      ...options,
      acceptCached: (cached) =>
        (options.acceptCached
          ? options.acceptCached(cached)
          : this.store.visibility !== 'private' ||
            cached.visibility === 'private' ||
            cached.status === 'ok') &&
        (cached.status !== 'ok' ||
          cachedVariantMatches(reusableUrl, cached.snapshot, flavourScope)),
      load: () => {
        // One page owns one navigation at a time, even for different hosts.
        const capture = () =>
          this.captureWithBudget(reusableUrl, {
            refresh: options.refresh,
            flavourScope,
          });
        const operation = this.tail.then(capture, capture);
        this.tail = operation.catch(() => {});
        return operation;
      },
    });
    // Re-run newer extractors against saved HTML, preserving the original
    // observation time and screenshot. A selector fix needs no site request.
    if (
      (options.reprocess ||
        result.extractorVersion !== EXTRACTOR_VERSION ||
        result.extractedHtmlSha256 !== result.html?.sha256) &&
      result.html
    ) {
      const bytes = await this.store.blob(result.html.sha256);
      if (bytes) {
        const { parseHTML } = await import('linkedom');
        const { document } = parseHTML(bytes.toString('utf8'));
        const snapshot = extractPage({
          document,
          url: result.finalUrl || result.snapshot.url,
        });
        snapshot.challenge = inspectPageChallenge({
          document,
          url: result.finalUrl || result.snapshot.url,
        });
        snapshot.rawText = result.snapshot.rawText;
        const updated = {
          ...result,
          snapshot,
          status: classifyPage(snapshot),
          extractorVersion: EXTRACTOR_VERSION,
          extractedHtmlSha256: result.html.sha256,
        };
        delete updated.cacheHit;
        delete updated.stale;
        await this.store.put('cache', updated);
        return {
          ...updated,
          cacheHit: result.cacheHit,
          stale: result.stale,
          previousSnapshot: result.snapshot,
        };
      }
    }
    return result;
  }

  async cachedPreferredUrl(url, options, flavourScope) {
    if (options.refresh || flavourScope === 'all' || requestedSku(url)) {
      return url;
    }
    const namespace = options.namespace || 'page';
    const current = await this.store.get(
      'cache',
      `${namespace}:${canonicalUrl(url)}`
    );
    const preferred =
      current?.snapshot && preferredVariant(current.snapshot, flavourScope);
    if (
      !preferred ||
      cachedVariantMatches(url, current.snapshot, flavourScope)
    ) {
      return url;
    }
    const selected = new URL(url);
    selected.searchParams.set('skuId', preferred.sku);
    for (const candidateUrl of [preferred.url, selected.href].filter(Boolean)) {
      const candidate = await this.store.get(
        'cache',
        `${namespace}:${canonicalUrl(candidateUrl)}`
      );
      if (
        this.cache.accepts(candidate, {
          ttlMs: options.ttlMs ?? 21600000,
          refresh: false,
          acceptCached: (entry) =>
            entry.status === 'ok' &&
            (!options.acceptCached || options.acceptCached(entry)) &&
            cachedVariantMatches(candidateUrl, entry.snapshot, flavourScope),
        })
      ) {
        return candidateUrl;
      }
    }
    return url;
  }

  async captureWithBudget(url, options) {
    let timer;
    let timedOut = false;
    const previousImagePageUrl = this.activeImagePageUrl;
    this.activeImagePageUrl = url;
    try {
      return await Promise.race([
        this.capture(url, options),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(
              new Error(
                `Page capture timed out after ${this.captureTimeoutMs} ms`
              )
            );
          }, this.captureTimeoutMs);
        }),
      ]);
    } catch (error) {
      if (error.code === 'COLLECTION_STOPPED') {
        await stopForChallenge(this.store, error.challenge || {});
      }
      if (timedOut) {
        // Close the collector-owned page so a late navigation cannot modify
        // the next capture. Existing attached-browser tabs stay untouched.
        if (this.persistent) {
          await this.runtime.page.context().newPage();
        }
        await this.runtime?.page.close();
        if (this.persistent) {
          await this.runtime?.release();
        } else if (!this.attached) {
          await this.runtime?.browser.close();
        }
        this.runtime = undefined;
        this.commander = undefined;
      }
      throw error;
    } finally {
      this.activeImagePageUrl = previousImagePageUrl;
      clearTimeout(timer);
    }
  }

  async capture(
    url,
    { refresh = false, flavourScope = this.flavourScope } = {}
  ) {
    await assertCollectionRunning(this.store);
    await this.start();
    await this.runtime.touch?.();
    // A previous blocked dialog must be resolved before any new navigation.
    await resolvePageDialogs(this.runtime.page);
    this.refreshImages = refresh;
    const page = this.runtime.page;
    await this.runtime.pace?.(url, this.cache.scheduler.intervalMs);
    await this.assertCollecting();
    await this.commander.goto({
      url,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      waitForNetworkIdle: false,
    });
    await page.waitForTimeout(this.settleMs);
    await resolvePageDialogs(page);
    let snapshot = await page.evaluate(extractPage);
    let status = classifyPage(snapshot);
    if (status === 'challenge') {
      throw new CollectionStoppedError({
        url: snapshot.url,
        signals: ['page-classification'],
      });
    }
    let scrolling;
    const screenshots = [];
    let variantSelection;
    if (status === 'ok') {
      await waitForPageReady(page);
      snapshot = await page.evaluate(extractPage);
      variantSelection = await this.selectRequestedVariant(
        url,
        snapshot,
        flavourScope
      );
      snapshot = await page.evaluate(extractPage);
      screenshots.push(await storeViewport(this.store, page, 'before-scroll'));
    }
    if (status === 'ok') {
      scrolling = await scrollProductContent(page, {
        maxSteps: this.maxScrolls,
      });
      await waitForPageReady(page);
      snapshot = await page.evaluate(extractPage);
      await resolvePageDialogs(page);
      status = classifyPage(snapshot);
      if (status === 'challenge') {
        throw new CollectionStoppedError({
          url: snapshot.url,
          signals: ['page-classification'],
        });
      }
    }
    const html = await this.store.putBlob(Buffer.from(await page.content()));
    screenshots.push(await storeViewport(this.store, page, 'after-scroll'));
    const screenshot = (
      snapshot.cards?.length ? screenshots.at(-1) : screenshots[0]
    ).blob;
    const finalUrl = canonicalUrl(snapshot.url);
    await Promise.all([...this.imageTasks]);
    if (this.imageStop) {
      throw this.imageStop;
    }
    await assertCollectionRunning(this.store);
    return {
      snapshot,
      status,
      html,
      extractedHtmlSha256: html.sha256,
      screenshot,
      screenshotMode: 'viewport',
      screenshots,
      finalUrl,
      scrollLimit: this.maxScrolls,
      scrolling,
      variantSelection,
      extractorVersion: EXTRACTOR_VERSION,
      imagesRefreshed: refresh,
    };
  }

  async selectRequestedVariant(
    url,
    snapshot,
    flavourScope = this.flavourScope
  ) {
    const explicit = requestedSku(url);
    const preferred = !explicit && preferredVariant(snapshot, flavourScope);
    const requested = explicit || preferred?.sku?.split('_VNAMZ-').at(-1);
    const decision = {
      policyVersion: VARIANT_POLICY_VERSION,
      flavourScope,
      reason: explicit
        ? 'exact-requested-sku'
        : preferred
          ? 'preferred-scoped-sku'
          : 'no-confirmed-scoped-combination',
      requestedSku: requested,
      initialSku: snapshot.sku,
      changed: false,
    };
    if (
      !requested ||
      String(snapshot.sku || '')
        .split('_VNAMZ-')
        .at(-1) === requested
    ) {
      return decision;
    }
    const target = snapshot.skuCatalog?.find(
      (sku) => String(sku.sku).split('_VNAMZ-').at(-1) === requested
    );
    if (!target) {
      throw new Error(
        'Requested SKU is absent from the observed variant inventory'
      );
    }
    await selectVariantOptions({
      page: this.runtime.page,
      target,
      url,
      scheduler: this.cache.scheduler,
      runtime: this.runtime,
      settleMs: this.settleMs,
    });
    const selected = await this.runtime.page.evaluate(extractPage);
    if (
      String(selected.sku || '')
        .split('_VNAMZ-')
        .at(-1) !== requested
    ) {
      throw new Error(
        'Requested SKU did not become the selected SKU; no price was recorded'
      );
    }
    return { ...decision, changed: true, selectedSku: selected.sku };
  }

  async assertCollecting() {
    await assertCollectionRunning(this.store);
    if (this.runtime) {
      try {
        await assertPageNotChallenged(this.runtime.page);
      } catch (error) {
        if (error.code === 'COLLECTION_STOPPED') {
          await stopForChallenge(this.store, error.challenge);
        }
        throw error;
      }
    }
  }

  async resumeCollection() {
    await this.start();
    await assertPageNotChallenged(this.runtime.page);
    const previous = await this.store.get(
      'collection-stop',
      COLLECTION_STOP_ID
    );
    if (
      previous?.active &&
      previous.origin &&
      new URL(this.runtime.page.url()).origin !== previous.origin
    ) {
      throw new CollectionStoppedError(previous);
    }
    const state = {
      ...(previous || {}),
      id: COLLECTION_STOP_ID,
      active: false,
      resumedAt: new Date().toISOString(),
    };
    await this.store.put('collection-stop', state);
    this.imageStop = undefined;
    return state;
  }

  async close() {
    await this.tail;
    // Stop admitting image producers before draining their writes. Route
    // acquisitions and response retention both belong to this collector.
    this.closing = true;
    if (this.runtime && this.imageResponse) {
      this.runtime.page.off('response', this.imageResponse);
    }
    await Promise.all(this.imageTasks || []);
    try {
      await this.commander?.destroy();
    } finally {
      if (this.runtime && this.imageRoute) {
        await this.runtime.page
          .unroute('**/*', this.imageRoute)
          .catch(() => {});
        this.runtime.page.off('response', this.imageResponse);
      }
      if (this.attached) {
        await this.runtime?.page.close();
      }
      if (this.persistent) {
        await this.runtime?.release();
      } else {
        await this.runtime?.browser.close();
      }
      this.runtime = undefined;
      this.commander = undefined;
    }
  }
}
