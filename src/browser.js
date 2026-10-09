import { join } from 'node:path';
import { canonicalUrl } from './util.js';

export const EXTRACTOR_VERSION = 11;

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
      '[itemprop="associatedMedia"] img, .gallery-preview-panel img, .item-gallery img, .gallery-preview-panel-v2 img, .item-gallery-v2 img, .pdp-product-desc img, .pdp-product-desc-v2 img, .product__media img, .product-single__media img, .product-information__media img, .product-images img, .product-thumb img, .product-gallery img, .product-description img, .product-description-wrapper img, #product-description img, .product__description img, .product-tabs-section img, .nutritional-info-image img, .rte img, .woocommerce-product-gallery img, img.wp-post-image, img.product-gallery-grid__image, img.product__media-item--variant, img.ps-spf-images__image, img[alt*="nutrition facts" i], img[alt*="supplement facts" i], [data-product-image]'
    ),
  ]
    .flatMap((image) => {
      const fullSize =
        image.parentElement?.getAttribute('data-zoom-image') ||
        image.parentElement?.getAttribute('data-image');
      return fullSize
        ? [fullSize]
        : [image.currentSrc, image.src, image.getAttribute('data-src')];
    })
    .map(absolute)
    .filter((url) => url && /^https?:/u.test(url));
  const preferredImages = new Map();
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
  if (
    /page not found|we can['’]t find that page|product no longer available|sản phẩm không tồn tại/iu.test(
      page.rawText
    )
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
    captureTimeoutMs = 90000,
  } = {}) {
    this.cache = cache;
    this.store = store;
    this.browserOptions = browserOptions;
    this.settleMs = settleMs;
    this.maxScrolls = maxScrolls;
    if (!Number.isFinite(captureTimeoutMs) || captureTimeoutMs <= 0) {
      throw new Error('captureTimeoutMs must be positive');
    }
    this.captureTimeoutMs = captureTimeoutMs;
    this.tail = Promise.resolve();
  }

  async start() {
    if (!this.runtime) {
      const { launchBrowser, connectBrowser, makeBrowserCommander } =
        await import('browser-commander');
      this.attached = Boolean(this.browserOptions.cdpEndpoint);
      this.runtime = this.attached
        ? await connectBrowser({
            engine: 'playwright',
            cdpEndpoint: this.browserOptions.cdpEndpoint,
            timeout: 30000,
          })
        : await launchBrowser({
            engine: 'playwright',
            headless: true,
            userDataDir: join(this.store.directory, 'browser-profile'),
            ...this.browserOptions,
          });
      if (this.attached) {
        this.runtime.page = await this.runtime.page.context().newPage();
      }
      this.imageTasks = new Set();
      await this.runtime.page.route('**/*', async (route) => {
        if (route.request().resourceType() !== 'image') {
          await route.continue();
          return;
        }
        let url;
        try {
          url = canonicalUrl(route.request().url());
        } catch {
          await route.continue();
          return;
        }
        const cached = await this.store.get('cache', `image:${url}`);
        const bytes =
          cached?.blob &&
          !cached.invalidatedAt &&
          (await this.store.blob(cached.blob.sha256));
        if (bytes && !this.refreshImages) {
          await route.fulfill({ body: bytes, contentType: cached.contentType });
        } else {
          await route.continue();
        }
      });
      this.runtime.page.on('response', (response) => {
        if (response.request().resourceType() !== 'image' || !response.ok()) {
          return;
        }
        const capture = (async () => {
          const headers = response.headers();
          const bytes = await boundedImageBody(response);
          if (!bytes || bytes.length > 25 * 1024 ** 2) {
            return;
          }
          const blob = await this.store.putBlob(bytes);
          const url = canonicalUrl(response.url());
          const image = {
            blob,
            contentType: headers['content-type'] || 'image/png',
            etag: headers.etag || null,
            lastModified: headers['last-modified'] || null,
          };
          const known = await this.store.get('cache', `image:${url}`);
          if (known?.invalidatedAt || known?.blob?.sha256 !== blob.sha256) {
            await this.store.put('cache', {
              ...image,
              id: `image:${url}`,
              url,
              fetchedAt: Date.now(),
              checkedAt: Date.now(),
            });
          }
          this.cache.browserImages.set(url, image);
          if (this.cache.browserImages.size > 100) {
            this.cache.browserImages.delete(
              this.cache.browserImages.keys().next().value
            );
          }
        })().catch(() => {});
        this.imageTasks.add(capture);
        capture.finally(() => this.imageTasks.delete(capture));
      });
      this.commander = makeBrowserCommander({
        page: this.runtime.page,
        enableNetworkTracking: false,
      });
    }
  }

  async page(url, options = {}) {
    const result = await this.cache.get(url, {
      ...options,
      load: () => {
        // One page owns one navigation at a time, even for different hosts.
        const capture = () =>
          this.captureWithBudget(url, { refresh: options.refresh });
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

  async captureWithBudget(url, options) {
    let timer;
    let timedOut = false;
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
      if (timedOut) {
        // Close the collector-owned page so a late navigation cannot modify
        // the next capture. Existing attached-browser tabs stay untouched.
        await this.runtime?.page.close();
        if (!this.attached) {
          await this.runtime?.browser.close();
        }
        this.runtime = undefined;
        this.commander = undefined;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async capture(url, { refresh = false } = {}) {
    await this.start();
    this.refreshImages = refresh;
    const page = this.runtime.page;
    await this.commander.goto({
      url,
      timeout: 30000,
      waitUntil: 'domcontentloaded',
      waitForNetworkIdle: false,
    });
    await page.waitForTimeout(this.settleMs);
    let snapshot = await page.evaluate(extractPage);
    let status = classifyPage(snapshot);
    if (status === 'ok') {
      for (let index = 0; index < this.maxScrolls; index += 1) {
        const finished = await page.evaluate(() => {
          globalThis.scrollBy(0, 800);
          return (
            globalThis.scrollY + globalThis.innerHeight >=
            globalThis.document.body.scrollHeight
          );
        });
        await page.waitForTimeout(100);
        if (finished) {
          break;
        }
      }
      snapshot = await page.evaluate(extractPage);
      status = classifyPage(snapshot);
    }
    const html = await this.store.putBlob(Buffer.from(await page.content()));
    const screenshot = await this.store.putBlob(
      await page.screenshot({ fullPage: true, timeout: 15000 })
    );
    const finalUrl = canonicalUrl(snapshot.url);
    await Promise.all([...this.imageTasks]);
    return {
      snapshot,
      status,
      html,
      extractedHtmlSha256: html.sha256,
      screenshot,
      finalUrl,
      scrollLimit: this.maxScrolls,
      extractorVersion: EXTRACTOR_VERSION,
      imagesRefreshed: refresh,
    };
  }

  async close() {
    await this.tail;
    await Promise.all(this.imageTasks || []);
    try {
      await this.commander?.destroy();
    } finally {
      if (this.attached) {
        await this.runtime?.page.close();
      }
      await this.runtime?.browser.close();
      this.runtime = undefined;
      this.commander = undefined;
    }
  }
}
