import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { selectedPackageImage } from '../src/package-image.js';
import { applySharedPackageArtworkConflict } from '../src/package-artwork-consistency.js';
import { calculateOffer } from '../src/compare.js';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';

const observedAt = '2026-10-11T01:00:00.000Z';
const imageUrl = 'https://img.lazcdn.com/g/package.jpg';
function fixture() {
  return {
    product: {
      id: 'artwork-fixture',
      sku: '123_VNAMZ-456',
      category: 'whey',
      title: 'Whey Chocolate 2lb',
      selectedVariant: [{ text: 'Chocolate 2lb' }],
      netMassG: 907.18474,
      packCount: 1,
      proteinPer100g: 80,
      ingredients: [],
      observedAt,
      claims: [],
      evidenceIds: [],
      warnings: [],
    },
    snapshot: {
      sku: '123_VNAMZ-456',
      skuCatalogObserved: true,
      skuCatalog: [
        { sku: '456', image: imageUrl },
        { sku: '789', image: imageUrl },
      ],
      productImages: [imageUrl],
    },
    evidence: {
      text: 'Chocolate; NET WT 1KG',
      imageUrl,
      imageSha256: 'a'.repeat(64),
      matchedImageSha256: 'a'.repeat(64),
      originalHtmlSha256: 'b'.repeat(64),
      confidence: 0.98,
      observedAt,
      evidenceId: 'artwork-evidence',
    },
  };
}

test('shared selected artwork cannot approve an OCR mass or replace an original selling amount', () => {
  const { product, snapshot, evidence } = fixture();
  assert.equal(selectedPackageImage(snapshot, product, imageUrl), undefined);
  const original = globalThis.structuredClone(product);
  assert.equal(
    applySharedPackageArtworkConflict(product, snapshot, evidence)
      .requiresReview,
    true
  );
  assert.equal(product.netMassG, original.netMassG);
  assert.equal(product.proteinPer100g, original.proteinPer100g);
  assert.equal(product.manufacturerVerification, undefined);
  assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  assert.equal(product.claims[0].replacementMassApproved, false);
  assert.equal(product.claims[0].consistencyReviewRequired, true);
  assert.deepEqual(product.claims[0].sharedCatalogSkuIds, ['456', '789']);
  applySharedPackageArtworkConflict(product, snapshot, evidence);
  assert.equal(product.packageArtworkConflicts.length, 1);
  assert.equal(product.claims.length, 1);
  const offer = {
    id: 'offer:artwork-fixture',
    productId: product.id,
    price: 484324,
    currency: 'VND',
    variantConfirmed: true,
    observedAt,
  };
  const metrics = calculateOffer(product, offer, {
    requireManufacturer: false,
    requireShipping: false,
  }).metrics;
  assert.equal(metrics.costPerGramBeforeDelivery, null);
  assert.equal(metrics.costPerProteinGramBeforeDelivery, null);
  assert.equal(offer.price, 484324);
});

test('wrong SKU, source date, asset, digest, confidence and non-package text cannot establish an artwork hold', () => {
  for (const changes of [
    { observedAt: '2026-10-10T01:00:00.000Z' },
    { observedAt: 'invalid' },
    { imageUrl: 'https://img.lazcdn.com/g/sibling.jpg' },
    { matchedImageSha256: '0'.repeat(64) },
    { imageSha256: 'invalid' },
    { originalHtmlSha256: undefined },
    { confidence: 0.89 },
    { confidence: NaN },
    { confidence: 1.01 },
    { evidenceId: undefined },
    { text: 'Serving size 30g; Protein 25g; 74 servings' },
    { text: 'Chocolate; NET WT 907g' },
    { text: 'NET WEIGHT 1000g; NET WEIGHT 500g' },
  ]) {
    const { product, snapshot, evidence } = fixture();
    const original = globalThis.structuredClone(product);
    assert.equal(
      applySharedPackageArtworkConflict(product, snapshot, {
        ...evidence,
        ...changes,
      }).applied,
      false,
      JSON.stringify(changes)
    );
    assert.deepEqual(product, original);
  }
  for (const changes of [
    { sku: '123_VNAMZ-789' },
    { skuCatalogObserved: false },
    { skuCatalog: [{ sku: '456', image: imageUrl }] },
  ]) {
    const { product, snapshot, evidence } = fixture();
    assert.equal(
      applySharedPackageArtworkConflict(
        product,
        {
          ...snapshot,
          ...changes,
        },
        evidence
      ).applied,
      false
    );
    assert.equal(product.pendingSpecificationReview, undefined);
  }
});

test('even a one-gram difference in declared metric mass requires review, while rounded imperial equivalence does not', () => {
  const { product, snapshot, evidence } = fixture();
  product.netMassG = 1000;
  product.massEvidence = { selected: { metric: true } };
  assert.equal(
    applySharedPackageArtworkConflict(product, snapshot, {
      ...evidence,
      text: 'NET WT 1001g',
    }).requiresReview,
    true
  );
  assert.equal(product.netMassG, 1000);
});

test('cross-CDN aliases require an exact observed hash-shaped asset, protocol, extension and query', () => {
  const key = 'a'.repeat(32);
  const catalog = `https://laz-img-sg.alicdn.com/p/${key}.jpg`;
  const gallery = `https://img.lazcdn.com/g/p/${key}.jpg_720x720q80.jpg_.webp`;
  const { product, snapshot } = fixture();
  snapshot.skuCatalog = [{ sku: '456', image: catalog }];
  snapshot.productImages = [gallery];
  assert.ok(selectedPackageImage(snapshot, product, gallery));
  for (const invalid of [
    gallery.replace(key, 'b'.repeat(32)),
    gallery.replace('https:', 'http:'),
    `${gallery}?version=2`,
    gallery.replace('.com/', '.com.other.example/'),
    gallery.replace(key, 'package'),
    `${gallery}.backup`,
  ]) {
    assert.equal(
      selectedPackageImage(
        { ...snapshot, productImages: [invalid] },
        product,
        invalid
      ),
      undefined
    );
  }
  assert.equal(
    selectedPackageImage({ ...snapshot, productImages: [] }, product, gallery),
    undefined
  );
  assert.equal(
    selectedPackageImage(
      {
        ...snapshot,
        skuCatalog: [
          {
            sku: '456',
            image: catalog.replace('laz-img-sg.alicdn.com', 'other.alicdn.com'),
          },
        ],
      },
      product,
      gallery
    ),
    undefined
  );
});

test('actual Yingbang original binds conflicting shared artwork, while ON selected artwork remains unique', async () => {
  const receipt = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/source-integrity/selected-package-corrections.json',
        import.meta.url
      )
    )
  );
  for (const action of receipt.actions) {
    const html = gunzipSync(
      await readFile(new URL(`../${action.source.path}`, import.meta.url))
    );
    const image = gunzipSync(
      await readFile(new URL(`../${action.image.path}`, import.meta.url))
    );
    assert.equal(sha256(html), action.source.sha256);
    assert.equal(sha256(image), action.image.sha256);
    const snapshot = extractPage({
      document: parseHTML(html.toString()).document,
      url: action.source.url,
    });
    const { product, offer } = parseProduct(snapshot, {
      observedAt: action.observedAt,
    });
    if (action.kind === 'selected-package-mass-review') {
      assert.ok(selectedPackageImage(snapshot, product, action.image.url));
      continue;
    }
    assert.equal(
      selectedPackageImage(snapshot, product, action.image.url),
      undefined
    );
    const originalPrice = offer.price;
    const originalMass = product.netMassG;
    const result = applySharedPackageArtworkConflict(product, snapshot, {
      text: action.excerpts.join('\n'),
      imageUrl: action.image.url,
      imageSha256: sha256(image),
      matchedImageSha256: sha256(image),
      originalHtmlSha256: sha256(html),
      confidence: 1,
      observedAt: action.observedAt,
      evidenceId: action.source.evidenceId,
    });
    assert.equal(result.applied, true);
    assert.equal(result.candidateMassG, 1000);
    assert.equal(product.netMassG, originalMass);
    assert.equal(offer.price, originalPrice);
    assert.equal(product.manufacturerVerification, undefined);
    assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  }
});

test('application retains selling mass and persists shared-artwork OCR review hold', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-shared-artwork-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const blob = await store.putBlob('synthetic shared artwork fixture');
  const { product, snapshot, evidence } = fixture();
  const app = new LazadaSearch({
    store,
    offline: true,
    cache: { offline: true, image: async () => ({ blob }) },
    ocr: {
      recognize: async () => ({
        id: 'shared-artwork-test',
        imageHash: blob.sha256,
        text: evidence.text,
        confidence: 0.98,
        psm: 6,
      }),
    },
  });
  t.after(() => app.close());
  await app.collectOcr(product, {
    snapshot,
    html: { sha256: evidence.originalHtmlSha256 },
  });
  assert.equal(product.netMassG, 907.18474);
  assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  assert.equal(product.ocrCoverage.failed, 0);
  assert.equal(product.packageArtworkConflicts[0].imageSha256, blob.sha256);
  const saved = await store.get(
    'evidence',
    product.packageArtworkConflicts[0].evidenceId
  );
  assert.equal(saved.image.sha256, blob.sha256);
  assert.equal(product.corrections, undefined);
});
