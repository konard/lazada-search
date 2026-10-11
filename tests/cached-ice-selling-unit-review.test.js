import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import {
  AssociativeStore,
  LazadaSearch,
  extractPage,
  parseProduct,
} from '../src/index.js';
import {
  MERINO_SELLING_UNIT_REVIEW as expected,
  reviewCachedIceSellingUnit,
} from '../scripts/review-cached-ice-selling-unit.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-merino-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'store') });
  const original = gunzipSync(
    await readFile(
      new URL(
        `../docs/acceptance/ice-dual-units/merino-seller-${expected.sku}-${expected.sourceSha256}.html.gz`,
        import.meta.url
      )
    )
  );
  const snapshot = extractPage({
    document: parseHTML(original.toString()).document,
    url: expected.url,
  });
  const parsed = parseProduct(snapshot, {
    evidenceId: expected.evidenceId,
    originalHtmlSha256: expected.sourceSha256,
    observedAt: expected.observedAt,
  });
  await store.put('product', {
    ...parsed.product,
    pendingSpecificationReview: ['netMassG', 'ingredients'],
  });
  await store.put('offer', parsed.offer);
  await store.put('evidence', {
    id: expected.evidenceId,
    url: expected.url,
    observedAt: expected.observedAt,
    role: 'listing',
    cacheId: `page:${expected.url}`,
    html: await store.putBlob(original),
  });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  app.collector.start = () => {
    throw new Error('Seller-original review cannot start a browser');
  };
  app.cache.fetch = () => {
    throw new Error('Seller-original review cannot download evidence');
  };
  t.after(() => app.close());
  return {
    app,
    store,
    directory,
    original,
    parsed,
    receiptPath: join(directory, 'receipt.json'),
  };
}

test('exact original Merino review clears only legacy mass pending and persists200g denominator and unchanged39000VND across restart', async (t) => {
  const { app, store, directory, parsed, receiptPath } = await fixture(t);
  const receipt = await reviewCachedIceSellingUnit(app, { receiptPath });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.sourceSha256, expected.sourceSha256);
  assert.match(receipt.excerpt, /40g\s*\/\s*cây/u);
  assert.deepEqual(receipt.selectedOptions, ['COMBO 5 cây']);
  assert.equal(receipt.totalNetMassG, 200);
  assert.equal(receipt.nutritionApproved, false);
  assert.deepEqual(JSON.parse(await readFile(receiptPath)), receipt);
  const product = await store.get('product', expected.productId);
  assert.equal(product.netMassG, 40);
  assert.equal(product.packCount, 5);
  assert.deepEqual(product.pendingSpecificationReview, ['ingredients']);
  assert.equal(product.proteinPer100g, undefined);
  assert.equal(product.manufacturerVerification, undefined);
  assert.deepEqual(await store.get('offer', parsed.offer.id), parsed.offer);
  const restarted = new LazadaSearch({
    store: new AssociativeStore({ directory: store.directory }),
    offline: true,
    ocr: false,
  });
  t.after(() => restarted.close());
  const report = await restarted.compare({
    allowStale: true,
    requireManufacturer: false,
    requireShipping: false,
  });
  assert.equal(report.comparisons[0].metrics.totalMassG, 200);
  assert.equal(report.comparisons[0].metrics.costPerGramBeforeDelivery, 195);
  assert.equal(report.comparisons[0].metrics.totalProteinG, null);
  const before = JSON.stringify(await store.list('product'));
  const again = await reviewCachedIceSellingUnit(restarted, {
    receiptPath: join(directory, 'again.json'),
  });
  assert.equal(again.applied, false);
  assert.equal(JSON.stringify(await store.list('product')), before);
});

async function noReviewAfter(t, change, reason) {
  const record = await fixture(t);
  await change(record);
  const before = JSON.stringify(
    await Promise.all(
      [
        'product',
        'offer',
        'evidence',
        'specification-hold',
        'cache',
        'invalidation',
      ].map((kind) => record.store.list(kind))
    )
  );
  let calls = 0;
  record.app.review = () => {
    calls++;
    throw new Error('Preflight must reject before review');
  };
  await assert.rejects(
    reviewCachedIceSellingUnit(record.app, { receiptPath: record.receiptPath }),
    reason
  );
  assert.equal(calls, 0);
  assert.equal(
    JSON.stringify(
      await Promise.all(
        [
          'product',
          'offer',
          'evidence',
          'specification-hold',
          'cache',
          'invalidation',
        ].map((kind) => record.store.list(kind))
      )
    ),
    before
  );
  await assert.rejects(access(record.receiptPath), /ENOENT/u);
}

test('changed original SHA, selected option metadata, timestamp, price or attached identity rejects before all writes', async (t) => {
  const changes = [
    async ({ store, original }) => {
      const evidence = await store.get('evidence', expected.evidenceId);
      await store.put('evidence', {
        ...evidence,
        html: await store.putBlob(
          Buffer.concat([original, Buffer.from('<!-- changed -->')])
        ),
      });
    },
    async ({ store }) => {
      const p = await store.get('product', expected.productId);
      await store.put('product', {
        ...p,
        selectedVariant: [{ text: '1 cây', selected: true }],
      });
    },
    async ({ store }) => {
      const p = await store.get('product', expected.productId);
      await store.put('product', { ...p, observedAt: '2026-10-11T00:00:00Z' });
    },
    async ({ store, parsed }) => {
      await store.put('offer', { ...parsed.offer, price: 1 });
    },
    async ({ store }) => {
      const p = await store.get('product', expected.productId);
      await store.put('product', { ...p, evidenceIds: [] });
    },
  ];
  for (const change of changes) {
    await noReviewAfter(t, change, /digest|match/u);
  }
});

test('explicit source/store holds, manual review, count pending and consistency invalidation cannot be overwritten', async (t) => {
  for (const change of [
    { specificationsInvalidated: true },
    { packageMassConsistency: { requiresReview: true } },
    { pendingSpecificationReview: ['netMassG', 'packCount'] },
    {
      claims: [
        { field: 'netMassG', source: 'manual-review', requiresReview: true },
      ],
    },
    {
      claims: [
        {
          field: 'netMassG',
          source: 'dom',
          invalidatedAt: expected.observedAt,
        },
      ],
    },
    { crossChecks: [{ conflicts: [{ field: 'netMassG' }] }] },
  ]) {
    await noReviewAfter(
      t,
      async ({ store }) => {
        const p = await store.get('product', expected.productId);
        await store.put('product', { ...p, ...change });
      },
      /prevents/u
    );
  }
  for (const field of ['netMassG', 'packCount']) {
    await noReviewAfter(
      t,
      async ({ store }) => {
        await store.put('specification-hold', {
          id: `${expected.sku}:${field}`,
          field,
          active: true,
          evidenceId: expected.evidenceId,
        });
      },
      /Active explicit/u
    );
  }
});

test('seller-source review refuses private or online application configuration', async (t) => {
  const { app } = await fixture(t);
  app.cache.offline = false;
  await assert.rejects(reviewCachedIceSellingUnit(app), /offline public/u);
  app.cache.offline = true;
  app.store.visibility = 'private';
  await assert.rejects(reviewCachedIceSellingUnit(app), /offline public/u);
});

test('separate original cache and URL, evidence or cache invalidation records reject before review or receipt writes', async (t) => {
  await noReviewAfter(
    t,
    async ({ store }) => {
      await store.put('cache', {
        id: `page:${expected.url}`,
        url: expected.url,
        invalidatedAt: expected.observedAt,
      });
    },
    /source cache invalidation/u
  );
  for (const binding of [
    { url: expected.url },
    { evidenceIds: [expected.evidenceId] },
    { cacheIds: [`page:${expected.url}`] },
  ]) {
    await noReviewAfter(
      t,
      async ({ store }) => {
        await store.put('invalidation', {
          id: 'explicit-original-invalidation',
          ...binding,
          invalidatedAt: expected.observedAt,
        });
      },
      /original source invalidation/u
    );
  }
});
