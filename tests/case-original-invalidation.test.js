import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssociativeStore } from '../src/store.js';
import { auditCoverage } from '../src/coverage.js';
import {
  caseCoverageStatus,
  importCaseInventoryManifest,
  recordCaseManualReview,
} from '../src/case-coverage.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-case-original-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const app = {
    store,
    market: 'vn',
    deliveryArea: 'Nha Trang',
    assertMarket: (url) => assert.equal(new URL(url).hostname, 'www.lazada.vn'),
    audit: async () => auditCoverage({ crawl: (await store.list('crawl'))[0] }),
  };
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const blob = await store.putBlob(
    Buffer.from(
      JSON.stringify({
        rows: [
          {
            url: 'https://www.lazada.vn/products/pdp-i100.html',
            sku: '100_VNAMZ-11',
          },
        ],
        total: 1,
        next: null,
      })
    )
  );
  const evidence = await store.put('evidence', {
    id: 'inventory-original',
    sourceUrl: 'https://www.lazada.vn/catalog/?q=whey',
    observedAt,
    blob,
    cacheId: 'inventory-original-cache',
  });
  await store.put('cache', {
    id: evidence.cacheId,
    sourceUrl: evidence.sourceUrl,
    observedAt,
    blob,
  });
  await store.put('crawl', {
    id: 'fixture-crawl',
    queries: ['whey protein'],
    scopes: [{ query: 'whey protein', terminalConfirmed: true }],
    failures: [],
    uncollectedUrls: [],
  });
  const stop = await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
  });
  const input = {
    evidenceId: evidence.id,
    sourceSha256: blob.sha256,
    scope: (await caseCoverageStatus(app)).scope,
    reviewedBy: 'Original fixture reviewer',
    mapping: {
      rowsPointer: '/rows',
      urlPointer: '/url',
      skuPointer: '/sku',
      reportedTotalPointer: '/total',
      terminalPointer: '/next',
      terminalValue: null,
    },
  };
  return { app, store, evidence, blob, input, stop };
}

async function review(context) {
  const status = await caseCoverageStatus(context.app);
  return recordCaseManualReview(context.app, {
    scope: status.scope,
    scopeFingerprint: status.scopeFingerprint,
    reviewedBy: 'Original fixture reviewer',
    reason: 'Checked exact unchanged retained original',
    evidence: [
      { evidenceId: context.evidence.id, sourceSha256: context.blob.sha256 },
    ],
    classificationReviewed: true,
    exactPriceExtractionReviewed: true,
    quantityExtractionReviewed: true,
    listPaginationReviewed: true,
  });
}

for (const [name, clear] of [
  ['valid resolution', { resolvedAt: new Date().toISOString() }],
  ['explicit inactive state', { active: false }],
  ['explicit cleared flag', { invalidated: false }],
]) {
  test(`case original inventory and aggregate review reuse unchanged bytes after ${name}`, async (t) => {
    const context = await fixture(t);
    const invalidation = {
      id: 'original-invalidation',
      evidenceIds: [context.evidence.id],
      invalidated: true,
    };
    await context.store.put('invalidation', invalidation);
    await assert.rejects(
      importCaseInventoryManifest(context.app, context.input),
      /requires recollection/u
    );
    await context.store.put('invalidation', { ...invalidation, ...clear });
    const inventory = await importCaseInventoryManifest(
      context.app,
      context.input
    );
    assert.equal(inventory.rows[0].sku, '100_VNAMZ-11');
    const recorded = await review(context);
    assert.equal(
      (await caseCoverageStatus(context.app, { manualReviewId: recorded.id }))
        .manualReview.id,
      recorded.id
    );
    assert.deepEqual(
      await context.store.get('collection-stop', 'browser-collection'),
      context.stop
    );
  });
}

for (const [name, fields] of [
  [
    'sourceUrl binding with missing timestamp',
    { sourceUrl: 'https://www.lazada.vn/catalog/?q=whey' },
  ],
  [
    'evidence binding with malformed timestamp',
    { evidenceIds: ['inventory-original'], invalidatedAt: 'invalid-date' },
  ],
  [
    'cache binding with malformed resolution',
    {
      cacheIds: ['inventory-original-cache'],
      invalidated: true,
      resolvedAt: 'invalid-date',
    },
  ],
]) {
  test(`case inventory refuses ${name} without altering its original`, async (t) => {
    const context = await fixture(t);
    await context.store.put('invalidation', {
      id: 'source-bound-invalidation',
      ...fields,
    });
    await assert.rejects(
      importCaseInventoryManifest(context.app, context.input),
      /requires recollection/u
    );
    await assert.rejects(review(context), /requires recollection/u);
    assert.deepEqual(
      await context.store.get('evidence', context.evidence.id),
      context.evidence
    );
    assert.equal((await context.store.list('case-inventory')).length, 0);
  });
}

test('swapping another retained evidence descriptor revokes an aggregate review even when its attached proof bytes are unchanged', async (t) => {
  const context = await fixture(t);
  const another = await context.store.put('evidence', {
    id: 'another-captured-listing',
    sourceUrl: 'https://www.lazada.vn/products/pdp-i200.html',
    observedAt: context.evidence.observedAt,
    html: await context.store.putBlob(
      Buffer.from('<html>Original second listing</html>')
    ),
  });
  const recorded = await review(context);
  const before = await caseCoverageStatus(context.app, {
    manualReviewId: recorded.id,
  });
  assert.equal(before.manualReview.id, recorded.id);
  await context.store.put('evidence', {
    ...another,
    html: await context.store.putBlob(
      Buffer.from('<html>Changed second listing</html>')
    ),
  });
  const after = await caseCoverageStatus(context.app, {
    manualReviewId: recorded.id,
  });
  assert.notEqual(after.scopeFingerprint, before.scopeFingerprint);
  assert.equal(after.manualReview, null);
  assert.deepEqual(
    await context.store.get('evidence', context.evidence.id),
    context.evidence
  );
});
