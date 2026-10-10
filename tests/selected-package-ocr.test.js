import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { selectedPackageImage } from '../src/package-image.js';
import { calculateOffer } from '../src/compare.js';
import { specificationProblems } from '../src/verification.js';

const selectedUrl = 'https://img.lazcdn.com/g/package.jpg';
const resizedUrl = `${selectedUrl}_720x720q80.jpg_.webp`;
const product = () => ({
  id: 'selected-ocr-product',
  sku: '123_VNAMZ-456',
  url: 'https://www.lazada.vn/products/pdp-i123.html?skuId=456',
  title: 'Chocolate whey protein 2 lbs',
  category: 'protein-powder',
  selectedVariant: [{ text: 'Chocolate' }],
  netMassG: 2 * 453.59237,
  ingredients: [],
  claims: [],
  evidenceIds: [],
  warnings: [],
});
const snapshot = () => ({
  url: 'https://www.lazada.vn/products/pdp-i123.html?skuId=456',
  sku: '123_VNAMZ-456',
  skuCatalogObserved: true,
  skuCatalog: [
    { sku: '456', image: selectedUrl },
    { sku: '789', image: 'https://img.lazcdn.com/g/vanilla.jpg' },
  ],
  productImages: [resizedUrl],
});

test('package-image matching requires a displayed SKU and the same original image asset', () => {
  assert.equal(
    selectedPackageImage(snapshot(), product(), resizedUrl).catalogSku,
    '456'
  );
  for (const change of [
    { skuCatalogObserved: false },
    { sku: undefined },
    { sku: '123_VNAMZ-789' },
    {
      skuCatalog: [{ sku: '456', image: 'https://other.example/package.jpg' }],
    },
  ]) {
    assert.equal(
      selectedPackageImage({ ...snapshot(), ...change }, product(), resizedUrl),
      undefined
    );
  }
  assert.equal(
    selectedPackageImage(snapshot(), product(), 'invalid'),
    undefined
  );
  assert.equal(
    selectedPackageImage(snapshot(), product(), `${selectedUrl}?other=sibling`),
    undefined
  );
  for (const change of [
    { selectedVariant: [{ sku: '123_VNAMZ-789' }] },
    { selectedVariant: [{ sku: '456' }, { sku: '789' }] },
    { skuCatalogObserved: 'true' },
    {
      skuCatalog: [
        { sku: '456', image: `${selectedUrl}_720x720q80-other.jpg` },
      ],
    },
  ]) {
    assert.equal(
      selectedPackageImage({ ...snapshot(), ...change }, product(), resizedUrl),
      undefined
    );
  }
});

test('application OCR corrects a matched selected package and preserves generic gallery and screenshot claims', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-selected-ocr-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const blob = await store.putBlob('synthetic selected package image fixture');
  const app = new LazadaSearch({
    store,
    offline: true,
    cache: {
      offline: true,
      image: async () => ({ blob }),
      stats: { downloads: 0 },
    },
    ocr: {
      recognize: async (image) => ({
        id: image.sha256,
        imageHash: image.sha256,
        text: 'CHOCOLATE; NET WEIGHT 2 LBS (907 G)',
        confidence: 0.95,
        psm: 6,
      }),
    },
  });
  t.after(() => app.close());
  const current = product();
  await app.collectOcr(current, { snapshot: snapshot() });
  assert.equal(current.netMassG, 907);
  assert.equal(current.corrections[0].previous, 2 * 453.59237);
  assert.equal(current.manufacturerVerification, undefined);
  assert.equal(current.ocrCoverage.failed, 0);
  const evidence = await store.get('evidence', current.evidenceIds[0]);
  assert.equal(evidence.image.sha256, blob.sha256);
  for (const changed of [
    { ...snapshot(), sku: undefined },
    {
      ...snapshot(),
      productImages: ['https://img.lazcdn.com/g/unmatched.jpg'],
    },
    { ...snapshot(), productImages: [] },
  ]) {
    const unbound = product();
    delete unbound.netMassG;
    await app.collectOcr(unbound, { snapshot: changed, screenshot: blob });
    assert.equal(unbound.netMassG, undefined);
    assert.ok(unbound.claims.some((claim) => claim.field === 'netMassG'));
    assert.ok(unbound.claims.every((claim) => claim.requiresReview));
  }
});

test('application rejects OCR mass with a mismatched digest or low confidence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-selected-ocr-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const blob = await store.putBlob('synthetic guarded selected image fixture');
  for (const changed of [{ imageHash: '0'.repeat(64) }, { confidence: 0.89 }]) {
    const app = new LazadaSearch({
      store,
      offline: true,
      cache: { offline: true, image: async () => ({ blob }) },
      ocr: {
        recognize: async () => ({
          id: 'guard-fixture',
          imageHash: blob.sha256,
          text: 'CHOCOLATE; NET WEIGHT 907 G',
          confidence: 0.95,
          ...changed,
        }),
      },
    });
    const current = product();
    await app.collectOcr(current, { snapshot: snapshot() });
    assert.equal(current.netMassG, 2 * 453.59237);
    await app.close();
  }
});

test('a conflicting selected package blocks the former factory denominator until explicit evidence review', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-package-rereview-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const blob = await store.putBlob('synthetic 900 g selected package');
  const app = new LazadaSearch({
    store,
    offline: true,
    cache: { offline: true, image: async () => ({ blob }) },
    ocr: {
      recognize: async () => ({
        id: 'conflicting-label',
        imageHash: blob.sha256,
        text: 'CHOCOLATE; NET WEIGHT 900 G',
        confidence: 0.98,
      }),
    },
  });
  t.after(() => app.close());
  const current = product();
  current.netMassG = 907;
  current.proteinPer100g = 80;
  current.manufacturerVerification = { identityMatched: true };
  current.reviewedFields = ['netMassG'];
  current.claims.push({
    field: 'netMassG',
    value: 907,
    source: 'manufacturer',
    requiresReview: false,
  });
  await app.collectOcr(current, { snapshot: snapshot() });
  assert.equal(current.netMassG, 907);
  assert.equal(current.manufacturerVerification.identityMatched, true);
  assert.deepEqual(current.pendingSpecificationReview, ['netMassG']);
  assert.equal(current.specificationsInvalidated, undefined);
  const offer = {
    id: 'conflicting-package-offer',
    productId: current.id,
    url: snapshot().url,
    price: 907000,
    currency: 'VND',
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  };
  const blocked = calculateOffer(current, offer, {
    requireManufacturer: false,
    requireShipping: false,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.metrics.totalMassG, null);
  assert.equal(blocked.metrics.costPerGramBeforeDelivery, null);
  assert.equal(blocked.metrics.costPerProteinGramBeforeDelivery, null);
  assert.ok(
    specificationProblems(current).some((problem) =>
      /New selected-package/u.test(problem)
    )
  );
  await store.put('product', current);
  const reviewed = await app.review(
    current.id,
    'netMassG',
    900,
    current.evidenceIds[0]
  );
  assert.deepEqual(reviewed.pendingSpecificationReview, []);
  assert.equal(reviewed.netMassG, 900);
  assert.equal(
    calculateOffer(reviewed, offer, { requireManufacturer: false }).metrics
      .costPerGramBeforeDelivery,
    907000 / 900
  );
  // A seller can assign its original-container image to a smaller repack SKU.
  // A bound image must not silently replace that option's declared metric size.
  const repack = product();
  repack.netMassG = 1000;
  repack.selectedVariant.push({ text: '1 kg repack' });
  repack.massEvidence = {
    selected: { origin: 'selected-option', metric: true },
  };
  await app.collectOcr(repack, { snapshot: snapshot() });
  assert.equal(repack.netMassG, 1000);
  assert.deepEqual(repack.pendingSpecificationReview, ['netMassG']);
  assert.equal(repack.manufacturerVerification, undefined);
});
