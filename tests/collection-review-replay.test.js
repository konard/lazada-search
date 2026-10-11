import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { preserveReviewedPaidMass } from '../src/collection-review-replay.js';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { calculateOffer } from '../src/compare.js';
import { sha256 } from '../src/util.js';

const observedAt = '2026-10-11T08:28:08.371Z';
const proof = {
  evidenceId: 'seller-original',
  previousHtmlSha256: 'a'.repeat(64),
  originalHtmlSha256: 'a'.repeat(64),
};

function reviewedProduct(source = 'manual-review') {
  const product = {
    id: 'product:exact',
    sku: '123_VNAMZ-456',
    url: 'https://www.lazada.vn/products/pdp-i123.html',
    observedAt,
    netMassG: 1000,
    packCount: 2,
    evidenceIds: [proof.evidenceId],
    reviewedFields: ['netMassG'],
    claims: [
      {
        field: 'netMassG',
        value: 1000,
        source,
        evidenceId: proof.evidenceId,
        reviewedAt: observedAt,
        requiresReview: false,
      },
    ],
  };
  if (source === 'manufacturer') {
    product.manufacturerVerification = {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: proof.evidenceId,
    };
  }
  return product;
}

function automaticReplay(previous, fields = ['netMassG']) {
  return {
    ...previous,
    pendingSpecificationReview: ['ingredients', ...fields],
    paidMassBasis: {
      basis: 'ambiguous',
      selectedMassG: 2000,
      packCount: 2,
      requiresReview: true,
      safeToMultiplyByPackCount: false,
      factualApprovalGranted: false,
      holdFields: fields,
      sourceStatements: [{ massG: 2000, basis: 'total-selling-unit' }],
    },
    claims: [
      ...previous.claims,
      {
        field: 'netMassG',
        value: 2000,
        source: 'seller',
        requiresReview: true,
        evidenceId: proof.evidenceId,
      },
    ],
    foodComponents: [{ id: 'gift', kind: 'bonus-food', status: 'potential' }],
  };
}

test('same-original manual and factory paid-mass reviews survive automatic replay without changing raw claims or gifts', () => {
  for (const source of ['manual-review', 'manufacturer']) {
    const previous = reviewedProduct(source);
    previous.pendingSpecificationReview = ['netVolumeMl'];
    const current = automaticReplay(previous);
    const before = globalThis.structuredClone({ previous, current });
    const result = preserveReviewedPaidMass(previous, current, proof);
    assert.deepEqual(result.pendingSpecificationReview, [
      'netVolumeMl',
      'ingredients',
    ]);
    assert.equal(result.netMassG, 1000);
    assert.equal(result.packCount, 2);
    assert.deepEqual(result.paidMassBasis.holdFields, []);
    assert.equal(result.paidMassBasis.requiresReview, false);
    assert.equal(result.paidMassBasis.factualApprovalGranted, false);
    assert.equal(result.paidMassBasis.sourceStatements[0].massG, 2000);
    assert.equal(
      result.paidMassBasis.resolution.sourceSha256,
      proof.originalHtmlSha256
    );
    assert.strictEqual(result.claims, current.claims);
    assert.strictEqual(result.foodComponents, current.foodComponents);
    assert.deepEqual({ previous, current }, before);
    assert.strictEqual(
      preserveReviewedPaidMass(previous, result, proof),
      result
    );
  }
});

test('new observations, different exact identities, missing originals and unsuitable review metadata retain automatic holds', () => {
  const previous = reviewedProduct();
  const current = automaticReplay(previous);
  for (const changed of [
    { current: { ...current, observedAt: '2026-10-11T09:00:00Z' } },
    { current: { ...current, sku: '123_VNAMZ-457' } },
    { current: { ...current, id: 'another-product' } },
    { current: { ...current, url: `${current.url}?skuId=457` } },
    { current: { ...current, netMassG: 2000 } },
    { current: { ...current, evidenceIds: [] } },
    { current: { ...current, specificationsInvalidated: true } },
    { previous: { ...previous, evidenceIds: [] } },
    { previous: { ...previous, specificationsInvalidated: true } },
    { previous: { ...previous, pendingSpecificationReview: ['netMassG'] } },
    { previous: { ...previous, reviewedFields: [] } },
    { previous: { ...previous, claims: [] } },
    {
      previous: {
        ...previous,
        claims: [{ ...previous.claims[0], invalidatedAt: observedAt }],
      },
    },
    {
      previous: {
        ...previous,
        claims: [{ ...previous.claims[0], requiresReview: true }],
      },
    },
    { proof: { ...proof, originalHtmlSha256: 'b'.repeat(64) } },
    {
      proof: {
        ...proof,
        previousHtmlSha256: 'not-a-digest',
        originalHtmlSha256: 'not-a-digest',
      },
    },
    { proof: { ...proof, evidenceId: 'unattached-original' } },
    { proof: {} },
  ]) {
    const input = changed.current || current;
    assert.strictEqual(
      preserveReviewedPaidMass(
        changed.previous || previous,
        input,
        changed.proof || proof
      ),
      input
    );
  }
  assert.strictEqual(
    preserveReviewedPaidMass(previous, current, null),
    current
  );
  assert.strictEqual(
    preserveReviewedPaidMass(undefined, current, proof),
    current
  );
});

test('arbitrary pending fields and explicit active store holds never become automatic exemptions', () => {
  const previous = reviewedProduct();
  const current = automaticReplay(previous);
  for (const input of [
    { ...current, paidMassBasis: undefined },
    {
      ...current,
      paidMassBasis: { ...current.paidMassBasis, requiresReview: false },
    },
    {
      ...current,
      specificationHolds: [
        { field: 'netMassG', active: true, evidenceId: proof.evidenceId },
      ],
    },
    { ...current, pendingSpecificationReview: ['netMassG', 'packCount'] },
    { ...current, packCount: 3 },
  ]) {
    assert.strictEqual(preserveReviewedPaidMass(previous, input, proof), input);
  }
  const heldPrevious = {
    ...previous,
    specificationHolds: [
      { field: 'netMassG', active: true, evidenceId: proof.evidenceId },
    ],
  };
  assert.strictEqual(
    preserveReviewedPaidMass(heldPrevious, current, proof),
    current
  );
});

test('a fresh advertised count contradiction requires an exact-original count review even when the previous count is unchanged', () => {
  for (const source of ['manual-review', 'manufacturer']) {
    const previous = reviewedProduct(source);
    const current = automaticReplay(previous, ['netMassG', 'packCount']);
    assert.strictEqual(
      preserveReviewedPaidMass(previous, current, proof),
      current
    );
    previous.reviewedFields.push('packCount');
    const claim = { ...previous.claims[0], field: 'packCount', value: 2 };
    previous.claims.push(claim);
    const reviewed = automaticReplay(previous, ['netMassG', 'packCount']);
    const result = preserveReviewedPaidMass(previous, reviewed, proof);
    assert.deepEqual(result.pendingSpecificationReview, ['ingredients']);
    assert.equal(result.packCount, 2);
    for (const invalid of [
      { value: 3 },
      { evidenceId: 'other-original' },
      { invalidated: true },
      { invalidatedAt: observedAt },
      { requiresReview: true },
    ]) {
      const invalidPrevious = {
        ...previous,
        claims: [previous.claims[0], { ...claim, ...invalid }],
      };
      assert.strictEqual(
        preserveReviewedPaidMass(invalidPrevious, reviewed, proof),
        reviewed
      );
    }
    const pendingPrevious = {
      ...previous,
      pendingSpecificationReview: ['packCount'],
    };
    assert.strictEqual(
      preserveReviewedPaidMass(pendingPrevious, reviewed, proof),
      reviewed
    );
  }
});

test('automatic headline consistency receipt must be bound to the replayed evidence before it can be resolved', () => {
  const previous = reviewedProduct();
  const current = {
    ...previous,
    pendingSpecificationReview: ['netMassG'],
    packageMassConsistency: {
      field: 'netMassG',
      requiresReview: true,
      evidenceIds: [proof.evidenceId],
      replacementMassG: null,
    },
  };
  const result = preserveReviewedPaidMass(previous, current, proof);
  assert.deepEqual(result.pendingSpecificationReview, []);
  assert.equal(result.packageMassConsistency.requiresReview, false);
  assert.equal(result.packageMassConsistency.replacementMassG, null);
  const unbound = {
    ...current,
    packageMassConsistency: {
      ...current.packageMassConsistency,
      evidenceIds: ['other-original'],
    },
  };
  assert.strictEqual(
    preserveReviewedPaidMass(previous, unbound, proof),
    unbound
  );
  const mixed = {
    ...automaticReplay(previous),
    packageMassConsistency: unbound.packageMassConsistency,
  };
  assert.strictEqual(preserveReviewedPaidMass(previous, mixed, proof), mixed);
});

test('separate official count evidence resolves a hold only through its exact current visual review and listing original', () => {
  const previous = reviewedProduct('manufacturer');
  const officialId = 'official-package-original';
  const reviewId = 'manufacturer-review:exact-current';
  previous.evidenceIds.push(officialId);
  previous.manufacturerVerification = {
    ...previous.manufacturerVerification,
    evidenceId: officialId,
    identityMethod: 'visual-exact-variant',
    reviewId,
  };
  previous.claims[0] = {
    ...previous.claims[0],
    evidenceId: officialId,
    reviewId,
  };
  previous.claims.push({
    ...previous.claims[0],
    field: 'packCount',
    value: 2,
  });
  const check = {
    id: reviewId,
    evidenceId: officialId,
    listingEvidenceId: proof.evidenceId,
    identityMatched: true,
    identityMethod: 'visual-exact-variant',
    sourceAuthority: 'manufacturer',
    identity: {
      listing: { packCount: 2 },
      manufacturer: { packCount: 2 },
    },
  };
  previous.crossChecks = [check];
  const current = automaticReplay(previous, ['netMassG', 'packCount']);
  const result = preserveReviewedPaidMass(previous, current, proof);
  assert.deepEqual(result.pendingSpecificationReview, ['ingredients']);
  assert.equal(result.packCount, 2);
  assert.strictEqual(result.claims, current.claims);
  for (const invalid of [
    { id: 'older-review' },
    { evidenceId: 'other-factory-original' },
    { listingEvidenceId: 'other-listing-original' },
    { identityMatched: false },
    { identityMethod: 'unmatched' },
    { sourceAuthority: 'seller' },
    { requiresReview: true },
    { invalidated: true },
    { invalidatedAt: observedAt },
    { identity: { listing: { packCount: 3 }, manufacturer: { packCount: 2 } } },
    { identity: { listing: { packCount: 2 }, manufacturer: { packCount: 3 } } },
  ]) {
    const invalidPrevious = {
      ...previous,
      crossChecks: [{ ...check, ...invalid }],
    };
    assert.strictEqual(
      preserveReviewedPaidMass(invalidPrevious, current, proof),
      current
    );
  }
  assert.strictEqual(
    preserveReviewedPaidMass({ ...previous, crossChecks: [] }, current, proof),
    current
  );
  assert.strictEqual(
    preserveReviewedPaidMass(
      { ...previous, evidenceIds: [proof.evidenceId] },
      current,
      proof
    ),
    current
  );
});

test('fixed original seller25g source replays an existing package review with unchanged source price and denominator', async () => {
  const directory = new URL(
    './fixtures/package-mass-consistency/',
    import.meta.url
  );
  const source = JSON.parse(await readFile(new URL('source.json', directory)));
  const compressed = await readFile(new URL(source.html, directory));
  const html = gunzipSync(compressed);
  assert.equal(sha256(compressed), source.compressedSha256);
  assert.equal(sha256(html), source.htmlSha256);
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({ document, url: source.url });
  const exactProof = {
    evidenceId: `original:${source.htmlSha256}`,
    previousHtmlSha256: source.htmlSha256,
    originalHtmlSha256: source.htmlSha256,
  };
  const parsed = parseProduct(snapshot, {
    evidenceId: exactProof.evidenceId,
    observedAt: source.observedAt,
  });
  assert.equal(parsed.product.sku, source.sku);
  assert.ok(parsed.product.pendingSpecificationReview.includes('netMassG'));
  const previous = {
    ...parsed.product,
    netMassG: 2000,
    pendingSpecificationReview: [],
    reviewedFields: ['netMassG'],
    claims: [
      ...parsed.product.claims,
      {
        field: 'netMassG',
        value: 2000,
        source: 'manual-review',
        evidenceId: exactProof.evidenceId,
        reviewedAt: source.observedAt,
        requiresReview: false,
      },
    ],
  };
  // Simulate the collection layer restoring a review that was already accepted;
  // the replay helper itself has no authority to approve the synthetic amount.
  const current = {
    ...parsed.product,
    netMassG: previous.netMassG,
    claims: previous.claims,
    reviewedFields: previous.reviewedFields,
  };
  const before = calculateOffer(current, parsed.offer);
  assert.equal(before.metrics.totalMassG, null);
  const result = preserveReviewedPaidMass(previous, current, exactProof);
  const row = calculateOffer(result, parsed.offer);
  assert.equal(row.metrics.totalMassG, 2000);
  assert.equal(row.metrics.costPerGramBeforeDelivery, 1375);
  assert.equal(parsed.offer.price, 2750000);
  assert.equal(
    result.claims.find(
      (claim) => claim.field === 'netMassG' && claim.value === 25
    ).value,
    25
  );
});
