import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  LazadaSearch,
  reviewListingCategory,
} from '../src/index.js';
import { executeCommand } from '../src/commands.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-category-review-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  app.collector.start = () => {
    throw new Error('Category review must reuse saved evidence');
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const capture = (item, sku, time = 0) =>
    app.importCapture({
      url: `https://www.lazada.vn/products/chocolate-cone-i${item}-s${sku}.html`,
      observedAt: new Date(
        Date.parse('2026-10-09T09:00:00Z') + time
      ).toISOString(),
      html: `<h1>Kem ốc quế chocolate 35g</h1><span data-product-price>100.000 ₫</span><div class="key-li"><span class="key-title">SKU</span><span class="key-value">${item}_VNAMZ-${sku}</span></div>`,
    });
  return { app, directory, capture };
}

test('listing quarantine survives new SKU imports, refreshed captures and URL aliases, while retaining every price', async (t) => {
  const { app, directory, capture } = await setup(t);
  const first = await capture(100, 11);
  assert.equal(first.product.category, 'chocolate-ice-cream');
  const review = {
    category: 'unknown',
    evidenceId: first.product.evidenceIds[0],
    reviewedBy: 'Fixture reviewer',
    reason:
      'Package image shows an ambient crispy cone snack; frozen identity is unverified.',
  };
  await reviewListingCategory(app, first.product.url, review);
  const next = await capture(100, 12, 1000);
  assert.equal(next.product.category, 'unknown');
  assert.equal(next.product.categoryReview.status, 'quarantined');
  const refreshed = await capture(100, 11, 2000);
  assert.equal(refreshed.product.category, 'unknown');
  assert.ok(
    refreshed.product.corrections.some(
      (c) => c.field === 'category' && c.previous === 'chocolate-ice-cream'
    )
  );
  const other = await capture(200, 11);
  assert.equal(other.product.category, 'chocolate-ice-cream');
  const prices = await app.store.list('offer');
  assert.equal(prices.length, 3);
  assert.ok(prices.every((o) => o.price === 100000));
  const ice = await app.compare({
    category: 'chocolate-ice-cream',
    allowStale: true,
  });
  assert.deepEqual(
    ice.comparisons.map((r) => r.product.id),
    [other.product.id]
  );
  assert.equal(app.cache.stats.downloads, 0);
  const path = join(directory, 'review.json');
  await writeFile(
    path,
    JSON.stringify({
      ...review,
      category: 'chocolate-ice-cream',
      reason: 'New fixture evidence confirms frozen identity.',
    })
  );
  await executeCommand(app, 'review-category', [first.product.url, path]);
  assert.equal(
    (await app.store.get('product', next.product.id)).category,
    'chocolate-ice-cream'
  );
  assert.equal((await app.store.list('category-review-history')).length, 1);
  assert.ok(
    (await app.store.get('product', next.product.id)).claims.some(
      (c) =>
        c.field === 'category' &&
        c.value === 'chocolate-ice-cream' &&
        c.reviewedBy === review.reviewedBy
    )
  );
});

test('listing category review rejects another item evidence and incomplete review details', async (t) => {
  const { app, capture } = await setup(t);
  const first = await capture(100, 11);
  const other = await capture(200, 11);
  const review = {
    category: 'unknown',
    evidenceId: other.product.evidenceIds[0],
    reviewedBy: 'Fixture reviewer',
    reason: 'Review reason',
  };
  await assert.rejects(
    reviewListingCategory(app, first.product.url, review),
    /same Lazada item/u
  );
  await assert.rejects(
    reviewListingCategory(app, first.product.url, {
      ...review,
      reviewedBy: '',
    }),
    /reviewer and reason/u
  );
  await assert.rejects(
    reviewListingCategory(app, first.product.url, {
      ...review,
      category: 'guessed',
    }),
    /supported category/u
  );
  assert.equal((await app.store.list('category-review')).length, 0);
});
