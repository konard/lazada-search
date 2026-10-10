import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { massEvidence, massGrams } from '../src/nutrition.js';
import { applySelectedPackageMass, parseProduct } from '../src/products.js';

const directory = new URL('./fixtures/selected-package-mass/', import.meta.url);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(new URL('sources.json', directory)));

async function originalProduct(id) {
  const source = manifest.sources.find((row) => row.id === id);
  const encoded = await readFile(new URL(source.html, directory));
  const html = gunzipSync(encoded);
  assert.equal(digest(encoded), source.storageSha256);
  assert.equal(digest(html), source.htmlSha256);
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({ document, url: source.url });
  const { product, offer } = parseProduct(snapshot, {
    evidenceId: `original:${source.htmlSha256}`,
  });
  assert.equal(product.sku, source.sku);
  assert.equal(offer.variantConfirmed, true);
  return { source, snapshot, product, offer };
}

async function originalLabel(product, source) {
  const image = await readFile(new URL(source.image, directory));
  assert.equal(digest(image), source.imageSha256);
  return {
    text: source.printedText,
    evidenceId: `original-label:${source.imageSha256}`,
    sku: source.sku,
    selectedOptions: product.selectedVariant,
    imageSha256: digest(image),
    matchedImageSha256: source.imageSha256,
    selectionConfirmed: true,
    method: 'visual-exact-package',
    reviewedBy: 'committed-original-label-review',
    reason: source.sourceReview,
  };
}

test('original ON selected 900 g zip repack overrides 2 lb headline and retains the 10 lb parent claim', async () => {
  const { product, offer, snapshot } = await originalProduct('on-900g');
  assert.ok(
    snapshot.specs.some((text) => /Net Content\s+2 lbs \(900g\)/u.test(text))
  );
  assert.match(snapshot.description, /Túi zip 900gam share từ bịch lớn 10lbs/u);
  assert.equal(product.netMassG, 900);
  assert.equal(offer.price, 1087200);
  assert.ok(
    product.claims.some(
      (claim) =>
        claim.field === 'netMassG' &&
        claim.value === 2 * 453.59237 &&
        claim.supersededForSellingMass
    )
  );
  assert.ok(
    product.claims.some(
      (claim) =>
        claim.field === 'parentPackageMassG' && claim.value === 10 * 453.59237
    )
  );
  const chosen = product.claims.find(
    (claim) => claim.field === 'netMassG' && !claim.requiresReview
  );
  assert.equal(chosen.value, 900);
  assert.match(chosen.excerpt, /900g/u);
  assert.equal(product.manufacturerVerification, undefined);
});

test('original ProSupps exact Chocolate Ice Cream label supplies printed 907 g without assigning nutrition', async () => {
  const { product, source } = await originalProduct('prosupps-907g');
  const oldClaims = globalThis.structuredClone(product.claims);
  const oldProtein = product.proteinPer100g;
  const label = await originalLabel(product, source);
  assert.equal(applySelectedPackageMass(product, label).applied, true);
  assert.equal(product.netMassG, 907);
  assert.ok(
    oldClaims.every((claim) =>
      product.claims.some(
        (current) => JSON.stringify(current) === JSON.stringify(claim)
      )
    )
  );
  assert.equal(product.proteinPer100g, oldProtein);
  assert.equal(product.manufacturerVerification, undefined);
  assert.equal(product.massEvidence.selected.imageSha256, source.imageSha256);
});

test('original Levels selected Vanilla bag uses printed 2.56 kg without multiplying 80 servings', async () => {
  const { product, source, offer } = await originalProduct('levels-2560g');
  assert.equal(product.netMassG, undefined);
  assert.ok(
    product.selectedVariant.some((option) => /80 lần dùng/u.test(option.text))
  );
  const label = await originalLabel(product, source);
  assert.equal(applySelectedPackageMass(product, label).massG, 2560);
  assert.equal(product.netMassG, 2560);
  assert.equal(offer.available, false);
  assert.equal(product.manufacturerVerification, undefined);
});

test('gallery text cannot become the selected package through a sibling SKU, digest or flavour mismatch', async () => {
  const { product, source } = await originalProduct('prosupps-907g');
  const label = await originalLabel(product, source);
  for (const changed of [
    { sku: '1553990700_VNAMZ-OTHER' },
    { matchedImageSha256: '0'.repeat(64) },
    { selectedOptions: ['Vanilla'] },
    { text: 'VANILLA; NET WEIGHT 2 LBS (907 G)' },
    { selectionConfirmed: false },
    { method: 'unmatched-gallery-ocr', reviewedBy: undefined },
    { method: 'selected-sku-image-ocr', confidence: 0.5 },
    { text: '28 servings; serving size 32 g; Protein 25 g' },
  ]) {
    const copy = globalThis.structuredClone(product);
    assert.equal(
      applySelectedPackageMass(copy, { ...label, ...changed }).applied,
      false
    );
    assert.deepEqual(copy, product);
  }
});

test('a high-confidence selected-image OCR declaration retains its image/SKU basis, and never takes a parent weight', () => {
  const product = {
    sku: 'fixture_VNAMZ-1',
    title: 'Whey Chocolate',
    category: 'whey',
    selectedVariant: [{ text: 'Chocolate' }],
    claims: [],
  };
  const evidence = {
    text: 'Chocolate; NET WEIGHT 2 LBS (907 G)',
    sku: product.sku,
    selectedOptions: ['Chocolate'],
    imageSha256: 'a'.repeat(64),
    matchedImageSha256: 'a'.repeat(64),
    selectionConfirmed: true,
    method: 'selected-sku-image-ocr',
    confidence: 0.98,
    evidenceId: 'ocr:fixture',
  };
  assert.equal(applySelectedPackageMass(product, evidence).massG, 907);
  assert.equal(product.claims.at(-1).imageSha256, evidence.imageSha256);
  assert.equal(
    applySelectedPackageMass(product, {
      ...evidence,
      text: 'Repacked from a parent bag 2 kg',
    }).applied,
    false
  );
});

test('reviewed factory corrections survive conflicting labels; a genuine changed package requires selective re-review', () => {
  const product = {
    sku: 'fixture_VNAMZ-1',
    title: 'Whey Unflavored',
    category: 'whey',
    selectedVariant: [{ text: 'Unflavored' }],
    netMassG: 2268,
    proteinPer100g: 90,
    reviewedFields: ['netMassG', 'proteinPer100g'],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'factory:original',
    },
    claims: [
      {
        field: 'netMassG',
        value: 2268,
        source: 'manufacturer',
        evidenceId: 'factory:original',
      },
    ],
  };
  const evidence = {
    text: 'Unflavored; NET WEIGHT 2300 G',
    sku: product.sku,
    selectedOptions: ['Unflavored'],
    imageSha256: 'b'.repeat(64),
    matchedImageSha256: 'b'.repeat(64),
    selectionConfirmed: true,
    method: 'visual-exact-package',
    reviewedBy: 'fixture-reviewer',
    reason: 'Exact selected bag label; test-only changed package',
    evidenceId: 'label:new',
  };
  assert.equal(
    applySelectedPackageMass(product, evidence).requiresReview,
    true
  );
  assert.equal(product.netMassG, 2268);
  assert.equal(product.proteinPer100g, 90);
  assert.equal(product.manufacturerVerification.identityMatched, true);
  assert.equal(product.claims.at(-1).requiresReview, true);
  applySelectedPackageMass(product, {
    ...evidence,
    packageIdentityChanged: true,
  });
  assert.equal(product.netMassG, 2268);
  assert.equal(product.manufacturerVerification.identityMatched, false);
  assert.deepEqual(product.invalidatedSpecificationFields, ['netMassG']);
  assert.ok(
    product.claims.some(
      (claim) => claim.source === 'manufacturer' && claim.value === 2268
    )
  );
});

test('metric declarations win paired units while serving, nutrition, gross and parent weights stay separate', () => {
  assert.equal(massGrams('NET WT.5.64LB(90OZ)(2.56KG)'), 2560);
  assert.equal(massGrams('2lbs (Gói 900gam)'), 900);
  assert.equal(massGrams('Net weight: 2 lb (907 g)'), 907);
  assert.equal(massGrams('Net weight: 1,816 g'), 1816);
  assert.equal(
    massGrams(
      'Serving size 32g; Protein 25g; Gross weight 3kg; Net weight 2kg'
    ),
    2000
  );
  assert.equal(massGrams('Túi zip 900gam share từ bịch lớn 10lbs'), 900);
  assert.equal(massEvidence('Parent bag weight 10lb').selected, undefined);
  assert.equal(massGrams('80 servings, 32g per serving'), undefined);
});

test('explicit selected food size wins family metadata, and conflicting selected metric declarations need review', () => {
  const snapshot = {
    url: 'https://www.lazada.vn/products/fixture-i1.html',
    title: 'Whey 2lb',
    selectedVariant: [{ text: '500g Chocolate' }],
    specs: ['Net Content\n2 lbs (907g)'],
  };
  assert.equal(parseProduct(snapshot).product.netMassG, 500);
  const selectedImperial = parseProduct({
    ...snapshot,
    selectedVariant: [{ text: '2lb Chocolate' }],
    specs: ['Net weight 2kg'],
  }).product;
  assert.equal(selectedImperial.netMassG, 2 * 453.59237);
  const ambiguous = parseProduct({
    ...snapshot,
    selectedVariant: [{ text: '500g / 1kg Chocolate' }],
  }).product;
  assert.equal(ambiguous.massEvidence.conflicting, true);
  assert.ok(
    ambiguous.claims
      .filter(
        (claim) =>
          claim.field === 'netMassG' && claim.value === ambiguous.netMassG
      )
      .every((claim) => claim.requiresReview)
  );
});
