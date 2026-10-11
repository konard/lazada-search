import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  persistScopeDecisions,
  publishScopeDecisions,
} from '../src/index.js';

test('nonmatching titles and options persist, reuse unchanged evidence and revoke a stale exclusion', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-scope-decisions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const audit = {
    excludedCategoryListings: [
      {
        listingKey: 'lazada.vn:item:100',
        titles: ['Rally whey protein bars'],
        reasons: ['Protein bars are outside the protein powder category'],
        sourceUrls: ['https://www.lazada.vn/catalog/?q=whey'],
        sourceRecordIds: ['discovery-100'],
      },
    ],
    excludedFlavourTasks: [
      {
        listingUrl: 'https://www.lazada.vn/products/pdp-i101.html',
        url: 'https://www.lazada.vn/products/pdp-i101.html?skuId=11',
        sku: '101_VNAMZ-11',
        options: [{ name: 'Flavour', value: 'Vanilla + Shaker' }],
        extractedFlavour: 'other',
        reason: 'Selected SKU includes a shaker',
      },
    ],
  };
  const first = await persistScopeDecisions(store, audit);
  const replay = await persistScopeDecisions(store, audit);
  assert.equal(first.excluded, 2);
  assert.equal(replay.reused, 2);
  assert.deepEqual(replay.decisions, first.decisions);
  const changed = await persistScopeDecisions(store, {
    excludedFlavourTasks: audit.excludedFlavourTasks,
  });
  const restored = changed.decisions.find(
    (record) => record.kind === 'listing'
  );
  assert.equal(restored.decision, 'needs-review');
  assert.equal((await store.list('scope-decision-history')).length, 1);
  assert.deepEqual((await store.list('scope-decision-history'))[0].titles, [
    'Rally whey protein bars',
  ]);
});

test('public decision publication preserves exclusion evidence without private visibility and reuses it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-public-scope-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const account = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: shared,
  });
  await persistScopeDecisions(account, {
    excludedCategoryListings: [
      {
        listingKey: 'lazada.vn:item:100',
        titles: ['Whey dành cho ếch'],
        reasons: ['Animal feed'],
        sourceUrls: ['https://www.lazada.vn/products/pdp-i100.html'],
      },
    ],
  });
  const first = await publishScopeDecisions(shared, account);
  const replay = await publishScopeDecisions(shared, account);
  assert.equal(first.published, 1);
  assert.equal(replay.reused, 1);
  const [record] = await shared.list('scope-decision');
  assert.equal(record.visibility, undefined);
  assert.deepEqual(record.titles, ['Whey dành cho ếch']);
});
