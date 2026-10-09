import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHTML } from 'linkedom';
import {
  extractPage,
  classifyPage,
  categoryOf,
  auditCoverage,
  assertCompleteCoverage,
  specificationProblems,
  reconcileManufacturer,
  calculateOffer,
  isTrustedManufacturer,
  LazadaSearch,
  AssociativeStore,
  EvidenceCache,
  DomainScheduler,
  REQUIRED_SPEC_FIELDS,
} from '../src/index.js';
import { extractNutrition, splitIngredients } from '../src/nutrition.js';
import { executeCommand } from '../src/commands.js';

const data = JSON.parse(
  await readFile(new URL('./fixtures/products.json', import.meta.url), 'utf8')
);
const fixture = data.products[0];
const now = Date.parse('2026-10-09T09:00:00Z');
const completeScope = {
  visibleSearchComplete: true,
  globalCoverage: 'unverifiable-with-public-search',
  scopes: [{ query: 'whey', terminalConfirmed: true }],
  uncollectedUrls: [],
  failures: [],
};

test('a newer complete crawl supersedes an older cached audit irrespective of ID prefixes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-audit-order-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  await store.put('crawl', {
    id: 'crawl:cached-audit:2026-10-09T08:00:00Z',
    scopes: [{ query: 'old', terminalConfirmed: false }],
  });
  await store.put('crawl', {
    id: 'crawl:2026-10-09T09:00:00Z',
    scopes: [{ query: 'new', terminalConfirmed: false }],
  });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  assert.equal((await app.audit()).unfinishedSearches[0].query, 'new');
  await app.close();
});

test('a newly captured page reuses a previously seen label without revalidating its URL', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-shared-label-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const url = 'https://manufacturer.example/shared-label.png';
  const blob = await store.putBlob(Buffer.from('cached-image-fixture'));
  await cache.get(url, {
    namespace: 'image',
    load: async () => ({ blob, contentType: 'image/png' }),
  });
  let requests = 0;
  const image = cache.image.bind(cache);
  cache.image = (url, options) =>
    image(url, {
      ...options,
      fetchImage: async () => {
        requests++;
        throw new Error('Already-seen labels must not cause a network request');
      },
    });
  let recognitions = 0;
  const app = new LazadaSearch({
    store,
    cache,
    ocr: {
      recognize: async () => {
        recognitions++;
        return {
          id: 'label-fixture',
          text: 'Protein 80 g',
          confidence: 1,
          psm: 6,
        };
      },
    },
  });
  const product = {
    id: 'label-product',
    ingredients: [],
    claims: [],
    evidenceIds: [],
    warnings: [],
  };
  await app.collectOcr(product, {
    cacheHit: false,
    snapshot: { url: fixture.url, productImages: [url] },
  });
  assert.equal(requests, 0);
  assert.equal(recognitions, 1);
  assert.equal(cache.stats.hits, 1);
  assert.equal(product.ocrCoverage.failed, 0);
  await app.close();
});

test('Lazada challenge redirects are classified even when the title is blank', () => {
  assert.equal(
    classifyPage({
      url: 'https://www.lazada.vn/products/pdp-i1.html/_____tmd_____/punish?token=fixture',
      title: '',
      rawText: 'Click to feedback >',
    }),
    'challenge'
  );
});

test('official product galleries keep full-size labels and skip recommendation cards', () => {
  const { document } = parseHTML(
    '<html><body><div class="product-images"><img src="/front.jpg"></div><div class="product-thumb"><a data-image="/label-master.jpg"><img src="/label-small.jpg"></a></div><div class="product-information__media"><img src="/official-panel.jpg"></div><div class="resource-card"><img src="/unrelated.jpg"></div></body></html>'
  );
  const page = extractPage({
    document,
    url: 'https://manufacturer.example/product',
  });
  assert.deepEqual(page.productImages, [
    'https://manufacturer.example/front.jpg',
    'https://manufacturer.example/label-master.jpg',
    'https://manufacturer.example/official-panel.jpg',
  ]);
});

test('an absent SKU inventory is a completeness gap even when one selected offer is priced', () => {
  const report = auditCoverage({
    crawl: completeScope,
    products: [fixture],
    offers: [data.offers[0]],
  });
  assert.equal(report.unknownSkuInventories.length, 1);
  assert.equal(report.visibleSearchComplete, false);
});

test('real Lazada pagination and search-card SKU/price remain distinct from product prices', () => {
  const { document } = parseHTML(
    '<html><body>Tìm thấy 2.370 sản phẩm<div data-product-card data-sku-simple="101_VNAMZ-11"><a href="/products/pdp-i101.html">Whey protein</a><span class="ooOxS">300.000 ₫</span></div><ul class="ant-pagination"><li class="ant-pagination-item-active ant-pagination-item">2</li><li class="ant-pagination-item">60</li><li class="ant-pagination-next" aria-disabled="false"><button></button></li></ul></body></html>'
  );
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/catalog/?q=whey&page=2',
  });
  assert.equal(snapshot.cards[0].sku, '101_VNAMZ-11');
  assert.equal(snapshot.cards[0].priceText, '300.000 ₫');
  assert.equal(snapshot.searchCoverage.reportedTotal, 2370);
  assert.equal(snapshot.searchCoverage.lastPage, 60);
  assert.equal(snapshot.searchCoverage.terminalConfirmed, false);
  document
    .querySelector('.ant-pagination-next')
    .setAttribute('aria-disabled', 'true');
  assert.equal(
    extractPage({ document, url: snapshot.url }).searchCoverage
      .terminalConfirmed,
    true
  );
});

test('public module JSON inventories all SKU combinations without executing scripts or assigning the selected price to others', () => {
  const module = { data: { root: { fields: {} } } };
  module.data.root.fields.productOption = {
    skuBase: {
      properties: [
        {
          pid: '1',
          name: 'Flavour',
          values: [
            { vid: 'C', name: 'Chocolate' },
            { vid: 'V', name: 'Vanilla' },
          ],
        },
      ],
      skus: [
        {
          skuId: '11',
          pagePath: '/products/pdp-i101.html?skuId=11',
          propPath: '1:C',
        },
        {
          skuId: '12',
          pagePath: '/products/pdp-i101.html?skuId=12',
          propPath: '1:V',
        },
      ],
    },
  };
  module.data.root.fields.skuInfos = {
    11: { operation: { disable: false } },
    12: { operation: { disable: true } },
  };
  const { document } = parseHTML(
    `<body><div data-product-price>300.000 ₫</div><script>var __moduleData__ = ${JSON.stringify(module)}; globalThis.mustNotExecute = true;</script></body>`
  );
  const snapshot = extractPage({ document, url: fixture.url });
  assert.equal(snapshot.skuCatalog.length, 2);
  assert.equal(snapshot.skuCatalogObserved, true);
  assert.deepEqual(snapshot.skuCatalog[1].options, [
    { name: 'Flavour', value: 'Vanilla' },
  ]);
  assert.equal(snapshot.skuCatalog[1].available, false);
  assert.equal(snapshot.skuCatalog[1].price, undefined);
  assert.equal(globalThis.mustNotExecute, undefined);
});

test('ingredient extraction preserves decimal percentages and nested additive lists and skips navigation labels', () => {
  assert.deepEqual(
    splitIngredients(
      'Sữa (40 %), Đường (5,8 %), Chất làm dày (1401, 1442, 418(i)), Hương liệu'
    ),
    [
      'Sữa (40 %)',
      'Đường (5,8 %)',
      'Chất làm dày (1401, 1442, 418(i))',
      'Hương liệu',
    ]
  );
  assert.deepEqual(
    extractNutrition(
      'Ingredients\nAllergy\nIngredients:\nWhey Protein Isolate, Sunflower Lecithin (less than 2%)'
    ).fields.ingredients,
    ['Whey Protein Isolate', 'Sunflower Lecithin (less than 2%)']
  );
  const nutrients = extractNutrition(
    'Per 100 g\nProtein 80 g\nTotal Fat 2 g\nSaturated Fat 1 g'
  );
  assert.equal(nutrients.fields.fatPer100g, 2);
  assert.equal(nutrients.fields.saturatedFatPer100g, 1);
});

for (const title of [
  'Kem khoai môn socola - Aice -Haidilao',
  'Kem Aice Cà Phê Socola Giòn',
  'Kem sô-cô-la giòn que',
]) {
  test(`chocolate ice-cream coverage includes ${title}`, () =>
    assert.equal(categoryOf(title), 'chocolate-ice-cream'));
}
for (const title of [
  'Organic soy protein powder 1 kg',
  'Plant protein powder 1 kg',
  'Casein protein powder',
]) {
  test(`protein powder coverage includes ${title}`, () =>
    assert.equal(categoryOf(title), 'protein-powder'));
}
for (const title of [
  'Chocolate ice cream molds',
  'KẸO SOCOLA HỖN HỢP KEM SŨA MERCI PETITS ĐỨC 125GR',
  'Kem Nhuộm Tóc Socola Hair Dye',
  'Collagen protein powder',
]) {
  test(`unrelated search result stays outside food categories: ${title}`, () =>
    assert.equal(categoryOf(title), 'unknown'));
}

test('one missing listing fails the coverage contract and strict CLI audit', async (t) => {
  const report = auditCoverage({
    crawl: { ...completeScope, uncollectedUrls: [fixture.url] },
  });
  assert.deepEqual(report.missingListings, [fixture.url]);
  assert.equal(report.complete, false);
  assert.throws(() => assertCompleteCoverage(report), /1 missing listings/u);
  const directory = await mkdtemp(join(tmpdir(), 'lazada-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  await assert.rejects(
    executeCommand(app, 'audit', [], { strict: true }),
    /Incomplete catalog/u
  );
});

test('every SKU price is required, including unavailable variants; a listing-level price is insufficient', () => {
  const product = { ...fixture, sku: '101_VNAMZ-11' };
  const offers = [{ ...data.offers[0], sku: '101_VNAMZ-11' }];
  const report = auditCoverage({
    crawl: completeScope,
    products: [product],
    offers,
    skuInventories: [
      {
        url: fixture.url,
        inventoryObserved: true,
        skus: [
          { sku: '11', url: fixture.url, options: [] },
          {
            sku: '12',
            url: `${fixture.url}?skuId=12`,
            available: false,
            options: [{ name: 'Flavour', value: 'Vanilla' }],
          },
        ],
      },
    ],
  });
  assert.equal(report.missingSkuPrices.length, 1);
  assert.equal(report.missingSkuPrices[0].sku, '12');
  assert.equal(report.visibleSearchComplete, false);
});

test('exhausted searches cannot certify a whole-market catalog; unknown categories remain review gaps', () => {
  const report = auditCoverage({
    crawl: completeScope,
    products: [fixture],
    offers: [data.offers[0]],
    discoveries: [
      {
        classification: 'needs-category-review',
        category: 'unknown',
        url: 'https://www.lazada.vn/products/pdp-i999.html',
      },
    ],
  });
  assert.equal(report.categoryReview.length, 1);
  assert.equal(report.visibleSearchComplete, false);
  assert.equal(report.complete, false);
  assert.throws(
    () => assertCompleteCoverage(auditCoverage({ crawl: completeScope })),
    /unverifiable-with-public-search/u
  );
});

test('manufacturer domain identity cannot cross brands, follow fake subdomains or accept title/brand conflicts', () => {
  assert.equal(
    isTrustedManufacturer(
      { brand: 'MusaKing', title: 'MusaKing whey' },
      'https://musaking.com/products/whey-isolate'
    ),
    true
  );
  assert.equal(
    isTrustedManufacturer(
      { brand: 'MusaKing', title: 'MusaKing whey' },
      'https://musaking.com.attacker.example/x'
    ),
    false
  );
  assert.equal(
    isTrustedManufacturer(
      { brand: 'Ostrovit', title: 'Scitec whey' },
      'https://musaking.com/products/whey-isolate'
    ),
    false
  );
});

for (const field of REQUIRED_SPEC_FIELDS) {
  test(`a manufacturer record missing ${field} cannot enter the purchase ranking`, () => {
    const product = globalThis.structuredClone(fixture);
    delete product[field];
    const result = calculateOffer(product, data.offers[0], { now });
    assert.equal(result.eligible, false);
    assert.ok(
      result.problems.includes(`Manufacturer specification required: ${field}`)
    );
  });
}

test('a boolean verified flag or a family-level source cannot satisfy specification provenance', () => {
  assert.ok(
    specificationProblems({
      ...fixture,
      manufacturerVerification: { identityMatched: true },
    }).length > 0
  );
  assert.equal(
    calculateOffer(
      { ...fixture, manufacturerVerification: undefined },
      data.offers[0],
      { now }
    ).eligible,
    false
  );
  assert.equal(
    calculateOffer(
      { ...fixture, manufacturerVerification: undefined },
      data.offers[0],
      { now, requireManufacturer: false }
    ).eligible,
    true
  );
});

test('exact manufacturer facts correct marketplace errors while preserving original claims and an immutable correction record', () => {
  const listing = { ...fixture, netMassG: 1100, proteinPer100g: 75 };
  const manufacturer = {
    ...fixture,
    claims: fixture.claims
      .filter((claim) => claim.source === 'manufacturer')
      .map((claim) => ({ ...claim, evidenceId: 'official-label' })),
  };
  const check = {
    identityMatched: true,
    sourceAuthority: 'manufacturer',
    identityMethod: 'gtin',
    evidenceId: 'official-label',
    manufacturerUrl: 'https://manufacturer.example/whey',
    checkedAt: '2026-10-09T09:00:00Z',
  };
  const corrected = reconcileManufacturer(
    { ...listing, evidenceIds: [...listing.evidenceIds, 'official-label'] },
    manufacturer,
    check
  );
  assert.equal(corrected.netMassG, 1000);
  assert.equal(corrected.proteinPer100g, 80);
  assert.equal(corrected.corrections.length, 2);
  assert.deepEqual(
    corrected.corrections.find((entry) => entry.field === 'netMassG').previous,
    1100
  );
  assert.equal(listing.netMassG, 1100);
  assert.equal(specificationProblems(corrected).length, 0);
  assert.deepEqual(
    reconcileManufacturer(listing, manufacturer, {
      ...check,
      identityMatched: false,
    }),
    listing
  );
  assert.deepEqual(
    reconcileManufacturer(listing, manufacturer, {
      ...check,
      sourceAuthority: 'unverified-source',
    }),
    listing
  );
});

test('exhaustive crawling continues through duplicate cards and an unrelated page to the observed terminal page', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-pagination-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const visited = [];
  const app = new LazadaSearch({
    store,
    ocr: false,
    collector: {
      page: async (url) => {
        const page = Number(new URL(url).searchParams.get('page') || 1);
        visited.push(page);
        return {
          id: url,
          fetchedAt: now,
          status: 'ok',
          cacheHit: true,
          snapshot: {
            cards:
              page === 3
                ? [
                    {
                      title: 'Ice cream molds',
                      url: 'https://www.lazada.vn/products/pdp-i999.html',
                    },
                  ]
                : [{ title: 'Whey protein', url: fixture.url }],
            searchCoverage: {
              currentPage: page,
              lastPage: 4,
              reportedTotal: 4,
              terminalConfirmed: page === 4,
            },
          },
        };
      },
    },
  });
  app.collect = async () => ({
    product: fixture,
    offer: data.offers[0],
    cacheHit: true,
  });
  const report = await app.crawl({
    queries: ['whey'],
    maxPages: 1,
    maxProducts: 1,
    exhaustive: true,
  });
  assert.deepEqual(visited, [1, 2, 3, 4]);
  assert.equal(report.scopes[0].terminalConfirmed, true);
  assert.equal(report.complete, false);
  assert.equal(
    (await store.list('discovery')).some(
      (entry) => entry.classification === 'needs-category-review'
    ),
    true
  );
});

test('a challenged detail page stops the exhaustive collector before another request', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-challenge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    ocr: false,
    collector: {
      page: async (url) => ({
        id: url,
        fetchedAt: now,
        status: 'ok',
        snapshot: {
          cards: [
            { title: 'Whey protein', url: fixture.url },
            { title: 'Whey isolate', url: data.products[1].url },
          ],
          searchCoverage: { terminalConfirmed: true },
        },
      }),
    },
  });
  let details = 0;
  app.collect = async () => {
    details++;
    throw new Error('Collection stopped: challenge');
  };
  const report = await app.crawl({ queries: ['whey'], exhaustive: true });
  assert.equal(details, 1);
  assert.equal(report.stopReason, 'challenge-or-login');
  assert.equal(report.uncollected, 2);
});
