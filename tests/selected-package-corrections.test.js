import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import {
  applySelectedPackageCorrections,
  prepareSelectedPackageCorrections,
} from '../scripts/apply-selected-package-corrections.mjs';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { applySpecificationHolds } from '../src/specification-holds.js';
import { hasReviewedPackageMass } from '../src/reviewed-package-mass.js';
import { calculateOffer } from '../src/compare.js';
import { sha256 } from '../src/util.js';

async function fixture() {
  const receipt = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/source-integrity/selected-package-corrections.json',
        import.meta.url
      )
    )
  );
  const records = new Map();
  const blobs = new Map();
  const writes = [];
  const store = {
    visibility: 'public',
    get: async (kind, id) =>
      globalThis.structuredClone(records.get(`${kind}:${id}`)),
    list: async (kind) =>
      [...records]
        .filter(([key]) => key.startsWith(`${kind}:`))
        .map(([, value]) => globalThis.structuredClone(value)),
    blob: async (hash) => blobs.get(hash),
    put: async (kind, record) => {
      writes.push({ kind, id: record.id });
      records.set(`${kind}:${record.id}`, globalThis.structuredClone(record));
      return globalThis.structuredClone(record);
    },
  };
  for (const action of receipt.actions) {
    for (const source of [action.source, action.image, action.panel].filter(
      Boolean
    )) {
      const bytes = gunzipSync(
        await readFile(new URL(`../${source.path}`, import.meta.url))
      );
      assert.equal(sha256(bytes), source.sha256);
      blobs.set(source.sha256, bytes);
      if (source !== action.source) {
        records.set(`cache:image:${source.url}`, {
          id: `image:${source.url}`,
          url: source.url,
          blob: { sha256: source.sha256, bytes: bytes.length },
        });
      }
    }
    const html = blobs.get(action.source.sha256);
    const snapshot = extractPage({
      document: parseHTML(html.toString()).document,
      url: action.source.url,
    });
    const parsed = parseProduct(snapshot, {
      evidenceId: action.source.evidenceId,
      observedAt: action.observedAt,
    });
    assert.equal(parsed.product.id, action.productId);
    assert.equal(parsed.offer.id, action.offerId);
    records.set(`product:${action.productId}`, parsed.product);
    records.set(`offer:${action.offerId}`, parsed.offer);
    records.set(`evidence:${action.source.evidenceId}`, {
      id: action.source.evidenceId,
      url: action.source.url,
      role: 'listing',
      html: { sha256: action.source.sha256, bytes: html.length },
      observedAt: action.observedAt,
    });
  }
  return { receipt, records, blobs, writes, store };
}

test('actual original selected label corrects only ON mass while conflicting Yingbang mass remains held and prices stay untouched', async () => {
  const { store, receipt, writes } = await fixture();
  const [on, yingbang] = receipt.actions;
  const beforeOn = await store.get('product', on.productId);
  const beforeYingbang = await store.get('product', yingbang.productId);
  const offersBefore = await store.list('offer');
  const result = await applySelectedPackageCorrections(store, receipt);
  assert.equal(result.status, 'applied');
  const corrected = await store.get('product', on.productId);
  assert.equal(corrected.netMassG, 864);
  assert.equal(corrected.observedAt, beforeOn.observedAt);
  assert.deepEqual(
    corrected.manufacturerVerification,
    beforeOn.manufacturerVerification
  );
  assert.deepEqual(corrected.ingredients, beforeOn.ingredients);
  assert.equal(corrected.proteinPer100g, beforeOn.proteinPer100g);
  assert.equal(corrected.claims.length, beforeOn.claims.length + 1);
  assert.deepEqual(corrected.claims.slice(0, -1), beforeOn.claims);
  const claim = corrected.claims.at(-1);
  assert.equal(claim.source, 'selected-package-label-review');
  assert.equal(claim.selectedSku, on.sku);
  assert.equal(claim.imageSha256, on.image.sha256);
  assert.equal(claim.originalHtmlSha256, on.source.sha256);
  assert.equal(hasReviewedPackageMass(corrected), true);
  assert.deepEqual(await store.list('offer'), offersBefore);
  assert.deepEqual(
    await store.get('product', yingbang.productId),
    beforeYingbang
  );
  const hold = await store.get('specification-hold', yingbang.holdId);
  assert.equal(hold.active, true);
  assert.equal(hold.imageSha256, yingbang.image.sha256);
  assert.equal(hold.alternateValueApproved, null);
  const held = await applySpecificationHolds(store, beforeYingbang);
  assert.equal(held.netMassG, undefined);
  const row = calculateOffer(held, await store.get('offer', yingbang.offerId));
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.offer.price, 484324);
  assert.deepEqual(
    writes.map((write) => write.kind),
    ['product', 'specification-hold']
  );
});

test('both source actions preflight before writes and a corrupted Yingbang panel rejects the ON correction too', async () => {
  const { store, receipt, blobs, writes } = await fixture();
  blobs.set(receipt.actions[1].panel.sha256, Buffer.from('changed original'));
  await assert.rejects(
    applySelectedPackageCorrections(store, receipt),
    /digest mismatch/u
  );
  assert.equal(writes.length, 0);
  assert.equal(
    (await store.get('product', receipt.actions[0].productId)).netMassG,
    receipt.actions[0].expectedRawMassG
  );
});

test('changed selected SKU, observation date or price cannot receive a historical package correction', async () => {
  for (const [field, value] of [
    ['sku', '13463872611_VNAMZ-117339168805'],
    ['observedAt', '2026-10-11T05:00:29.475Z'],
    ['price', 999],
  ]) {
    const { store, receipt, records, writes } = await fixture();
    records.get(`offer:${receipt.actions[0].offerId}`)[field] = value;
    await assert.rejects(applySelectedPackageCorrections(store, receipt));
    assert.equal(writes.length, 0, field);
  }
});

test('invalidated image and forged replacement source digest cannot authorize an exact selected review', async () => {
  const first = await fixture();
  first.records.get(
    `cache:image:${first.receipt.actions[0].image.url}`
  ).invalidatedAt = '2026-10-11T09:00:00Z';
  await assert.rejects(
    prepareSelectedPackageCorrections(first.store, first.receipt),
    /image was invalidated/u
  );
  assert.equal(first.writes.length, 0);
  const second = await fixture();
  second.receipt.actions[0].image.sha256 =
    second.receipt.actions[1].image.sha256;
  await assert.rejects(
    prepareSelectedPackageCorrections(second.store, second.receipt)
  );
  assert.equal(second.writes.length, 0);
});

test('an existing exact disagreeing mass review is preserved and private stores are rejected', async () => {
  const first = await fixture();
  const product = first.records.get(
    `product:${first.receipt.actions[0].productId}`
  );
  product.netMassG = 900;
  product.reviewedFields = ['netMassG'];
  product.claims.push({
    field: 'netMassG',
    value: 900,
    source: 'manual-review',
    evidenceId: first.receipt.actions[0].source.evidenceId,
    requiresReview: false,
    reviewedAt: '2026-10-11T09:30:00Z',
  });
  await assert.rejects(
    prepareSelectedPackageCorrections(first.store, first.receipt),
    /Existing exact mass review/u
  );
  assert.equal(first.writes.length, 0);
  const second = await fixture();
  second.store.visibility = 'private';
  await assert.rejects(
    prepareSelectedPackageCorrections(second.store, second.receipt),
    /public offline store/u
  );
});

test('reapplying identical exact evidence is idempotent and does not duplicate claims or correction history', async () => {
  const { store, receipt } = await fixture();
  await applySelectedPackageCorrections(store, receipt);
  const before = await store.get('product', receipt.actions[0].productId);
  await applySelectedPackageCorrections(store, receipt);
  assert.deepEqual(
    await store.get('product', receipt.actions[0].productId),
    before
  );
});
