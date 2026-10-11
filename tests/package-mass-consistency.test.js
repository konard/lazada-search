import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { calculateOffer } from '../src/compare.js';
import { sha256 } from '../src/util.js';
import {
  packageMassConsistency,
  applyPackageMassConsistency,
} from '../src/package-mass-consistency.js';

const base = () => ({
  category: 'whey',
  title: 'Chocolate whey,25g protein per serving,62 servings',
  netMassG: 25,
  selectedVariant: [],
  evidenceIds: ['seller-original'],
  claims: [{ field: 'netMassG', value: 25, requiresReview: false }],
});

test('original seller25g net-content conflict is held without inventing package weight or changing price', async () => {
  const directory = new URL(
    './fixtures/package-mass-consistency/',
    import.meta.url
  );
  const source = JSON.parse(await readFile(new URL('source.json', directory)));
  const encoded = await readFile(new URL(source.html, directory));
  const html = gunzipSync(encoded);
  assert.equal(sha256(encoded), source.compressedSha256);
  assert.equal(sha256(html), source.htmlSha256);
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({ document, url: source.url });
  assert.ok(snapshot.specs.some((text) => /Net Content\s+25g/u.test(text)));
  const { product, offer } = parseProduct(snapshot, {
    evidenceId: `original:${source.htmlSha256}`,
    observedAt: source.observedAt,
  });
  assert.equal(product.sku, source.sku);
  assert.equal(product.netMassG, 25);
  assert.equal(offer.price, 2750000);
  assert.equal(product.packageMassConsistency.advertisedServings, 62);
  assert.equal(product.packageMassConsistency.replacementMassG, null);
  assert.ok(product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(calculateOffer(product, offer).metrics.totalMassG, null);
  assert.equal(
    calculateOffer(product, offer).metrics.costPerGramBeforeDelivery,
    null
  );
});

test('same-source English and Vietnamese protein/serving claims hold inconsistent legacy records read-only', () => {
  for (const title of [
    'Chocolate whey,25g protein per serving,62 servings',
    'Whey sôcôla,25g protein mỗi khẩu phần,62 khẩu phần',
  ]) {
    const input = { ...base(), title };
    const saved = globalThis.structuredClone(input);
    const result = applyPackageMassConsistency(input);
    assert.equal(result.packageMassConsistency.perServingProteinG, 25);
    assert.equal(result.netMassG, 25);
    assert.equal(result.claims[0].requiresReview, true);
    assert.deepEqual(input, saved);
    assert.deepEqual(applyPackageMassConsistency(result), result);
  }
});

test('explicit sample/repack selections and exact reviewed facts retain their source-bound mass', () => {
  for (const changed of [
    { selectedVariant: [{ text: 'Gói dùng thử25g' }] },
    { title: 'Trial25g chocolate whey,25g protein per serving,62 servings' },
    { packCount: 62 },
    { netMassG: 2000 },
  ]) {
    const input = { ...base(), ...changed };
    assert.equal(packageMassConsistency(input), null);
    assert.equal(applyPackageMassConsistency(input), input);
  }
});

test('bare review flags and multipack metadata cannot bypass a contradictory denominator', () => {
  for (const changed of [
    { reviewedFields: ['netMassG'] },
    {
      manufacturerVerification: {
        identityMatched: true,
        sourceAuthority: 'seller',
      },
    },
    { packCount: 2 },
    { selectedVariant: [{ text: 'Chocolate2kg' }] },
  ]) {
    assert.ok(packageMassConsistency({ ...base(), ...changed }));
  }
});

test('an exact sourced factory or manual package review takes priority over a conflicting seller headline', () => {
  const claim = {
    field: 'netMassG',
    value: 25,
    requiresReview: false,
    evidenceId: 'review-original',
    reviewedAt: '2026-10-11T08:28:08.371Z',
  };
  for (const changed of [
    {
      reviewedFields: ['netMassG'],
      claims: [{ ...claim, source: 'manual-review' }],
    },
    {
      manufacturerVerification: {
        identityMatched: true,
        sourceAuthority: 'manufacturer',
        evidenceId: claim.evidenceId,
      },
      claims: [{ ...claim, source: 'manufacturer' }],
    },
  ]) {
    const product = { ...base(), ...changed, evidenceIds: [claim.evidenceId] };
    assert.equal(packageMassConsistency(product), null);
    for (const invalid of [
      { evidenceIds: [] },
      { claims: [{ ...product.claims[0], value: 26 }] },
      { claims: [{ ...product.claims[0], invalidated: true }] },
      { claims: [{ ...product.claims[0], invalidatedAt: claim.reviewedAt }] },
      { claims: [{ ...product.claims[0], requiresReview: true }] },
    ]) {
      assert.ok(packageMassConsistency({ ...product, ...invalid }));
    }
  }
});

test('a manufacturer visual claim must belong to the same exact variant review', () => {
  const product = {
    ...base(),
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'seller-original',
      identityMethod: 'visual-exact-variant',
      reviewId: 'current-variant-review',
    },
    claims: [
      {
        ...base().claims[0],
        source: 'manufacturer',
        evidenceId: 'seller-original',
        reviewId: 'different-variant-review',
      },
    ],
  };
  assert.ok(packageMassConsistency(product));
  product.claims[0].reviewId = product.manufacturerVerification.reviewId;
  assert.equal(packageMassConsistency(product), null);
});

test('bonus/negated sample language and a trial of another size cannot exempt the paid denominator', () => {
  for (const changed of [
    {
      title:
        'Chocolate whey with free sample,25g protein per serving,62 servings',
    },
    {
      title: 'No sample25g chocolate whey,25g protein per serving,62 servings',
    },
    { selectedVariant: [{ text: 'Gói dùng thử50g' }] },
  ]) {
    assert.ok(packageMassConsistency({ ...base(), ...changed }));
  }
});

test('per100g nutrients, unsupported bases and ice cream cannot generate this hold', () => {
  for (const changed of [
    { title: 'Whey,25g protein per100g,62 servings' },
    { title: 'Whey,25g protein per serving' },
    { title: 'Whey,25g protein per serving,1 serving' },
    { title: 'Whey,0g protein per serving,62 servings' },
    { title: 'Whey,25g protein per serving,62 servings;30 servings' },
    { category: 'chocolate-ice-cream' },
  ]) {
    assert.equal(packageMassConsistency({ ...base(), ...changed }), null);
  }
});

test('a held paid-package count blocks all food and protein denominators while retaining prices', () => {
  const product = {
    ...base(),
    netMassG: 1000,
    netVolumeMl: 2000,
    packCount: 2,
    proteinPerPackageG: 800,
    pendingSpecificationReview: ['packCount'],
  };
  const offer = { price: 100000, observedAt: '2026-10-11T08:00:00Z' };
  const row = calculateOffer(product, offer, { allowStale: true });
  for (const field of [
    'totalMassG',
    'totalVolumeMl',
    'totalProteinG',
    'costPerGramBeforeDelivery',
    'costPerMlBeforeDelivery',
    'costPerProteinGramBeforeDelivery',
  ]) {
    assert.equal(row.metrics[field], null, field);
  }
  assert.equal(row.offer.price, 100000);
});
