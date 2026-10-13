import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { auditCoverage } from '../src/coverage.js';
import { scopeAccountAudit } from '../src/collection-scope.js';
import { productFlavour, matchesFlavourScope } from '../src/flavour-scope.js';
import { persistScopeDecisions } from '../src/scope-decisions.js';

const scope = 'chocolate-or-unflavoured';
const observedAt = '2026-10-13T08:00:00.000Z';
const category = 'https://www.lazada.vn/protein/';
const source = 'https://www.lazada.vn/catalog/?q=whey';
const listing = 'https://www.lazada.vn/products/pdp-i13458489726.html';

function captured(sku, title, selectedVariant = [], url = listing) {
  const evidenceId = `listing-evidence:${sku}:${observedAt}`;
  const product = {
    id: `product:${sku}`,
    url,
    sku,
    title,
    category: 'whey',
    selectedVariant,
    observedAt,
    evidenceIds: [evidenceId],
    ingredients: [],
    warnings: [],
  };
  const offer = {
    id: `offer:${sku}`,
    url,
    productId: product.id,
    sku,
    price: 300000,
    variantConfirmed: true,
    observedAt,
    evidenceId,
  };
  return { product, offer };
}

function report(records, options = {}) {
  return auditCoverage({
    products: records.map((entry) => entry.product),
    offers: records.map((entry) => entry.offer),
    ...options,
  });
}

const scoped = (audit, options = {}) =>
  scopeAccountAudit(audit, {
    flavourScope: scope,
    ...options,
  });

async function storeFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-captured-sku-scope-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

test('explicit cherry/berry and Vietnamese milk-tea flavours are recognized with bounded words and selected chocolate takes precedence', () => {
  for (const title of [
    'Whey hương Cherry Berry ISO Clear',
    'Bột whey Vị Trà Sữa 1000g',
    'Clear whey berries',
    'Whey Milk Tea',
  ]) {
    const product = { category: 'whey', title, selectedVariant: [] };
    assert.equal(productFlavour(product), 'other', title);
    assert.equal(matchesFlavourScope(product, scope), false, title);
    assert.equal(
      productFlavour({
        ...product,
        selectedVariant: [{ text: 'Chocolate' }],
      }),
      'chocolate'
    );
  }
  assert.equal(
    productFlavour({ category: 'whey', title: 'Chocolate milk whey' }),
    'chocolate'
  );
  assert.equal(
    productFlavour({ category: 'whey', title: 'Cherryville whey powder' }),
    'unknown'
  );
});

test('already priced captured cherry and milk-tea SKUs produce durable exact-SKU negatives with original title, IDs and date', async (t) => {
  const store = await storeFor(t);
  const records = [
    captured('11', 'Whey hương Cherry Berry ISO Clear'),
    captured(
      '21',
      'Bột Whey Vị Trà Sữa 1000g',
      [],
      'https://www.lazada.vn/products/pdp-i2494568895.html'
    ),
  ];
  const audit = scoped(report(records));
  assert.equal(audit.missingSkuPrices.length, 0);
  assert.equal(audit.excludedCategoryListings.length, 0);
  assert.equal(audit.excludedFlavourTasks.length, 2);
  assert.equal(audit.specifications.length, 0);
  assert.equal(audit.unknownSkuInventories.length, 2);
  const first = await persistScopeDecisions(store, audit);
  assert.equal(first.excluded, 2);
  for (const [index, decision] of first.decisions.entries()) {
    assert.equal(decision.kind, 'sku');
    assert.equal(decision.title, records[index].product.title);
    assert.deepEqual(decision.selectedVariant, []);
    assert.equal(decision.observedAt, observedAt);
    assert.equal(decision.productId, records[index].product.id);
    assert.equal(decision.offerId, records[index].offer.id);
    assert.deepEqual(decision.sourceEvidenceIds, [
      records[index].offer.evidenceId,
    ]);
    assert.equal(decision.sourceAuthority, 'marketplace');
  }
  assert.equal((await persistScopeDecisions(store, audit)).reused, 2);
});

test('rejecting a captured fruit SKU leaves chocolate and unknown siblings plus unknown inventories pending', () => {
  const cherry = captured('11', 'Whey hương Cherry Berry ISO Clear');
  const inventories = [
    {
      id: 'inventory:13458489726',
      url: listing,
      inventoryObserved: false,
      cacheId: 'cache:original-listing',
      observedAt,
      skus: [
        {
          sku: '11',
          url: `${listing}?skuId=11`,
          options: [{ value: 'Cherry Berry' }],
        },
        {
          sku: '12',
          url: `${listing}?skuId=12`,
          options: [{ value: 'Chocolate' }],
        },
        { sku: '13', url: `${listing}?skuId=13`, options: [] },
        {
          sku: '14',
          url: `${listing}?skuId=14`,
          options: [{ value: 'Milk Tea' }],
        },
      ],
    },
  ];
  const audit = scoped(report([cherry], { skuInventories: inventories }));
  assert.deepEqual(
    audit.missingSkuPrices.map((entry) => entry.sku),
    ['12', '13']
  );
  assert.deepEqual(
    audit.excludedFlavourTasks.map((entry) => entry.sku),
    ['14', '11']
  );
  assert.deepEqual(audit.unknownSkuInventories, [listing]);
  assert.equal(audit.complete, false);
  assert.equal(audit.purchaseReady, false);
  assert.equal(audit.visibleSearchComplete, false);
  assert.deepEqual(audit.excludedCategoryListings, []);
});

test('a selected chocolate sibling remains in scope despite fruit listing marketing and unknown inventory remains unproven', () => {
  const cherry = captured('11', 'Cherry Berry whey');
  const chocolate = captured('12', 'Cherry Berry Milk Tea Chocolate whey', [
    { text: 'Chocolate' },
  ]);
  const audit = scoped(report([cherry, chocolate]));
  assert.deepEqual(
    audit.excludedFlavourTasks.map((entry) => entry.sku),
    ['11']
  );
  assert.deepEqual(
    audit.specifications.map((entry) => entry.productId),
    [chocolate.product.id]
  );
  assert.equal(audit.capturedSkuObservations.length, 2);
  assert.equal(audit.unknownSkuInventories.length, 1);
});

test('captured negatives follow active category source filters and retain separate keyword observations', () => {
  const active = captured('11', 'Cherry Berry whey');
  const archived = captured(
    '21',
    'Milk Tea whey',
    [],
    'https://www.lazada.vn/products/pdp-i2494568895.html'
  );
  const options = {
    categoryOnly: true,
    crawl: {
      scopes: [
        { type: 'category', url: category },
        { type: 'keyword', url: source },
      ],
    },
    discoveries: [
      {
        url: active.product.url,
        sourceUrl: `${category}?sort=priceasc&page=3`,
      },
      { url: archived.product.url, sourceUrl: source },
    ],
  };
  const audit = scoped(report([active, archived]), options);
  assert.deepEqual(
    audit.capturedSkuObservations.map((entry) => entry.sku),
    ['11']
  );
  assert.deepEqual(
    audit.excludedFlavourTasks.map((entry) => entry.sku),
    ['11']
  );
});

test('source-invalidated or mismatched captured observations cannot sustain exclusions; refreshed exact sources revoke stale negatives', async (t) => {
  const store = await storeFor(t);
  const cherry = captured('11', 'Cherry Berry whey');
  await persistScopeDecisions(store, scoped(report([cherry])));
  const invalidated = report([cherry], {
    invalidations: [
      {
        evidenceIds: [cherry.offer.evidenceId],
        invalidatedAt: '2026-10-13T09:00:00.000Z',
      },
    ],
  });
  assert.deepEqual(invalidated.capturedSkuObservations, []);
  const withdrawn = await persistScopeDecisions(store, scoped(invalidated));
  assert.equal(withdrawn.decisions[0].decision, 'needs-review');
  assert.equal((await store.list('scope-decision-history')).length, 1);
  for (const mutation of [
    (entry) => {
      entry.offer.variantConfirmed = false;
    },
    (entry) => {
      entry.offer.evidenceId = 'unattached-evidence';
    },
    (entry) => {
      entry.product.observedAt = '2026-10-12T08:00:00.000Z';
    },
    (entry) => {
      entry.product.sku = 'unrelated-sku';
    },
    (entry) => {
      entry.offer.supersededBy = 'fresh-offer';
    },
    (entry) => {
      entry.offer.invalidated = true;
    },
  ]) {
    const changed = globalThis.structuredClone(cherry);
    mutation(changed);
    assert.deepEqual(report([changed]).capturedSkuObservations, []);
  }
  const chocolate = captured('11', 'Cherry Berry whey', [
    { text: 'Chocolate' },
  ]);
  const restored = await persistScopeDecisions(
    store,
    scoped(report([chocolate]))
  );
  assert.equal(restored.excluded, 0);
  assert.ok(
    (await store.list('scope-decision')).every(
      (entry) => entry.decision !== 'excluded'
    )
  );
});

test('changed exact source metadata creates history; aliases deduplicate one SKU without excluding its whole listing', async (t) => {
  const store = await storeFor(t);
  const cherry = captured('11', 'Cherry Berry whey');
  const audit = scoped(report([cherry]));
  await persistScopeDecisions(store, audit);
  const changed = globalThis.structuredClone(cherry);
  changed.product.title = 'Cherry whey refreshed exact capture';
  changed.product.observedAt = changed.offer.observedAt =
    '2026-10-13T09:00:00.000Z';
  changed.offer.evidenceId = 'fresh-listing-evidence';
  changed.product.evidenceIds = ['fresh-listing-evidence'];
  const next = scoped(report([changed]));
  next.excludedFlavourTasks.push({
    ...next.excludedFlavourTasks[0],
    sku: '13458489726_VNAMZ-11',
    url: 'https://www.lazada.vn/products/alias-i13458489726-s11.html?skuId=11',
  });
  const results = await persistScopeDecisions(store, next);
  assert.equal(results.excluded, 1);
  assert.equal((await store.list('scope-decision')).length, 1);
  assert.equal((await store.list('scope-decision-history')).length, 1);
  assert.equal(results.decisions[0].title, changed.product.title);
  const all = await persistScopeDecisions(store, next, { flavourScope: 'all' });
  assert.equal(all.excluded, 0);
  assert.equal(all.decisions[0].decision, 'needs-review');
  assert.match(all.decisions[0].reasons[0], /scope changed/u);
});

test('a current captured chocolate source overrides an older inventory negative and unknown missing-option titles do not exclude siblings', () => {
  const chocolate = captured('11', 'Cherry Berry whey', [
    { text: 'Chocolate' },
  ]);
  const audit = report([chocolate]);
  audit.missingSkuPrices = [
    {
      listingUrl: listing,
      sku: '11',
      title: 'Cherry Berry whey',
      observedAt: '2026-10-12T08:00:00.000Z',
      options: [{ value: 'Cherry Berry' }],
    },
    {
      listingUrl: listing,
      sku: '12',
      title: 'Milk Tea whey',
      options: [{ value: '1000g' }],
    },
  ];
  const result = scoped(audit);
  assert.deepEqual(result.excludedFlavourTasks, []);
  assert.equal(result.missingSkuPrices.length, 2);
  assert.deepEqual(scoped(result).excludedFlavourTasks, []);
});
