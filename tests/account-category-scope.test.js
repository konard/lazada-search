import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categorySourceKey,
  scopeAccountAudit,
} from '../scripts/account-category-scope.mjs';
import { runAccountCase } from '../scripts/account-case-workflow.mjs';

const category = 'https://www.lazada.vn/protein/?brand=123&rating=4';
const cheap = 'https://www.lazada.vn/products/sample-whey-i7101.html';
const bulk = 'https://www.lazada.vn/products/bulk-whey-i7102.html';
const historical = 'https://www.lazada.vn/products/broad-keyword-i7103.html';
const filteredOut = 'https://www.lazada.vn/products/other-filter-i7104.html';
const crawl = {
  discoveryComplete: true,
  scopes: [
    { type: 'category', url: `${category}&sort=priceasc` },
    { type: 'keyword', url: 'https://www.lazada.vn/catalog/?q=whey' },
  ],
};
const discoveries = [
  {
    url: cheap,
    title: 'Vanilla, chocolate, plain whey protein sample 10g',
    searchPrice: 10000,
    sourceUrl: `${category}&page=2&sort=pricedesc`,
  },
  {
    url: bulk,
    title: 'Chocolate, vanilla whey protein 10kg',
    searchPrice: 5000000,
    sourceUrls: ['https://www.lazada.vn/catalog/?q=whey', category],
  },
  { url: historical, sourceUrl: 'https://www.lazada.vn/catalog/?q=whey' },
  { url: filteredOut, sourceUrl: 'https://www.lazada.vn/protein/?brand=456' },
];

function audit(overrides = {}) {
  return {
    discoveryComplete: true,
    complete: false,
    purchaseReady: false,
    visibleSearchComplete: false,
    scopedDatasetReady: false,
    failures: [],
    missingListings: [cheap, bulk, historical, filteredOut],
    missingSkuPrices: [],
    missingPrices: [],
    unknownSkuInventories: [],
    categoryReview: [],
    specifications: [],
    verifiedProducts: 0,
    ...overrides,
  };
}

function scoped(report, options = {}) {
  return scopeAccountAudit(report, {
    categoryOnly: true,
    crawl,
    discoveries,
    ...options,
  });
}

test('category source matching removes only pagination and sort, preserving filters', () => {
  assert.equal(
    categorySourceKey(`${category}&sort=priceasc&page=7`),
    categorySourceKey('https://www.lazada.vn/protein/?rating=4&brand=123')
  );
  assert.notEqual(
    categorySourceKey(`${category}&q=chocolate`),
    categorySourceKey(category)
  );
  assert.notEqual(
    categorySourceKey(`${category}&price=0-100000`),
    categorySourceKey(category)
  );
  assert.notEqual(
    categorySourceKey(`${category}&spm=scope-filter`),
    categorySourceKey(category)
  );
  assert.equal(categorySourceKey('invalid-source'), null);
});

test('category backlog retains cheap samples and expensive bulk listings regardless of multi-flavour titles', () => {
  const report = audit();
  const snapshot = globalThis.structuredClone(report);
  const result = scoped(report);
  assert.deepEqual(result.missingListings, [cheap, bulk]);
  assert.deepEqual(report, snapshot);
  assert.deepEqual(result.backlogCategoryScope, {
    sourceUrls: [category],
    listingCount: 2,
  });
  assert.equal(result.complete, false);
  assert.equal(result.purchaseReady, false);
  assert.equal(result.visibleSearchComplete, false);
});

test('all sibling SKU prices, inventory gaps and offer gaps survive canonical listing aliases', () => {
  const chocolate = {
    listingUrl: cheap,
    url: 'https://www.lazada.vn/products/pdp-i7101-s91.html?skuId=91',
    sku: '91',
    available: true,
    options: [{ name: 'Flavour', value: 'Chocolate' }],
  };
  const vanilla = {
    listingUrl: cheap,
    sku: '92',
    available: false,
    options: [{ name: 'Flavour', value: 'Vanilla' }],
  };
  const expensive = {
    listingUrl: bulk,
    url: `${bulk}?skuId=93`,
    sku: '93',
    options: [{ name: 'Size', value: '10kg' }],
  };
  const irrelevant = { listingUrl: historical, url: historical, sku: '94' };
  const result = scoped(
    audit({
      missingSkuPrices: [chocolate, vanilla, expensive, irrelevant],
      missingPrices: [
        { url: `${cheap}?skuId=95`, sku: '95', offerId: 'sample' },
        { url: historical, sku: '96', offerId: 'historical' },
      ],
      unknownSkuInventories: [
        'https://www.lazada.vn/products/pdp-i7101.html',
        bulk,
        historical,
      ],
      categoryReview: [{ url: bulk }, { url: historical }],
      specifications: [
        { url: cheap, problems: [] },
        { url: bulk, problems: ['Exact label pending'] },
        { url: historical, problems: [] },
      ],
      verifiedProducts: 2,
    })
  );
  assert.deepEqual(result.missingSkuPrices, [chocolate, vanilla, expensive]);
  assert.deepEqual(
    result.missingPrices.map((entry) => entry.sku),
    ['95']
  );
  assert.equal(result.unknownSkuInventories.length, 2);
  assert.deepEqual(result.categoryReview, [{ url: bulk }]);
  assert.equal(result.specifications.length, 2);
  assert.equal(result.verifiedProducts, 1);
});

test('strict flavour scope excludes exact known other flavours and retains chocolate, plain and unknown selling options', () => {
  const flavours = [
    'Chocolate',
    'Unflavoured',
    'Vị tự nhiên',
    'Trial size 10g',
    'Vani',
    'Green Tea',
    'Chocolate Peanut Butter',
  ];
  const tasks = flavours.map((flavour, index) => ({
    listingUrl: cheap,
    url: `${cheap}?skuId=${100 + index}`,
    sku: String(100 + index),
    title: 'Chocolate, Vanilla, Natural Protein',
    options: [{ name: 'Flavour', value: flavour }],
  }));
  const noOptions = { listingUrl: cheap, sku: '107', options: [] };
  const noInventory = { listingUrl: bulk, sku: '108' };
  const report = audit({
    missingSkuPrices: [...tasks, noOptions, noInventory],
    unknownSkuInventories: [cheap, bulk],
  });
  const original = globalThis.structuredClone(report);
  const result = scoped(report, { flavourScope: 'chocolate-or-unflavoured' });
  assert.deepEqual(
    result.missingSkuPrices.map((entry) => entry.sku),
    ['100', '101', '102', '103', '107', '108']
  );
  assert.deepEqual(
    result.excludedFlavourTasks.map((entry) => entry.sku),
    ['104', '105', '106']
  );
  assert.ok(
    result.excludedFlavourTasks.every(
      (entry) => entry.extractedFlavour === 'other' && entry.reason
    )
  );
  assert.deepEqual(result.missingListings, [cheap, bulk]);
  assert.deepEqual(result.unknownSkuInventories, [cheap, bulk]);
  assert.deepEqual(report, original);
});

test('strict exact SKU filtering does not use multi-flavour listing titles or unspecified variant labels', () => {
  const tasks = [
    {
      listingUrl: cheap,
      sku: '201',
      title: 'Vani Chocolate Green Tea',
      options: [{ name: 'Size', value: '500g' }],
    },
    {
      listingUrl: bulk,
      sku: '202',
      options: [{ name: 'Flavour', value: 'Chocolate' }],
    },
  ];
  const result = scoped(audit({ missingSkuPrices: tasks }), {
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.deepEqual(result.missingSkuPrices, tasks);
  assert.deepEqual(result.excludedFlavourTasks, []);
  assert.deepEqual(result.missingListings, [cheap, bulk]);
  assert.equal(result.complete, false);
});

test('default and explicit all-flavour scope preserve every sibling task', () => {
  const tasks = [
    {
      listingUrl: cheap,
      sku: '301',
      options: [{ name: 'Flavour', value: 'Vanilla' }],
    },
    {
      listingUrl: cheap,
      sku: '302',
      options: [{ name: 'Flavour', value: 'Chocolate Peanut Butter' }],
    },
  ];
  const report = audit({ missingSkuPrices: tasks });
  assert.deepEqual(scoped(report).missingSkuPrices, tasks);
  assert.deepEqual(
    scoped(report, { flavourScope: 'all' }).missingSkuPrices,
    tasks
  );
  assert.equal(scopeAccountAudit(report, { flavourScope: 'all' }), report);
  assert.throws(
    () => scopeAccountAudit(report, { flavourScope: 'unsupported' }),
    /Unsupported flavour scope/u
  );
});

test('generic backlog is returned unchanged without requiring a category crawl', () => {
  const report = audit();
  assert.equal(scopeAccountAudit(report), report);
  assert.equal(
    scopeAccountAudit(report, { categoryOnly: false, crawl: {} }),
    report
  );
});

test('active mixed sources retain relevant keyword and category listings while excluding other archived searches', () => {
  const result = scoped(audit(), {
    categoryOnly: false,
    activeSourcesOnly: true,
  });
  assert.deepEqual(result.missingListings, [cheap, bulk, historical]);
  assert.equal(result.backlogCollectionScope.listingCount, 3);
  assert.equal(result.backlogCollectionScope.sourceUrls.length, 2);
  assert.equal(result.complete, false);
  assert.throws(
    () => scopeAccountAudit(audit(), { activeSourcesOnly: true, crawl: {} }),
    /requires a crawl with active source scopes/u
  );
});

test('a keyword-only crawl cannot silently finish a category-only backlog', () => {
  assert.throws(
    () =>
      scoped(audit(), {
        crawl: {
          scopes: [{ type: 'keyword', url: category }],
        },
      }),
    /requires a crawl with category source scopes/u
  );
  const result = scoped(audit(), {
    discoveries: [{ url: 'invalid-product', sourceUrl: category }],
  });
  assert.deepEqual(result.missingListings, []);
  assert.equal(result.backlogCategoryScope.listingCount, 0);
});

test('account workflow finishes scoped listing and sibling SKU passes while archived keyword gaps remain untouched', async () => {
  const archived = audit({ missingListings: [historical, filteredOut] });
  const stages = [
    audit({ missingListings: [cheap, historical] }),
    audit({
      missingListings: [historical],
      missingSkuPrices: [{ listingUrl: cheap, sku: '91', url: cheap }],
    }),
    archived,
  ];
  let collections = 0;
  const result = await runAccountCase({
    discover: async () => {},
    publish: async () => {},
    collect: async () => collections++,
    audit: async () => scoped(stages.shift()),
  });
  assert.equal(collections, 2);
  assert.equal(result.phase, 'initial-product-pass-finished');
  assert.deepEqual(archived.missingListings, [historical, filteredOut]);
});
