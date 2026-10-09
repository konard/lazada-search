import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  DoubletGraph,
  EvidenceCache,
  DomainScheduler,
  BrowserCollector,
  classifyPage,
  categoryOf,
  volumeMillilitres,
  calculateOffer,
  parseTsv,
  extractNutrition,
  crossCheck,
  compareOffers,
  LazadaSearch,
  captureDelivery,
} from '../src/index.js';
import { parseArguments } from '../src/config.js';
import { parseProduct, validateProduct } from '../src/products.js';

const data = JSON.parse(
  await readFile(new URL('./fixtures/products.json', import.meta.url), 'utf8')
);
const options = { now: Date.parse('2026-10-09T09:00:00Z'), currency: 'VND' };
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

test('associative storage preserves Unicode, nested values, inverse links and repairs a corrupt binary projection', async (t) => {
  const store = await temporary(t);
  const record = {
    id: 'sô cô la',
    ingredients: ['milk', 'cocoa'],
    raw: '\n"a\'b":\t%',
    details: { sugar: 3, reviewed: false, missing: null },
  };
  await store.put('product', record);
  assert.deepEqual(
    await new AssociativeStore({ directory: store.directory }).get(
      'product',
      record.id
    ),
    record
  );
  const graph = await store.graph('product', record.id);
  const owner = graph.names.get(`record:product:${record.id}`);
  assert.ok(graph.query({ source: owner }).length > 5);
  const milk = graph.names.get('string:milk');
  assert.equal(
    graph.query({ target: milk }).filter((link) => link.source !== milk).length,
    1
  );
  assert.ok(graph.toNotation().includes('atom-'));
  assert.deepEqual(
    DoubletGraph.fromBinary(graph.toBinary()).links,
    graph.links
  );
  await writeFile(
    store.recordPath('product', record.id).replace('.lino', '.links'),
    'broken'
  );
  assert.deepEqual(
    (await store.graph('product', record.id)).links,
    graph.links
  );
  assert.equal(
    (await store.list('product', { path: 'details/sugar', value: 3 })).length,
    1
  );
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      store.put('evidence', { id: String(index), productId: record.id })
    )
  );
  assert.equal((await store.list('evidence')).length, 10);
  const blob = await store.putBlob('a label');
  assert.deepEqual(await store.putBlob('a label'), blob);
  assert.equal((await store.blob(blob.sha256)).toString(), 'a label');
});

test('cache coalesces downloads, respects TTL, revalidates and supports offline reads', async (t) => {
  const store = await temporary(t);
  let now = 1000,
    requests = 0;
  const cache = new EvidenceCache({
    store,
    now: () => now,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const load = async () => {
    requests += 1;
    return { snapshot: { title: 'whey' } };
  };
  await Promise.all([
    cache.get('https://www.lazada.vn/products/x?spm=a&skuId=12', {
      ttlMs: 100,
      load,
    }),
    cache.get('https://www.lazada.vn/products/x?skuId=12', {
      ttlMs: 100,
      load,
    }),
  ]);
  assert.equal(requests, 1);
  now += 50;
  assert.equal(
    (
      await cache.get('https://www.lazada.vn/products/x?skuId=12', {
        ttlMs: 100,
        load,
      })
    ).cacheHit,
    true
  );
  now += 100;
  const refreshed = await cache.get(
    'https://www.lazada.vn/products/x?skuId=12',
    { ttlMs: 100, load: async () => ({ notModified: true }) }
  );
  assert.equal(refreshed.fetchedAt, 1000);
  assert.equal(refreshed.checkedAt, 1150);
  cache.offline = true;
  now = 10000;
  assert.equal(
    (
      await cache.get('https://www.lazada.vn/products/x?skuId=12', {
        ttlMs: 100,
      })
    ).stale,
    true
  );
  await assert.rejects(
    cache.get('https://www.lazada.vn/products/new'),
    /Offline cache miss/u
  );
});

test('failed public delivery attempts are cached and do not repeat navigation', async (t) => {
  const store = await temporary(t);
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  let navigations = 0;
  const collector = {
    store,
    cache,
    tail: Promise.resolve(),
    start: async () => {},
    commander: {
      goto: async () => {
        navigations++;
        throw new Error('Public page unavailable');
      },
    },
  };
  const destination = { province: 'Khánh Hòa', locality: 'Phường Nha Trang' };
  const url = 'https://www.lazada.vn/products/unavailable.html';
  const first = await captureDelivery(collector, url, destination);
  assert.equal(first.status, 'unavailable');
  assert.match(first.error, /Public page unavailable/u);
  assert.equal(
    (await captureDelivery(collector, url, destination)).cacheHit,
    true
  );
  assert.equal(navigations, 1);
  assert.equal(cache.stats.downloads, 1);
});

test('nutrition handles serving conversions, refuses mixed columns and never treats ml as grams', () => {
  assert.throws(
    () => parseTsv('Plain OCR text from a missing TSV configuration'),
    /did not return TSV/u
  );
  const nutrition = extractNutrition(
    'Net weight: 1 kg\nServing size: 30 g\nAmount per serving\nProtein 24 g\nSugar 1.5 g\nEnergy 120 kcal\nIngredients: whey protein isolate, cocoa'
  );
  assert.equal(nutrition.fields.proteinPer100g, 80);
  assert.equal(nutrition.fields.sugarPer100g, 5);
  assert.equal(nutrition.fields.netMassG, 1000);
  assert.deepEqual(
    extractNutrition('Thành phần\nWhey protein isolate, sunflower lecithin')
      .fields.ingredients,
    ['Whey protein isolate', 'sunflower lecithin']
  );
  assert.equal(
    extractNutrition('Per 100 ml\nProtein 12 g').fields.proteinPer100g,
    undefined
  );
  assert.equal(
    extractNutrition('Per 100 g\nPer serving\nProtein 12 g').fields
      .proteinPer100g,
    undefined
  );
  assert.equal(
    extractNutrition('Protein 90 g').fields.proteinPer100g,
    undefined
  );
  assert.equal(
    extractNutrition('Per 100 g\nProtein 900 g').fields.proteinPer100g,
    undefined
  );
  assert.throws(
    () => validateProduct({ ...data.products[0], proteinPer100g: 101 }),
    /Implausible/u
  );
});

test('bulk prices, order coupons and shipping change the cheapest product correctly', () => {
  const report = compareOffers(
    data.products.map(validateProduct),
    data.offers,
    { ...options, category: 'whey', quantity: 10, discount: 50000 }
  );
  assert.equal(report.ranked[0].product.id, 'whey-isolate');
  assert.equal(report.ranked[0].metrics.totalCost, 2480000);
  assert.equal(report.ranked[0].metrics.totalProteinG, 8000);
  assert.equal(report.ranked[0].metrics.costPer25gProtein, 7750);
  assert.equal(report.bestByCategory.whey.product.id, 'whey-isolate');
  assert.equal(
    compareOffers(data.products, data.offers, {
      ...options,
      category: 'whey',
      quantity: 1,
    }).ranked[0].product.id,
    'whey-isolate'
  );
  const filtered = compareOffers(
    data.products.map(validateProduct),
    data.offers,
    { ...options, category: 'whey', excludeIngredients: ['sucralose'] }
  );
  assert.equal(filtered.ranked[0].product.id, 'whey-concentrate');
});

test('mass, volume and protein costs stay separate before and after order delivery', () => {
  const product = {
    ...data.products[0],
    category: 'chocolate-ice-cream',
    netMassG: 500,
    netVolumeMl: 860,
    proteinPer100g: 5,
    packCount: 2,
  };
  const offer = {
    ...data.offers[0],
    price: 100000,
    bulkTiers: [],
    shipping: 30000,
    coldChainConfirmed: true,
  };
  const row = calculateOffer(product, offer, {
    ...options,
    quantity: 10,
    discount: 50000,
  });
  const m = row.metrics;
  assert.equal(m.merchandiseSubtotal, 1000000);
  assert.equal(m.totalBeforeDelivery, 950000);
  assert.equal(m.totalAfterDelivery, 980000);
  assert.equal(m.totalMassG, 10000);
  assert.equal(m.totalVolumeMl, 17200);
  assert.equal(m.totalProteinG, 500);
  assert.equal(m.costPerGramBeforeDelivery, 95);
  assert.equal(m.costPerGramAfterDelivery, 98);
  assert.equal(m.costPerMlBeforeDelivery, 950000 / 17200);
  assert.equal(m.costPerMlAfterDelivery, 980000 / 17200);
  assert.equal(m.costPerProteinGramBeforeDelivery, 1900);
  assert.equal(m.costPerProteinGramAfterDelivery, 1960);
  assert.equal(m.costPer25gProteinBeforeDelivery, 47500);
  assert.equal(m.costPer25gProteinAfterDelivery, 49000);
  const missing = compareOffers(
    [product],
    [{ ...offer, shipping: undefined }],
    options
  );
  assert.equal(missing.ranked.length, 0);
  assert.equal(missing.comparisons.length, 1);
  assert.equal(missing.comparisons[0].metrics.totalAfterDelivery, null);
  assert.equal(missing.comparisons[0].metrics.costPerMlAfterDelivery, null);
  assert.equal(missing.comparisons[0].metrics.costPerGramBeforeDelivery, 100);
  const singlePackageQuote = calculateOffer(
    product,
    { ...offer, shippingQuantity: 1 },
    { ...options, quantity: 10 }
  );
  assert.equal(singlePackageQuote.metrics.totalAfterDelivery, null);
  assert.ok(
    singlePackageQuote.problems.some((problem) =>
      problem.includes('quoted for 1 packages')
    )
  );
  assert.equal(
    calculateOffer(product, offer, { ...options, shipping: 0 }).metrics
      .totalAfterDelivery,
    100000
  );
  const volumeOnly = calculateOffer(
    { ...product, netMassG: undefined },
    offer,
    options
  ).metrics;
  assert.equal(volumeOnly.costPerGramBeforeDelivery, null);
  assert.equal(volumeOnly.costPerProteinGramBeforeDelivery, null);
  assert.equal(volumeOnly.costPerMlBeforeDelivery, 100000 / 1720);
});

test('public titles distinguish food quantities from packet counts, protein claims and cosmetics', () => {
  assert.equal(
    categoryOf('Kem dưỡng ẩm cho bé Protein Whey da khô'),
    'unknown'
  );
  assert.equal(
    categoryOf('TÚI 6 THANH SOCOLA SỮA BỌC KEM SỮA Kinder Milk Chocolate Bars'),
    'unknown'
  );
  const title = '18 gói dùng khi di chuyển - 22g protein whey isolate';
  const product = parseProduct({
    url: 'https://www.lazada.vn/products/test.html',
    title,
  }).product;
  assert.equal(product.netMassG, undefined);
  assert.equal(
    parseProduct({
      url: 'https://www.lazada.vn/products/test.html',
      title: 'Whey 24g protein / serving 2lbs',
    }).product.netMassG,
    2 * 453.59237
  );
  assert.equal(volumeMillilitres('Kem socola 1,5 l'), 1500);
  assert.equal(volumeMillilitres('2 lần'), undefined);
  assert.equal(extractNutrition('Thể tích: 860 ml').fields.netVolumeMl, 860);
  const ice = parseProduct({
    url: 'https://www.lazada.vn/products/test.html',
    title: 'Kem socola 900ML',
  }).product;
  assert.equal(ice.netVolumeMl, 900);
  assert.equal(ice.netMassG, undefined);
  const powder = parseProduct({
    url: 'https://www.lazada.vn/products/test.html',
    title: 'Whey protein 500g + shaker 600ml',
  }).product;
  assert.equal(powder.netVolumeMl, undefined);
  assert.equal(powder.netMassG, 500);
  assert.equal(
    parseProduct({
      url: 'https://www.lazada.vn/products/test.html',
      title: 'Whey protein',
      selectedVariant: [{ text: 'Gói Share 500gam', selected: true }],
    }).product.netMassG,
    500
  );
  const mismatched = parseProduct({
    url: 'https://www.lazada.vn/products/test.html?skuId=12',
    title: 'Whey 500g',
    sku: '101_VNAMZ-99',
    selectedVariant: [{ text: '500g', selected: true }],
  });
  assert.equal(mismatched.product.sku, '101_VNAMZ-99');
  assert.equal(mismatched.offer.variantConfirmed, false);
  assert.ok(
    mismatched.product.warnings.some((warning) =>
      warning.includes('different SKU')
    )
  );
});

test('unknown shipping, variants, OCR conflicts, stale prices and frozen delivery cannot silently win', () => {
  const powder = validateProduct(data.products[0]);
  const offer = data.offers[0];
  for (const change of [
    { shipping: undefined },
    { variantConfirmed: false },
    { currency: 'USD' },
    { stock: 0 },
    { observedAt: new Date(options.now - 10 * 86400000).toISOString() },
  ]) {
    assert.equal(
      compareOffers([powder], [{ ...offer, ...change }], options).ranked.length,
      0
    );
  }
  const uncertain = {
    ...powder,
    claims: [
      {
        field: 'proteinPer100g',
        value: 80,
        requiresReview: true,
        source: 'ocr',
      },
    ],
  };
  assert.equal(compareOffers([uncertain], [offer], options).ranked.length, 0);
  const conflict = {
    ...powder,
    crossChecks: [{ conflicts: [{ field: 'proteinPer100g' }] }],
  };
  assert.equal(compareOffers([conflict], [offer], options).ranked.length, 0);
  assert.equal(
    compareOffers(
      [data.products[2]],
      [{ ...data.offers[2], coldChainConfirmed: false }],
      options
    ).ranked.length,
    0
  );
  assert.throws(
    () => compareOffers([powder], [offer], { ...options, quantity: -1 }),
    /positive/u
  );
});

test('manufacturer identity needs a GTIN or brand and manufacturer SKU', () => {
  const listing = data.products[0];
  const matched = crossCheck(listing, { ...listing, proteinPer100g: 75 });
  assert.equal(matched.identityMatched, true);
  assert.equal(matched.conflicts[0].field, 'proteinPer100g');
  assert.equal(
    crossCheck(listing, { ...listing, gtin: 'different' }).identityMatched,
    false
  );
  assert.equal(
    crossCheck(
      { manufacturerSku: 'x', brand: 'A' },
      { manufacturerSku: 'x', brand: 'B' }
    ).identityMatched,
    false
  );
});

test('parser preserves SKU identity and rejects an unselected variant price', () => {
  const result = parseProduct({
    url: 'https://www.lazada.vn/products/test-i1.html',
    title: 'Whey isolate 1 kg',
    priceText: '300.000 ₫',
    variants: [{ text: '500g' }, { text: '1kg' }],
    rawText: 'Per 100 g\nProtein 80 g\nIngredients: whey protein concentrate',
  });
  assert.equal(result.offer.price, 300000);
  assert.equal(result.offer.variantConfirmed, false);
  assert.equal(result.product.proteinType, 'concentrate');
  assert.equal(
    categoryOf('KẸO SOCOLA HỖN HỢP KEM SŨA MERCI PETITS ĐỨC 125GR'),
    'unknown'
  );
  assert.equal(categoryOf('Chocolate ice cream molds'), 'unknown');
  assert.equal(categoryOf('Organic soy protein powder 1 kg'), 'unknown');
  assert.equal(
    categoryOf('Kem Nhuộm Tóc Sô cô la Home Chocolate Hair Dye Cream'),
    'unknown'
  );
  assert.equal(
    categoryOf('Tayas Sô Cô La Sữa Nhân Kem Hạnh Nhân 1kg'),
    'unknown'
  );
  assert.equal(
    categoryOf('Kem hộp Celano socola 860ML'),
    'chocolate-ice-cream'
  );
  assert.equal(
    parseProduct({
      url: 'https://www.lazada.vn/products/pdp-i134.html',
      title: 'Whey protein',
      jsonLd: [{ '@type': 'Product', mpn: '134' }],
    }).product.manufacturerSku,
    undefined
  );
});

test('library import rejects broken references before committing; configuration accepts quoted values', async (t) => {
  const store = await temporary(t);
  const app = new LazadaSearch({ store, ocr: false });
  await assert.rejects(
    app.importRecords({
      products: data.products,
      offers: [{ ...data.offers[0], productId: 'missing' }],
    }),
    /Unknown product/u
  );
  assert.equal((await store.list('product')).length, 0);
  await app.importRecords(data);
  assert.equal(
    (await app.compare({ ...options, category: 'whey' })).ranked.length,
    2
  );
  const config = parseArguments([
    'compare',
    '--quantity',
    '10',
    '--delivery-area',
    'Ho Chi Minh City',
    '--offline',
  ]);
  assert.deepEqual(config._, ['compare']);
  assert.equal(config.quantity, 10);
  assert.equal(config.deliveryArea, 'Ho Chi Minh City');
});

test('cached HTML is reprocessed for newer Lazada selectors without navigation or a new observation time', async (t) => {
  const store = await temporary(t);
  const url = 'https://www.lazada.vn/products/v2-i42.html';
  const html = await store.putBlob(
    `<html><body><h1>Whey protein 1 kg</h1><span class="pdp-v2-product-price-content-salePrice-amount">566.555</span><span class="seller-name-v2__detail-name">Observed seller</span><div class="item-gallery-v2"><img src="//img.lazcdn.com/label.jpg_80x80q80.jpg_.webp"></div><figure itemprop="associatedMedia"><img src="//img.lazcdn.com/label.jpg_720x720q80.jpg_.webp"></figure><span class="sku-variable-name-selected">Chocolate</span></body></html>`
  );
  await store.put('cache', {
    id: `page:${url}`,
    url,
    fetchedAt: 1000,
    checkedAt: 1000,
    snapshot: {
      url,
      title: 'Whey protein 1 kg',
      rawText: 'Original rendered text',
    },
    html,
    status: 'ok',
  });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({ store, offline: true }),
  });
  collector.capture = () => {
    throw new Error('No navigation allowed');
  };
  const result = await collector.page(url);
  assert.equal(result.snapshot.priceText, '566.555');
  assert.equal(result.snapshot.seller, 'Observed seller');
  assert.deepEqual(result.snapshot.productImages, [
    'https://img.lazcdn.com/label.jpg_720x720q80.jpg_.webp',
  ]);
  assert.equal(result.snapshot.selectedVariant[0].text, 'Chocolate');
  assert.equal(result.snapshot.rawText, 'Original rendered text');
  assert.equal(result.fetchedAt, 1000);
  assert.equal(result.cacheHit, true);
  assert.equal(
    classifyPage({
      title: 'PDP',
      url: 'https://pages.lazada.vn/pdp-web-redirect-app',
      rawText: '',
    }),
    'app-only'
  );
});

test('a bounded crawl gives each query a share of the detail-page budget', async (t) => {
  const store = await temporary(t);
  const visited = [];
  const app = new LazadaSearch({
    store,
    ocr: false,
    collector: {
      page: async (url) => ({
        id: url,
        status: 'ok',
        fetchedAt: Date.now(),
        snapshot: {
          cards: new URL(url).searchParams.get('q').includes('whey')
            ? [1, 2, 3].map((id) => ({
                title: `Whey protein ${id}`,
                url: `https://www.lazada.vn/products/whey-i${id}.html`,
              }))
            : [
                {
                  title: 'Chocolate ice cream',
                  url: 'https://www.lazada.vn/products/ice-i4.html',
                },
              ],
        },
      }),
    },
  });
  app.collect = async (url) => {
    visited.push(url);
    return { product: { id: url }, cacheHit: false };
  };
  const report = await app.crawl({
    queries: ['whey protein', 'kem chocolate'],
    maxPages: 1,
    maxProducts: 2,
  });
  assert.deepEqual(visited, [
    'https://www.lazada.vn/products/whey-i1.html',
    'https://www.lazada.vn/products/ice-i4.html',
  ]);
  assert.equal(report.pages.length, 2);
  assert.equal(report.discovered, 4);
  assert.equal(report.complete, false);
  await store.put('product', {
    id: 'known',
    title: 'Whey protein',
    category: 'whey',
    url: visited[0],
  });
  visited.length = 0;
  const resumed = await app.crawl({
    queries: ['whey protein', 'kem chocolate'],
    maxPages: 1,
    maxProducts: 2,
  });
  assert.deepEqual(visited, [
    'https://www.lazada.vn/products/whey-i2.html',
    'https://www.lazada.vn/products/ice-i4.html',
  ]);
  assert.equal(resumed.uncollected, 1);
});
