import test from 'node:test';
import assert from 'node:assert/strict';
import { runAccountCase } from '../scripts/account-case-workflow.mjs';
import { latestCrawl } from '../src/crawl.js';

test('phase admission selects the latest report even when legacy records omit start timestamps', () => {
  const old = { id: 'crawl:2026-10-09T09:45:40.007Z' };
  const completed = {
    id: 'crawl:2026-10-10T11:00:00Z',
    startedAt: '2026-10-10T11:00:00Z',
    discoveryComplete: true,
  };
  assert.equal(latestCrawl([old, completed]).discoveryComplete, true);
  assert.equal(
    latestCrawl([completed, { id: 'crawl:cached-audit:2026-10-09T12:00:00Z' }])
      .id,
    completed.id
  );
  assert.equal(
    latestCrawl([
      old,
      completed,
      { id: 'crawl:2026-10-10T12:00:00Z', discoveryComplete: false },
    ]).discoveryComplete,
    false
  );
});

const state = (overrides = {}) => ({
  discoveryComplete: true,
  failures: [],
  missingListings: [],
  missingSkuPrices: [],
  missingPrices: [],
  ...overrides,
});

test('case workflow completes every growing SKU backlog before deferred recollection and publishes each phase', async () => {
  const steps = [];
  const audits = [
    state({ missingListings: ['listing'] }),
    state({ missingSkuPrices: [{ listingUrl: 'listing', sku: 'new-SKU' }] }),
    state(),
  ];
  const result = await runAccountCase({
    discover: async () => steps.push('discover'),
    collect: async () => steps.push('collect'),
    audit: async () => audits.shift(),
    publish: async () => steps.push('publish'),
    recollect: async () => steps.push('recollect'),
  });
  assert.deepEqual(steps, [
    'discover',
    'publish',
    'collect',
    'publish',
    'collect',
    'publish',
    'recollect',
    'publish',
  ]);
  assert.equal(result.passes, 2);
  assert.equal(result.manufacturerVerificationPending, true);
  assert.equal(result.deliveryVerificationPending, true);
});

test('incomplete lists and stable unresolved products stop before later requests or old recollection', async () => {
  const forbidden = async () => {
    throw Error('Unexpected collection step');
  };
  const base = {
    discover: async () => {},
    collect: forbidden,
    publish: async () => {},
    recollect: forbidden,
  };
  assert.equal(
    (
      await runAccountCase({
        ...base,
        audit: async () => state({ discoveryComplete: false }),
      })
    ).reason,
    'discovery-incomplete'
  );
  let calls = 0;
  const result = await runAccountCase({
    ...base,
    collect: async () => calls++,
    audit: async () => state({ missingListings: ['unresolved'] }),
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, 'unresolved-products');
  assert.equal(result.pending, 1);
});

test('a dialog or challenge failure publishes saved evidence locally and stops before another collection step', async () => {
  let published = 0;
  await assert.rejects(
    runAccountCase({
      discover: async () => {},
      collect: async () => {
        throw Error('dialog is unresolved');
      },
      audit: async () => state({ missingListings: ['listing'] }),
      publish: async () => published++,
    }),
    /dialog is unresolved/u
  );
  assert.equal(published, 2);
});
