import { AssociativeStore } from './store.js';
import { EvidenceCache, evidenceId } from './cache.js';
import { BrowserCollector } from './browser.js';
import { TesseractOcr } from './ocr.js';
import { parseProduct, validateOffer, validateProduct } from './products.js';
import { crossCheck, extractNutrition } from './nutrition.js';
import { compareOffers } from './compare.js';
import { crawlMarketplace, latestCrawl } from './crawl.js';
import { auditCoverage } from './coverage.js';
import { MANUFACTURERS, isTrustedManufacturer } from './manufacturers.js';
import { reconcileManufacturer } from './verification.js';
import { captureDelivery } from './delivery.js';
import { importBrowserCapture } from './capture-import.js';
import { reviewManufacturer } from './manufacturer-review.js';
import { applyListingCategoryReview } from './category-review.js';
import { catalogProducts, resolveProductReviews } from './catalog-products.js';
import { canonicalUrl, listingKey, positive, sha256 } from './util.js';

export const MARKETS = {
  vn: {
    host: 'www.lazada.vn',
    currency: 'VND',
    categoryUrls: [
      'https://www.lazada.vn/bach-hoa-online-kem-cac-loai/',
      'https://www.lazada.vn/bach-hoa-online-kem-daua/',
    ],
    queries: ['whey protein', 'whey isolate', 'protein powder'],
  },
  th: {
    host: 'www.lazada.co.th',
    currency: 'THB',
    queries: ['whey protein', 'chocolate ice cream'],
  },
  sg: {
    host: 'www.lazada.sg',
    currency: 'SGD',
    queries: ['whey protein', 'chocolate ice cream'],
  },
  my: {
    host: 'www.lazada.com.my',
    currency: 'MYR',
    queries: ['whey protein', 'chocolate ice cream'],
  },
  ph: {
    host: 'www.lazada.com.ph',
    currency: 'PHP',
    queries: ['whey protein', 'chocolate ice cream'],
  },
  id: {
    host: 'www.lazada.co.id',
    currency: 'IDR',
    queries: ['whey protein', 'chocolate ice cream'],
  },
};

export class LazadaSearch {
  constructor({
    store = new AssociativeStore(),
    cache,
    collector,
    ocr,
    market = 'vn',
    deliveryArea = 'Nha Trang',
    flavourScope = 'all',
    maxImages = 40,
    offline = false,
    browserOptions,
    scheduler,
    manufacturerRegistry = MANUFACTURERS,
  } = {}) {
    if (!MARKETS[market]) {
      throw new Error('Unsupported Lazada market');
    }
    if (!['all', 'chocolate-or-unflavoured'].includes(flavourScope)) {
      throw new Error('Unsupported flavour scope');
    }
    positive(maxImages, 'maxImages', { zero: true, integer: true });
    this.store = store;
    this.cache = cache || new EvidenceCache({ store, offline, scheduler });
    this.collector =
      collector ||
      new BrowserCollector({ cache: this.cache, store, browserOptions });
    this.ocr = ocr === false ? undefined : ocr || new TesseractOcr({ store });
    this.market = market;
    this.host = MARKETS[market].host;
    this.currency = MARKETS[market].currency;
    this.deliveryArea = deliveryArea;
    this.flavourScope = flavourScope;
    this.maxImages = maxImages;
    this.manufacturerRegistry = manufacturerRegistry;
  }

  assertMarket(url) {
    const host = new URL(url).hostname.replace(/^www\./u, '');
    if (host !== MARKETS[this.market].host.replace(/^www\./u, '')) {
      throw new Error(
        `Product URL must belong to Lazada market ${this.market}`
      );
    }
  }

  async importRecords({
    products = [],
    offers = [],
    discoveries = [],
    skuInventories = [],
    crawls = [],
  }) {
    const validProducts = products.map(validateProduct);
    const validOffers = offers.map(validateOffer);
    const known = new Set([
      ...(await this.store.list('product')).map((product) => product.id),
      ...validProducts.map((product) => product.id),
    ]);
    for (const offer of validOffers) {
      if (!known.has(offer.productId)) {
        throw new Error(`Unknown product ${offer.productId}`);
      }
    }
    const metadata = [
      ['discovery', discoveries],
      ['sku-inventory', skuInventories],
      ['crawl', crawls],
    ];
    for (const [kind, records] of metadata) {
      if (
        !Array.isArray(records) ||
        records.some(
          (record) => !record || typeof record.id !== 'string' || !record.id
        )
      ) {
        throw new Error(`Imported ${kind} records require string IDs`);
      }
      for (const record of records) {
        if (record.url) {
          this.assertMarket(canonicalUrl(record.url));
        }
      }
    }
    for (const product of validProducts) {
      await this.store.put('product', product);
    }
    for (const offer of validOffers) {
      await this.saveOffer(offer);
    }
    for (const [kind, records] of metadata) {
      if (typeof this.store.putMany === 'function') {
        await this.store.putMany(kind, records);
      } else {
        for (const record of records) {
          await this.store.put(kind, record);
        }
      }
    }
    return { products: products.length, offers: offers.length };
  }

  async saveOffer(offer) {
    await this.store.put('offer-history', {
      ...offer,
      id: `${offer.id}:${sha256(JSON.stringify(offer))}`,
      offerId: offer.id,
    });
    return this.store.put('offer', offer);
  }

  async collect(url, { refresh = false, reprocess = false } = {}) {
    this.assertMarket(url);
    const capture = await this.collector.page(canonicalUrl(url), {
      refresh,
      reprocess,
      namespace: `lazada:${this.market}:${this.deliveryArea}`,
      ...(this.store.visibility === 'private'
        ? {
            acceptCached: (cached) => {
              if (cached.status !== 'ok') {
                return cached.visibility === 'private';
              }
              try {
                const { offer } = parseProduct(cached.snapshot, {
                  market: this.market,
                  currency: MARKETS[this.market].currency,
                });
                return (
                  Number.isFinite(offer.price) &&
                  offer.price > 0 &&
                  offer.variantConfirmed
                );
              } catch {
                return false;
              }
            },
          }
        : {}),
    });
    if (capture.status !== 'ok') {
      throw new Error(`Collection stopped: ${capture.status} at ${url}`);
    }
    this.assertMarket(capture.finalUrl || capture.snapshot.url);
    await this.store.put('sku-inventory', {
      id: canonicalUrl(url),
      url: canonicalUrl(url),
      skus: capture.snapshot.skuCatalog || [],
      inventoryObserved: capture.snapshot.skuCatalogObserved === true,
      observedAt: new Date(capture.fetchedAt).toISOString(),
      cacheId: capture.id,
    });
    const id = evidenceId(
      capture.snapshot.url,
      Buffer.from(JSON.stringify(capture.snapshot))
    );
    await this.store.put('evidence', {
      id,
      url: capture.snapshot.url,
      role: 'listing',
      sourceUrl: capture.sourceUrl || capture.snapshot.url,
      observedAt: new Date(capture.fetchedAt).toISOString(),
      html: capture.html,
      screenshot: capture.screenshot,
      screenshots: capture.screenshots,
      screenshotMode: capture.screenshotMode,
      cacheId: capture.id,
    });
    const { product, offer } = parseProduct(capture.snapshot, {
      market: this.market,
      currency: MARKETS[this.market].currency,
      evidenceId: id,
      observedAt: new Date(capture.fetchedAt).toISOString(),
    });
    const previous = await resolveProductReviews(
      this.store,
      await this.store.get('product', product.id)
    );
    // A refresh keeps reviewed facts but preserves fresh contradictory claims.
    if (previous) {
      product.claims = [...previous.claims, ...product.claims].filter(
        (claim, index, claims) =>
          claims.findIndex(
            (entry) => JSON.stringify(entry) === JSON.stringify(claim)
          ) === index
      );
      product.evidenceIds = [...new Set([...previous.evidenceIds, id])];
      product.crossChecks = previous.crossChecks || [];
      product.corrections = previous.corrections || [];
      product.manufacturerVerification =
        previous.observedAt === product.observedAt
          ? previous.manufacturerVerification
          : undefined;
      product.reviewedFields =
        previous.observedAt === product.observedAt
          ? previous.reviewedFields || []
          : [];
      for (const field of product.reviewedFields) {
        product[field] = previous[field];
      }
    }
    await applyListingCategoryReview(this.store, product);
    await this.collectOcr(product, capture);
    const validated = validateProduct(product);
    await this.store.put('product', validated);
    // A destination-specific shipping quote expires with the price snapshot.
    const previousOffer = await this.store.get('offer', offer.id);
    const savedOffer =
      previousOffer?.observedAt === offer.observedAt &&
      (previousOffer?.evidenceId === offer.evidenceId || capture.cacheHit)
        ? { ...previousOffer, ...offer }
        : offer;
    await this.saveOffer(validateOffer(savedOffer));
    // Repair an older extractor's default JSON-LD SKU when the saved DOM
    // confirms a different selected variant. Preserve actual other variants.
    if (capture.previousSnapshot) {
      const olderId = parseProduct(capture.previousSnapshot).offer.id;
      const older = await this.store.get('offer', olderId);
      if (older && older.id !== savedOffer.id) {
        await this.saveOffer({ ...older, supersededBy: savedOffer.id });
      }
    }
    for (const older of await this.store.list('offer')) {
      if (
        older.id !== savedOffer.id &&
        listingKey(older.url) === listingKey(savedOffer.url) &&
        older.seller === savedOffer.seller &&
        older.sku === savedOffer.sku &&
        !older.supersededBy
      ) {
        await this.saveOffer({ ...older, supersededBy: savedOffer.id });
      }
    }
    return {
      product: validated,
      offer: savedOffer,
      cacheHit: capture.cacheHit,
      stale: capture.stale,
    };
  }

  importCapture(capture) {
    return importBrowserCapture(this, capture);
  }

  reviewManufacturer(productId, review) {
    return reviewManufacturer(this, productId, review);
  }

  async collectOcr(product, capture) {
    if (!this.ocr) {
      product.warnings.push('OCR disabled');
      return;
    }
    const allImages =
      capture.snapshot.productImages || capture.snapshot.images || [];
    const selected = allImages.slice(0, this.maxImages);
    const screenshots = [
      ...new Map(
        [
          capture.screenshot,
          ...(capture.screenshots || []).map((view) => view.blob),
        ]
          .filter(Boolean)
          .map((blob) => [blob.sha256, blob])
      ).values(),
    ];
    product.ocrCoverage = {
      discovered: allImages.length,
      attempted: selected.length + screenshots.length,
      skipped: allImages.length - selected.length,
      failed: 0,
      empty: 0,
      passes: 0,
    };
    const recognize = async (blob, imageUrl, options, retry = true) => {
      try {
        product.ocrCoverage.passes += 1;
        const result = await this.ocr.recognize(blob, options);
        if (!result.text.trim()) {
          product.ocrCoverage.empty += 1;
        }
        const id = `ocr-evidence:${product.id}:${result.id}`;
        await this.store.put('evidence', {
          id,
          role: 'ocr',
          productId: product.id,
          url: imageUrl,
          image: blob,
          ocrId: result.id,
        });
        product.evidenceIds.push(id);
        const extracted = extractNutrition(result.text);
        product.warnings.push(...extracted.warnings);
        for (const [field, value] of Object.entries(extracted.fields)) {
          product.claims.push({
            field,
            value,
            evidenceId: id,
            source: 'ocr',
            confidence: result.confidence,
            requiresReview: true,
            excerpt: extracted.excerpts[field],
          });
          if (
            product[field] === undefined ||
            (field === 'ingredients' && !product.ingredients.length)
          ) {
            product[field] = value;
          }
          if (JSON.stringify(product[field]) !== JSON.stringify(value)) {
            product.warnings.push(`OCR disagrees about ${field}`);
          }
        }
        if (
          retry &&
          this.ocr instanceof TesseractOcr &&
          result.psm !== 11 &&
          result.confidence < 0.85
        ) {
          await recognize(blob, imageUrl, { psm: 11 }, false);
        }
      } catch (error) {
        product.ocrCoverage.failed += 1;
        product.warnings.push(`OCR failed for ${imageUrl}: ${error.message}`);
      }
    };
    for (const imageUrl of selected) {
      try {
        const image = await this.cache.image(imageUrl, {
          refresh:
            capture.imagesRefreshed === true &&
            !capture.cacheHit &&
            !this.cache.offline,
        });
        await recognize(image.blob, imageUrl);
      } catch (error) {
        product.ocrCoverage.failed += 1;
        product.warnings.push(
          `Image unavailable: ${imageUrl}: ${error.message}`
        );
      }
    }
    for (const screenshot of screenshots) {
      await recognize(screenshot, capture.snapshot.url);
    }
    product.evidenceIds = [...new Set(product.evidenceIds)];
    product.claims = [
      ...new Map(
        product.claims.map((claim) => [JSON.stringify(claim), claim])
      ).values(),
    ];
    product.warnings = [...new Set(product.warnings)];
  }

  async crawl(options = {}) {
    return await crawlMarketplace(this, {
      ...options,
      queries: options.categoryOnly
        ? []
        : options.queries || MARKETS[this.market].queries,
      categoryUrls:
        options.categoryUrls ??
        (options.queries && !options.categoryOnly
          ? []
          : MARKETS[this.market].categoryUrls || []),
    });
  }

  async audit() {
    const crawls = await this.store.list('crawl');
    const crawl = latestCrawl(crawls);
    return auditCoverage({
      crawl,
      products: await catalogProducts(this.store),
      offers: await this.store.list('offer'),
      discoveries: await this.store.list('discovery'),
      skuInventories: await this.store.list('sku-inventory'),
    });
  }

  async verify(productId, manufacturerUrl, { refresh = false } = {}) {
    const product = await this.store.get('product', productId);
    if (!product) {
      throw new Error('Unknown product');
    }
    const url = canonicalUrl(manufacturerUrl);
    if (/lazada\./iu.test(new URL(url).hostname)) {
      throw new Error(
        'Manufacturer verification requires a separate official source'
      );
    }
    const capture = await this.collector.page(url, {
      namespace: 'manufacturer',
      ttlMs: 30 * 86400000,
      refresh,
    });
    if (capture.status !== 'ok') {
      throw new Error(`Manufacturer page is ${capture.status}`);
    }
    const id = evidenceId(url, Buffer.from(JSON.stringify(capture.snapshot)));
    const { product: manufacturer } = parseProduct(capture.snapshot, {
      evidenceId: id,
      source: 'manufacturer',
    });
    await this.collectOcr(manufacturer, capture);
    await this.store.put('evidence', {
      id,
      url,
      role: 'manufacturer-supplied-by-operator',
      productId,
      extracted: manufacturer,
      html: capture.html,
      screenshot: capture.screenshot,
      screenshots: capture.screenshots,
      screenshotMode: capture.screenshotMode,
      observedAt: new Date(capture.fetchedAt).toISOString(),
    });
    const result = {
      id: `cross-check:${sha256(`${productId}:${id}`)}`,
      productId,
      manufacturerUrl: url,
      evidenceId: id,
      checkedAt: new Date().toISOString(),
      sourceAuthority:
        isTrustedManufacturer(product, url, this.manufacturerRegistry) &&
        isTrustedManufacturer(
          product,
          capture.finalUrl || capture.snapshot.url,
          this.manufacturerRegistry
        )
          ? 'manufacturer'
          : 'unverified-source',
      ...crossCheck(product, manufacturer),
    };
    await this.store.put('cross-check', result);
    product.crossChecks = [
      ...(product.crossChecks || []).filter((check) => check.id !== result.id),
      result,
    ];
    product.evidenceIds.push(id);
    await this.store.put(
      'product',
      validateProduct(reconcileManufacturer(product, manufacturer, result))
    );
    return result;
  }

  async review(productId, field, value, evidenceId) {
    const allowed = [
      'category',
      'brand',
      'netMassG',
      'netVolumeMl',
      'packCount',
      'servingMassG',
      'proteinPer100g',
      'sugarPer100g',
      'fatPer100g',
      'saturatedFatPer100g',
      'kcalPer100g',
      'ingredients',
    ];
    if (!allowed.includes(field)) {
      throw new Error('Unsupported review field');
    }
    const product = await this.store.get('product', productId);
    if (!product || !product.evidenceIds.includes(evidenceId)) {
      throw new Error('Review must refer to evidence attached to this product');
    }
    if (
      product[field] !== undefined &&
      JSON.stringify(product[field]) !== JSON.stringify(value)
    ) {
      product.corrections ||= [];
      product.corrections.push({
        field,
        previous: product[field],
        corrected: value,
        evidenceId,
        sourceUrl: product.url,
        correctedAt: new Date().toISOString(),
        reason:
          'Visual evidence review; manufacturer verification remains separate',
      });
    }
    product[field] = value;
    product.reviewedFields = [
      ...new Set([...(product.reviewedFields || []), field]),
    ];
    product.claims.push({
      field,
      value,
      evidenceId,
      source: 'manual-review',
      confidence: 1,
      requiresReview: false,
      reviewedAt: new Date().toISOString(),
    });
    return this.store.put('product', validateProduct(product));
  }

  async delivery(
    url,
    {
      province = 'Khánh Hòa',
      locality = 'Phường Nha Trang',
      refresh = false,
    } = {}
  ) {
    this.assertMarket(url);
    if (this.market !== 'vn') {
      throw new Error(
        'Public delivery estimates currently support the Vietnam market'
      );
    }
    const result = await captureDelivery(this.collector, url, {
      province,
      locality,
      refresh,
    });
    if (result.error) {
      throw new Error(
        `Public delivery estimate unavailable (${result.status}): ${result.error}`
      );
    }
    await this.store.put('evidence', {
      id: result.evidenceId,
      role: 'delivery',
      url,
      observedAt: result.observedAt,
      html: result.html,
      screenshot: result.screenshot,
      screenshots: result.screenshots,
      screenshotMode: result.screenshotMode,
      text: result.text,
      shippingQuantity: result.shippingQuantity,
      shippingDestination: result.shippingDestination,
    });
    const { offer } = parseProduct(result.snapshot, {
      currency: MARKETS[this.market].currency,
    });
    const recorded = await this.store.get('offer', offer.id);
    if (!recorded || recorded.sku !== offer.sku) {
      return {
        ...result,
        applied: false,
        reason:
          'Collect this selected variant before applying its delivery estimate',
      };
    }
    if (!Number.isFinite(result.shipping)) {
      if (/không thể giao|cannot.*deliver/iu.test(result.text)) {
        await this.quote(offer.id, {
          deliveryAvailable: false,
          deliveryArea: this.deliveryArea,
          shippingDestination: result.shippingDestination,
          quoteEvidenceId: result.evidenceId,
        });
      }
      return {
        ...result,
        applied: false,
        reason: 'The public page returned no shipping amount',
      };
    }
    await this.quote(offer.id, {
      shipping: result.shipping,
      shippingQuantity: 1,
      shippingDestination: result.shippingDestination,
      deliveryArea: this.deliveryArea,
      quoteEvidenceId: result.evidenceId,
    });
    return { ...result, applied: true, offerId: offer.id };
  }

  async quote(offerId, input) {
    const offer = await this.store.get('offer', offerId);
    if (!offer) {
      throw new Error('Unknown offer');
    }
    const allowed = [
      'shipping',
      'discount',
      'stock',
      'minQuantity',
      'maxQuantity',
      'coldChainConfirmed',
      'variantConfirmed',
      'deliveryArea',
      'bulkTiers',
      'shippingQuantity',
      'shippingDestination',
      'quoteEvidenceId',
      'deliveryAvailable',
      'quoteObservedAt',
    ];
    if (Object.keys(input).some((key) => !allowed.includes(key))) {
      throw new Error('Unsupported quote field');
    }
    const updated = validateOffer({
      ...offer,
      ...input,
      quoteObservedAt: input.quoteObservedAt || new Date().toISOString(),
    });
    return this.saveOffer(updated);
  }

  async compare(options = {}) {
    const products = await catalogProducts(this.store);
    const offers = (await this.store.list('offer')).filter(
      (offer) => !offer.supersededBy
    );
    const invalidated = [];
    for (const entry of await this.store.list('invalidation')) {
      for (const id of entry.cacheIds) {
        const source = await this.store.get('cache', id);
        if (source?.invalidatedAt) {
          invalidated.push(source);
        }
      }
    }
    for (const offer of offers) {
      offer.priceInvalidated = invalidated.some(
        (source) =>
          source.url === offer.url && /^(?:lazada|page):/u.test(source.id)
      );
      offer.shippingInvalidated = invalidated.some(
        (source) =>
          source.url === offer.url && source.id.startsWith('delivery:')
      );
    }
    for (const product of products) {
      product.specificationsInvalidated = invalidated.some(
        (source) =>
          source.url === product.url ||
          product.crossChecks?.some(
            (check) => check.manufacturerUrl === source.url
          )
      );
    }
    return compareOffers(products, offers, {
      currency: MARKETS[this.market].currency,
      deliveryArea: this.deliveryArea,
      flavourScope: this.flavourScope,
      ...options,
    });
  }

  async close() {
    await this.collector.close?.();
  }
}
