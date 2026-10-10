import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountBacklogBatch,
  accountBacklogFlags,
  orderAccountBacklog,
  VN_FACTORY_PRIORITY_URLS,
} from '../scripts/account-backlog-order.mjs';
import { parseArguments } from '../src/config.js';
import { runAccountCase } from '../scripts/account-case-workflow.mjs';

const ostrovit = VN_FACTORY_PRIORITY_URLS[0];
const warrior = VN_FACTORY_PRIORITY_URLS[1];
const ordinary = 'https://www.lazada.vn/products/ordinary-whey-i7001.html';
const chocolate =
  'https://www.lazada.vn/products/ostrovit-chocolate-i1225994167-s91.html';
const vanilla = `${ostrovit}?skuId=92`;

function audit(overrides = {}) {
  return {
    discoveryComplete: true,
    failures: [],
    missingListings: [],
    missingSkuPrices: [],
    missingPrices: [],
    unknownSkuInventories: [],
    ...overrides,
  };
}

function withEnvironment(values, run) {
  const saved = new Map(
    Object.keys(values).map((name) => [name, process.env[name]])
  );
  try {
    Object.assign(process.env, values);
    return run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test('canonical listing priority preserves all sibling URLs, unavailable variants and ordinary tasks', () => {
  const state = audit({
    missingListings: [ordinary, warrior, ostrovit],
    missingSkuPrices: [
      { listingUrl: ostrovit, url: chocolate, sku: '91', available: true },
      { listingUrl: ostrovit, url: vanilla, sku: '92', available: false },
    ],
    missingPrices: [{ url: `${ordinary}?skuId=93`, sku: '93' }],
    unknownSkuInventories: [ordinary, `${warrior}?skuId=94`],
  });
  const snapshot = globalThis.structuredClone(state);
  const original = orderAccountBacklog(state);
  const ordered = orderAccountBacklog(state, {
    priorityUrls: VN_FACTORY_PRIORITY_URLS,
  });
  assert.deepEqual(ordered.slice(0, 3), [ostrovit, chocolate, vanilla]);
  assert.deepEqual(ordered.slice(3, 5), [warrior, `${warrior}?skuId=94`]);
  assert.deepEqual(new Set(ordered), new Set(original));
  assert.equal(ordered.length, original.length);
  assert.deepEqual(state, snapshot);
});

test('user priorities override factory lead order and never enqueue a previously collected listing', () => {
  const ordered = orderAccountBacklog(
    audit({ missingListings: [ostrovit, ordinary, warrior] }),
    {
      priorityUrls: [warrior, chocolate, ostrovit, VN_FACTORY_PRIORITY_URLS[4]],
    }
  );
  assert.deepEqual(ordered, [warrior, ostrovit, ordinary]);
});

test('missing SKU URLs are synthesized per selected SKU without folding sibling prices together', () => {
  const ordered = orderAccountBacklog(
    audit({
      missingSkuPrices: [
        { listingUrl: ostrovit, sku: '1225994167_VNAMZ-91' },
        { listingUrl: ostrovit, sku: '92', available: false },
        { listingUrl: `${warrior}?existing=filter`, sku: '93' },
      ],
    })
  );
  assert.deepEqual(ordered, [
    `${ostrovit}?skuId=91`,
    `${warrior}?existing=filter&skuId=93`,
    vanilla,
  ]);
});

test('generic URL aliases cannot collapse distinct missing SKU or offer prices', () => {
  const ordered = orderAccountBacklog(
    audit({
      missingSkuPrices: [
        { url: ostrovit, sku: '91' },
        { url: ostrovit, sku: '92' },
      ],
      missingPrices: [
        { url: ostrovit, sku: '1225994167_VNAMZ-93' },
        { url: ostrovit, sku: '91' },
      ],
    })
  );
  assert.deepEqual(ordered, [
    `${ostrovit}?skuId=91`,
    `${ostrovit}?skuId=92`,
    `${ostrovit}?skuId=93`,
  ]);
});

test('exhaustive mode still collects at most 25 selected URLs per publication batch', () => {
  const state = audit({
    missingListings: Array.from(
      { length: 67 },
      (_, index) => `https://www.lazada.vn/products/pdp-i${8000 + index}.html`
    ),
  });
  const batch = accountBacklogBatch(state, {
    exhaustive: true,
    maxProducts: 1,
  });
  assert.equal(batch.urls.length, 25);
  assert.equal(batch.totalQueued, 67);
  assert.equal(batch.remainingAfterBatch, 42);
  assert.equal(
    accountBacklogBatch(state, { exhaustive: true, batchSize: 100 }).urls
      .length,
    25
  );
  assert.equal(
    accountBacklogBatch(state, { batchSize: 5, maxProducts: 3 }).urls.length,
    3
  );
  assert.equal(accountBacklogBatch(audit()).urls.length, 0);
});

test('batch size is a positive safe integer in both direct queue and CLI configuration', () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => accountBacklogBatch(audit(), { batchSize: value }),
      /batchSize must be a positive integer/u
    );
    assert.throws(
      () => parseArguments(['--batch-size', String(value)]),
      /batchSize must be a positive integer/u
    );
  }
});

test('priority and batch CLI flags override environment defaults and forward false category-only explicitly', () => {
  withEnvironment(
    {
      LAZADA_CATEGORY_ONLY: 'true',
      LAZADA_BATCH_SIZE: '20',
      LAZADA_PRIORITY_URL: `${ostrovit} ${warrior}`,
      LAZADA_FLAVOUR_SCOPE: 'all',
    },
    () => {
      const defaults = parseArguments([]);
      assert.equal(defaults.batchSize, 20);
      assert.deepEqual(defaults.priorityUrl, [ostrovit, warrior]);
      const flags = accountBacklogFlags({
        batchSize: 7,
        categoryOnly: false,
        flavourScope: 'chocolate-or-unflavoured',
        priorityUrl: [warrior, chocolate],
      });
      assert.ok(flags.includes('--no-category-only'));
      const forwarded = parseArguments(flags);
      assert.equal(forwarded.categoryOnly, false);
      assert.equal(forwarded.flavourScope, 'chocolate-or-unflavoured');
      assert.equal(forwarded.batchSize, 7);
      assert.deepEqual(forwarded.priorityUrl, [warrior, chocolate]);
    }
  );
});

test('account workflow publishes each batch and continues until every preserved URL is processed', async () => {
  let pending = Array.from(
    { length: 67 },
    (_, index) => `https://www.lazada.vn/products/pdp-i${9000 + index}.html`
  );
  const processed = [];
  const publicationCounts = [];
  const result = await runAccountCase({
    discover: async () => {},
    audit: async () => audit({ missingListings: pending }),
    collect: async () => {
      const batch = accountBacklogBatch(audit({ missingListings: pending }), {
        exhaustive: true,
      });
      processed.push(...batch.urls);
      const collected = new Set(batch.urls);
      pending = pending.filter((url) => !collected.has(url));
    },
    publish: async () => publicationCounts.push(processed.length),
  });
  assert.deepEqual(publicationCounts, [0, 25, 50, 67]);
  assert.equal(new Set(processed).size, 67);
  assert.equal(result.passes, 3);
  assert.equal(result.phase, 'initial-product-pass-finished');
});
