import { AssociativeStore } from './store.js';
import { EvidenceCache, evidenceId } from './cache.js';
import { BrowserCollector } from './browser.js';
import { TesseractOcr } from './ocr.js';
import { parseProduct, validateOffer, validateProduct } from './products.js';
import { categoryOf, crossCheck, extractNutrition } from './nutrition.js';
import { compareOffers } from './compare.js';
import { captureDelivery } from './delivery.js';
import { canonicalUrl, positive, sha256 } from './util.js';

export const MARKETS = {
  vn: {
    host: 'www.lazada.vn',
    currency: 'VND',
    queries: ['whey protein', 'whey isolate', 'kem chocolate', 'kem sô cô la'],
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
    maxImages = 40,
    offline = false,
    browserOptions,
    scheduler,
  } = {}) {
    if (!MARKETS[market]) {
      throw new Error('Unsupported Lazada market');
    }
    positive(maxImages, 'maxImages', { zero: true, integer: true });
    this.store = store;
    this.cache = cache || new EvidenceCache({ store, offline, scheduler });
    this.collector =
      collector ||
      new BrowserCollector({ cache: this.cache, store, browserOptions });
    this.ocr = ocr === false ? undefined : ocr || new TesseractOcr({ store });
    this.market = market;
    this.deliveryArea = deliveryArea;
    this.maxImages = maxImages;
  }

  assertMarket(url) {
    const host = new URL(url).hostname.replace(/^www\./u, '');
    if (host !== MARKETS[this.market].host.replace(/^www\./u, '')) {
      throw new Error(
        `Product URL must belong to Lazada market ${this.market}`
      );
    }
  }

  async importRecords({ products = [], offers = [] }) {
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
    for (const product of validProducts) {
      await this.store.put('product', product);
    }
    for (const offer of validOffers) {
      await this.saveOffer(offer);
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

  async collect(url, { refresh = false } = {}) {
    this.assertMarket(url);
    const capture = await this.collector.page(canonicalUrl(url), {
      refresh,
      namespace: `lazada:${this.market}:${this.deliveryArea}`,
    });
    if (capture.status !== 'ok') {
      throw new Error(`Collection stopped: ${capture.status} at ${url}`);
    }
    this.assertMarket(capture.finalUrl || capture.snapshot.url);
    const id = evidenceId(
      capture.snapshot.url,
      Buffer.from(JSON.stringify(capture.snapshot))
    );
    await this.store.put('evidence', {
      id,
      url: capture.snapshot.url,
      role: 'listing',
      observedAt: new Date(capture.fetchedAt).toISOString(),
      html: capture.html,
      screenshot: capture.screenshot,
      cacheId: capture.id,
    });
    const { product, offer } = parseProduct(capture.snapshot, {
      market: this.market,
      currency: MARKETS[this.market].currency,
      evidenceId: id,
      observedAt: new Date(capture.fetchedAt).toISOString(),
    });
    const previous = await this.store.get('product', product.id);
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
      product.reviewedFields =
        previous.observedAt === product.observedAt
          ? previous.reviewedFields || []
          : [];
      for (const field of product.reviewedFields) {
        product[field] = previous[field];
      }
    }
    await this.collectOcr(product, capture);
    const validated = validateProduct(product);
    await this.store.put('product', validated);
    // A destination-specific shipping quote expires with the price snapshot.
    const previousOffer = await this.store.get('offer', offer.id);
    const savedOffer =
      previousOffer?.observedAt === offer.observedAt &&
      previousOffer?.evidenceId === offer.evidenceId
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
        older.productId === savedOffer.productId &&
        older.url === savedOffer.url &&
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

  async collectOcr(product, capture) {
    if (!this.ocr) {
      product.warnings.push('OCR disabled');
      return;
    }
    const allImages =
      capture.snapshot.productImages || capture.snapshot.images || [];
    const selected = allImages.slice(0, this.maxImages);
    product.ocrCoverage = {
      discovered: allImages.length,
      attempted: selected.length + Number(Boolean(capture.screenshot)),
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
          refresh: !capture.cacheHit && !this.cache.offline,
        });
        await recognize(image.blob, imageUrl);
      } catch (error) {
        product.ocrCoverage.failed += 1;
        product.warnings.push(
          `Image unavailable: ${imageUrl}: ${error.message}`
        );
      }
    }
    if (capture.screenshot) {
      await recognize(capture.screenshot, capture.snapshot.url);
    }
    product.evidenceIds = [...new Set(product.evidenceIds)];
    product.claims = [
      ...new Map(
        product.claims.map((claim) => [JSON.stringify(claim), claim])
      ).values(),
    ];
    product.warnings = [...new Set(product.warnings)];
  }

  async crawl({
    queries = MARKETS[this.market].queries,
    maxPages = 5,
    maxProducts = 100,
    refresh = false,
  } = {}) {
    positive(maxPages, 'maxPages', { integer: true });
    positive(maxProducts, 'maxProducts', { integer: true });
    const report = {
      id: `crawl:${new Date().toISOString()}`,
      market: this.market,
      deliveryArea: this.deliveryArea,
      queries,
      pages: [],
      products: [],
      failures: [],
      coverage: 'bounded-search',
      complete: false,
      cache: {},
    };
    const discovered = new Set();
    const knownUrls = new Set(
      (await this.store.list('product')).map((product) => product.url)
    );
    const queryQueues = [];
    let stopped = false;
    for (const query of queries) {
      const queue = [];
      queryQueues.push(queue);
      let url = `https://${MARKETS[this.market].host}/catalog/?q=${encodeURIComponent(query)}`;
      for (let index = 0; index < maxPages && !stopped; index += 1) {
        try {
          const page = await this.collector.page(url, {
            namespace: `search:${this.market}:${this.deliveryArea}`,
            refresh,
          });
          report.pages.push({
            url,
            status: page.status,
            cacheHit: page.cacheHit,
          });
          await this.store.put('crawl-page', {
            id: url,
            query,
            cacheId: page.id,
            observedAt: new Date(page.fetchedAt).toISOString(),
            status: page.status,
          });
          if (page.status !== 'ok') {
            stopped = true;
            break;
          }
          let added = 0;
          for (const card of page.snapshot.cards || []) {
            if (categoryOf(card.title) === 'unknown') {
              continue;
            }
            let productUrl;
            try {
              productUrl = canonicalUrl(card.url);
              this.assertMarket(productUrl);
            } catch {
              continue;
            }
            if (
              !new URL(productUrl).pathname.includes('/products/') ||
              discovered.has(productUrl)
            ) {
              continue;
            }
            discovered.add(productUrl);
            queue.push(productUrl);
            added += 1;
          }
          if (
            !added ||
            queue.filter((entry) => !knownUrls.has(entry)).length >= maxProducts
          ) {
            break;
          }
          const next =
            page.snapshot.nextUrl ||
            (() => {
              const nextUrl = new URL(url);
              nextUrl.searchParams.set('page', String(index + 2));
              return nextUrl.href;
            })();
          this.assertMarket(next);
          url = canonicalUrl(next);
        } catch (error) {
          report.failures.push({ url, error: error.message });
          break;
        }
      }
      if (stopped) {
        break;
      }
    }
    // Round-robin the queries so a large whey result page cannot consume the
    // entire detail-page budget before an ice-cream query is considered.
    const selected = [];
    for (const revisit of [false, true]) {
      const queues = queryQueues.map((queue) =>
        queue.filter((entry) => knownUrls.has(entry) === revisit)
      );
      for (let index = 0; selected.length < maxProducts; index += 1) {
        const round = queues.map((queue) => queue[index]).filter(Boolean);
        if (!round.length) {
          break;
        }
        selected.push(...round.slice(0, maxProducts - selected.length));
      }
    }
    for (const url of selected) {
      try {
        const collected = await this.collect(url, { refresh });
        report.products.push({
          id: collected.product.id,
          url,
          cacheHit: collected.cacheHit,
        });
        knownUrls.add(url);
      } catch (error) {
        report.failures.push({ url, error: error.message });
        if (/challenge|login/iu.test(error.message)) {
          break;
        }
      }
    }
    report.discovered = discovered.size;
    report.uncollectedUrls = [...discovered].filter(
      (url) => !knownUrls.has(url)
    );
    report.uncollected = report.uncollectedUrls.length;
    report.stopReason = stopped
      ? 'challenge-or-login'
      : discovered.size >= maxProducts
        ? 'product-limit'
        : 'search-ended-or-page-limit';
    report.cache = { ...this.cache.stats };
    await this.store.put('crawl', report);
    return report;
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
      observedAt: new Date(capture.fetchedAt).toISOString(),
    });
    const result = {
      id: `cross-check:${sha256(`${productId}:${id}`)}`,
      productId,
      manufacturerUrl: url,
      evidenceId: id,
      ...crossCheck(product, manufacturer),
    };
    await this.store.put('cross-check', result);
    product.crossChecks = [
      ...(product.crossChecks || []).filter((check) => check.id !== result.id),
      result,
    ];
    product.evidenceIds.push(id);
    if (result.identityMatched) {
      for (const claim of manufacturer.claims) {
        product.claims.push(claim);
        if (product[claim.field] === undefined && !claim.requiresReview) {
          product[claim.field] = claim.value;
        }
      }
    }
    await this.store.put('product', validateProduct(product));
    return result;
  }

  async review(productId, field, value, evidenceId) {
    const allowed = [
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
    ];
    if (Object.keys(input).some((key) => !allowed.includes(key))) {
      throw new Error('Unsupported quote field');
    }
    const updated = validateOffer({
      ...offer,
      ...input,
      quoteObservedAt: new Date().toISOString(),
    });
    return this.saveOffer(updated);
  }

  async compare(options = {}) {
    return compareOffers(
      await this.store.list('product'),
      (await this.store.list('offer')).filter((offer) => !offer.supersededBy),
      {
        currency: MARKETS[this.market].currency,
        deliveryArea: this.deliveryArea,
        ...options,
      }
    );
  }

  async close() {
    await this.collector.close?.();
  }
}
