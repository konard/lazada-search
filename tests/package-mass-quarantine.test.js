import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { applySelectedPackageMass, parseProduct } from '../src/products.js';
import { calculateOffer } from '../src/compare.js';
import {
  REQUIRED_SPEC_FIELDS,
  specificationProblems,
} from '../src/verification.js';

const factoryProduct = () => {
  const product = {
    id: 'factory-package',
    sku: '123_VNAMZ-456',
    title: 'Unflavored whey isolate 5 lb',
    category: 'whey',
    selectedVariant: [{ text: 'Unflavored' }],
    netMassG: 2268,
    proteinPer100g: 90,
    sugarPer100g: 0,
    fatPer100g: 0,
    saturatedFatPer100g: 0,
    kcalPer100g: 360,
    ingredients: ['whey protein isolate'],
    evidenceIds: ['factory:original'],
    reviewedFields: [...REQUIRED_SPEC_FIELDS],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'factory:original',
      sourceUrl: 'https://manufacturer.example/unflavored-5lb',
    },
  };
  product.claims = REQUIRED_SPEC_FIELDS.map((field) => ({
    field,
    value: product[field],
    source: 'manufacturer',
    evidenceId: 'factory:original',
    requiresReview: false,
  }));
  return product;
};
const label = (product, changes = {}) => ({
  text: 'UNFLAVORED; NET WEIGHT 900 G',
  sku: product.sku,
  selectedOptions: product.selectedVariant,
  evidenceId: 'ocr:matched-package',
  imageSha256: 'a'.repeat(64),
  matchedImageSha256: 'a'.repeat(64),
  selectionConfirmed: true,
  method: 'selected-sku-image-ocr',
  confidence: 0.98,
  ...changes,
});
const observedAt = '2026-10-11T00:00:00.000Z';
const comparison = (product) =>
  calculateOffer(
    product,
    {
      id: 'factory-offer',
      productId: product.id,
      price: 2268000,
      currency: 'VND',
      variantConfirmed: true,
      shipping: 10000,
      observedAt,
    },
    { now: Date.parse(observedAt) }
  );

test('a matched contradictory label quarantines a previously eligible factory denominator without erasing facts', () => {
  const product = factoryProduct();
  const trusted = globalThis.structuredClone(product);
  assert.deepEqual(specificationProblems(product), []);
  assert.equal(comparison(product).eligible, true);
  assert.equal(comparison(product).metrics.costPerGramBeforeDelivery, 1000);

  const result = applySelectedPackageMass(product, label(product));
  assert.equal(result.applied, false);
  assert.equal(result.requiresReview, true);
  assert.equal(result.candidateMassG, 900);
  assert.equal(product.netMassG, 2268);
  assert.equal(product.proteinPer100g, 90);
  assert.deepEqual(
    product.manufacturerVerification,
    trusted.manufacturerVerification
  );
  assert.deepEqual(
    product.claims.slice(0, trusted.claims.length),
    trusted.claims
  );
  assert.deepEqual(product.reviewedFields, trusted.reviewedFields);
  assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  assert.equal(product.specificationsInvalidated, undefined);

  const blocked = comparison(product);
  assert.equal(blocked.eligible, false);
  for (const field of [
    'totalMassG',
    'totalProteinG',
    'costPerGramBeforeDelivery',
    'costPerGramAfterDelivery',
    'costPerProteinGramBeforeDelivery',
    'costPerProteinGramAfterDelivery',
  ]) {
    assert.equal(blocked.metrics[field], null, field);
  }
  assert.ok(
    blocked.problems.some((problem) => /new evidence review/u.test(problem))
  );
  assert.equal(blocked.metrics.unitPrice, 2268000);
  assert.equal(product.claims.at(-1).requiresReview, true);
});

test('original ON 900 g repack source cannot be overwritten by a bound 907 g factory-container OCR label', async () => {
  const html = gunzipSync(
    await readFile(
      new URL(
        './fixtures/selected-package-mass/on-900g.html.gz',
        import.meta.url
      )
    )
  );
  const { document } = parseHTML(html.toString());
  const { product } = parseProduct(
    extractPage({
      document,
      url: 'https://www.lazada.vn/products/pdp-i3265021607.html?skuId=15762183506',
    }),
    { evidenceId: 'original:on-900g' }
  );
  assert.equal(product.netMassG, 900);
  assert.equal(product.massEvidence.selected.metric, true);
  assert.notEqual(product.massEvidence.selected.origin, 'selected-option');
  const result = applySelectedPackageMass(
    product,
    label(product, { text: 'CHOCOLATE; NET WEIGHT 2 LBS (907 G)' })
  );
  assert.equal(result.applied, false);
  assert.equal(result.requiresReview, true);
  assert.equal(product.netMassG, 900);
  assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  assert.equal(product.manufacturerVerification, undefined);
  assert.ok(
    product.claims.some((claim) => claim.field === 'parentPackageMassG')
  );
});

test('declared metric sizes from title, specifications and descriptions require review when OCR disagrees', () => {
  for (const origin of [
    'title',
    'specification',
    'description',
    'selected-option',
  ]) {
    const product = {
      sku: '123_VNAMZ-456',
      title: 'Unflavored whey',
      category: 'whey',
      selectedVariant: [{ text: 'Unflavored' }],
      netMassG: 1000,
      massEvidence: { selected: { origin, metric: true } },
      claims: [],
    };
    assert.equal(
      applySelectedPackageMass(product, label(product)).requiresReview,
      true,
      origin
    );
    assert.equal(product.netMassG, 1000, origin);
    assert.deepEqual(product.pendingSpecificationReview, ['netMassG'], origin);
  }
});

test('contradictory OCR renditions preserve the first metric mass and quarantine the denominator', () => {
  const product = {
    sku: '123_VNAMZ-456',
    title: 'Unflavored whey 2 lb',
    category: 'whey',
    selectedVariant: [{ text: 'Unflavored' }],
    netMassG: 2 * 453.59237,
    claims: [],
  };
  assert.equal(
    applySelectedPackageMass(
      product,
      label(product, { text: 'UNFLAVORED; NET WEIGHT 907 G' })
    ).applied,
    true
  );
  assert.equal(product.netMassG, 907);
  assert.equal(
    applySelectedPackageMass(
      product,
      label(product, { evidenceId: 'ocr:second-rendition' })
    ).requiresReview,
    true
  );
  assert.equal(product.netMassG, 907);
  assert.deepEqual(product.pendingSpecificationReview, ['netMassG']);
  assert.ok(
    product.claims.some((claim) => claim.value === 907 && !claim.requiresReview)
  );
  assert.ok(
    product.claims.some((claim) => claim.value === 900 && claim.requiresReview)
  );
});

test('an explicit exact-package visual review can still correct an unreviewed metric declaration', () => {
  const product = {
    sku: '123_VNAMZ-456',
    title: 'Unflavored whey',
    category: 'whey',
    selectedVariant: [{ text: 'Unflavored' }],
    netMassG: 1000,
    massEvidence: { selected: { origin: 'title', metric: true } },
    claims: [],
  };
  const result = applySelectedPackageMass(
    product,
    label(product, {
      method: 'visual-exact-package',
      reviewedBy: 'fixture-reviewer',
      reason: 'Exact selected package, fixture-only manual mass correction',
    })
  );
  assert.equal(result.applied, true);
  assert.equal(product.netMassG, 900);
  assert.equal(product.pendingSpecificationReview, undefined);
  assert.equal(product.corrections[0].previous, 1000);
  assert.equal(product.manufacturerVerification, undefined);
});
