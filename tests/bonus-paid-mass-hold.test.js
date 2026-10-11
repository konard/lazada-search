import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, calculateOffer } from '../src/index.js';
import { DEFAULT_ARCHIVE } from '../src/archive.js';
import { resolveProductReviews } from '../src/catalog-products.js';
import { sha256 } from '../src/util.js';
import { deadlineFoodGramRanking } from '../scripts/deadline-report-costs.mjs';

test('original two-paid-bag source ambiguity cannot produce a false 4000g whey price winner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-bonus-mass-hold-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, archive: DEFAULT_ARCHIVE });
  const hold = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/bonus-food-followup/specification-hold.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const review = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/bonus-food-followup/review.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const evidence = await store.get('evidence', hold.evidenceId);
  assert.equal(evidence.html.sha256, hold.originalHtmlSha256);
  const original = await store.blob(hold.originalHtmlSha256);
  assert.equal(sha256(original), hold.originalHtmlSha256);
  assert.ok(original.toString().includes('2 túi tặng 1 túi'));
  assert.equal(hold.alternateValueApproved, null);
  assert.equal(review.sources[1].selectedSkuIdentityMatched, false);
  assert.equal(sha256(await readFile(hold.imagePath)), hold.imageSha256);
  const archivedHold = await store.get('specification-hold', hold.id);
  assert.equal(archivedHold.active, true);
  assert.equal(archivedHold.originalHtmlSha256, hold.originalHtmlSha256);
  const captured = await store.get('product', hold.productId);
  const offer = await store.get('offer', hold.offerId);
  assert.equal(offer.sku, hold.sku);
  // Replay the disputed original per-pouch interpretation, independently of
  // any later exact manufacturer correction to the current catalog.
  const product = {
    ...captured,
    netMassG: 2000,
    packCount: 2,
    manufacturerVerification: undefined,
  };
  const options = { allowStale: true, requireManufacturer: false };
  assert.equal(
    calculateOffer(product, offer, options).metrics.totalMassG,
    4000
  );
  const resolved = await resolveProductReviews(store, product);
  const row = calculateOffer(resolved, offer, options);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.costPerGramBeforeDelivery, null);
  assert.equal(row.metrics.costPerGramAfterDelivery, null);
  assert.equal(row.metrics.totalProteinG, null);
  assert.deepEqual(deadlineFoodGramRanking([row]), []);
  assert.equal(row.offer.price, offer.price);
  assert.equal(row.offer.observedAt, offer.observedAt);
  assert.equal(product.netMassG, 2000);
  assert.equal(product.packCount, 2);
});
