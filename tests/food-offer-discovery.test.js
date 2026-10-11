import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct, validateOffer } from '../src/products.js';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { mergeFoodOfferDiscovery } from '../src/food-offer-discovery.js';
import { calculateOffer } from '../src/compare.js';

test('original bonus SKU automatically exposes potential food and holds paid mass without approving gift amounts', async () => {
  const html = await readFile(
    new URL(
      '../docs/acceptance/bonus-hydropure-evidence/3255422832-cached-public.html',
      import.meta.url
    )
  );
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i3255422832.html',
  });
  const parsed = parseProduct(snapshot, {
    evidenceId: 'original-bonus',
    originalHtmlSha256: sha256(html),
    observedAt: '2026-10-10T21:09:54.492Z',
  });
  const offer = validateOffer(parsed.offer);
  assert.equal(offer.price, 1790000);
  assert.equal(offer.foodComponents.length, 1);
  assert.equal(offer.foodComponents[0].status, 'potential');
  assert.equal(offer.foodComponents[0].facts, undefined);
  assert.equal(offer.foodComponents[0].eligibility, undefined);
  assert.equal(
    offer.foodComponents[0].discovery.source.sourceSha256,
    sha256(html)
  );
  assert.equal(parsed.product.netMassG, 2000);
  assert.equal(parsed.product.packCount, 2);
  const row = calculateOffer(parsed.product, offer);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.foodComponents.confirmedBonuses.length, 0);
  assert.equal(row.metrics.foodComponents.potentialBonuses.length, 1);
});

test('identical-source replay preserves reviewed components and merges additional observations', () => {
  const previous = {
    id: 'offer',
    foodComponents: [
      {
        id: 'gift',
        kind: 'bonus-food',
        status: 'confirmed',
        review: { evidenceId: 'original', identityMatched: true },
      },
    ],
  };
  const current = {
    id: 'offer',
    price: 100,
    foodComponents: [
      { id: 'gift', kind: 'bonus-food', status: 'potential' },
      { id: 'shaker', kind: 'non-food' },
    ],
  };
  const before = globalThis.structuredClone({ previous, current });
  const result = mergeFoodOfferDiscovery(previous, current);
  assert.equal(result.foodComponents[0].status, 'confirmed');
  assert.equal(result.foodComponents.length, 2);
  assert.equal(result.price, 100);
  assert.deepEqual({ previous, current }, before);
});

test('refresh preserves newly discovered holds even when the previous saved product had none', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-mass-refresh-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const source = JSON.parse(
    await readFile(
      new URL(
        './fixtures/package-mass-consistency/source.json',
        import.meta.url
      )
    )
  );
  const html = gunzipSync(
    await readFile(
      new URL(
        `./fixtures/package-mass-consistency/${source.html}`,
        import.meta.url
      )
    )
  );
  assert.equal(sha256(html), source.htmlSha256);
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({ document, url: source.url });
  const parsed = parseProduct(snapshot);
  delete parsed.product.pendingSpecificationReview;
  await store.put('product', {
    ...parsed.product,
    observedAt: '2026-10-10T00:00:00Z',
    title: 'Earlier source title without the new conflict',
  });
  const blob = await store.putBlob(html);
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    collector: {
      page: async () => ({
        snapshot,
        html: blob,
        status: 'ok',
        fetchedAt: Date.parse(source.observedAt),
        id: `lazada:${source.url}`,
        cacheHit: true,
      }),
      close: async () => {},
    },
  });
  t.after(() => app.close());
  const result = await app.collect(source.url);
  assert.ok(result.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(result.offer.price, 2750000);
  assert.ok(
    (
      await store.get('product', result.product.id)
    ).pendingSpecificationReview.includes('netMassG')
  );
  const restarted = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  t.after(() => restarted.close());
  const report = await restarted.compare({
    category: 'whey',
    allowStale: true,
  });
  assert.equal(report.comparisons[0].metrics.totalMassG, null);
});

async function bonusReplayFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-bonus-replay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const html = await readFile(
    new URL(
      '../docs/acceptance/bonus-hydropure-evidence/3255422832-cached-public.html',
      import.meta.url
    )
  );
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i3255422832.html',
  });
  const capture = {
    snapshot,
    html: await store.putBlob(html),
    status: 'ok',
    fetchedAt: Date.parse('2026-10-10T21:09:54.492Z'),
    id: `lazada:${snapshot.url}`,
    cacheHit: true,
  };
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    collector: { page: async () => capture, close: async () => {} },
  });
  t.after(() => app.close());
  const first = await app.collect(snapshot.url);
  // Exercise operator-approved fixture values through the actual review API;
  // this isolated test grants no new facts to the public catalog.
  await app.review(first.product.id, 'netMassG', 1000, first.offer.evidenceId);
  await app.review(first.product.id, 'packCount', 2, first.offer.evidenceId);
  return { app, store, capture, first };
}

test('identical original replay preserves operator-reviewed paid mass and keeps the gift unapproved', async (t) => {
  const { app, capture, first } = await bonusReplayFixture(t);
  const result = await app.collect(capture.snapshot.url);
  assert.equal(result.product.netMassG, 1000);
  assert.equal(result.product.packCount, 2);
  assert.ok(!result.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(result.offer.price, first.offer.price);
  assert.equal(result.offer.foodComponents[0].status, 'potential');
  const row = calculateOffer(result.product, result.offer, {
    allowStale: true,
  });
  assert.equal(row.metrics.totalMassG, 2000);
  assert.equal(row.metrics.foodComponents.confirmedBonuses.length, 0);
});

test('same-date changed original bytes cannot waive a newly discovered paid-mass hold', async (t) => {
  const { app, store, capture } = await bonusReplayFixture(t);
  const original = await store.blob(capture.html.sha256);
  capture.html = await store.putBlob(
    Buffer.concat([original, Buffer.from('<!-- changed original -->')])
  );
  const result = await app.collect(capture.snapshot.url);
  assert.ok(result.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(
    calculateOffer(result.product, result.offer, { allowStale: true }).metrics
      .totalMassG,
    null
  );
});
