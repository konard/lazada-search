import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpecificationHolds } from '../src/specification-holds.js';
import { calculateOffer } from '../src/compare.js';

const product = {
  id: 'ice',
  sku: 'ice-1',
  category: 'chocolate-ice-cream',
  netMassG: 3000,
  netVolumeMl: 6000,
  packCount: 1,
  ingredients: [],
  warnings: [],
  claims: [],
};
const hold = {
  id: 'ice-1:netMassG',
  active: true,
  evidenceId: 'negative-source',
  reviewedAt: '2026-10-11T00:00:00Z',
};
const store = { get: async (_kind, id) => (id === hold.id ? hold : undefined) };

test('shared catalog hold suppresses disputed grams and derived protein but retains supported volume and raw claims', async () => {
  const resolved = await applySpecificationHolds(store, product);
  const offer = {
    id: 'offer',
    price: 539000,
    currency: 'VND',
    observedAt: '2026-10-11T00:00:00Z',
    variantConfirmed: true,
  };
  const { metrics } = calculateOffer(resolved, offer, {
    allowStale: true,
    requireManufacturer: false,
  });
  assert.equal(metrics.totalMassG, null);
  assert.equal(metrics.costPerGramBeforeDelivery, null);
  assert.equal(metrics.costPerMlBeforeDelivery, 539000 / 6000);
  assert.equal(product.netMassG, 3000);
  assert.equal(product.pendingSpecificationReview, undefined);
});

test('only a later exact manufacturer field claim resolves a specification hold', async () => {
  const checkedAt = '2026-10-12T00:00:00Z';
  const manufacturerVerification = {
    identityMatched: true,
    sourceAuthority: 'manufacturer',
    evidenceId: 'factory-label',
    checkedAt,
  };
  const corrected = {
    ...product,
    netMassG: 3200,
    manufacturerVerification,
    claims: [
      {
        field: 'netMassG',
        value: 3200,
        source: 'manufacturer',
        evidenceId: 'factory-label',
      },
    ],
  };
  assert.equal(
    (await applySpecificationHolds(store, corrected))
      .pendingSpecificationReview,
    undefined
  );
  for (const partial of [
    { ...corrected, claims: [] },
    {
      ...corrected,
      manufacturerVerification: {
        ...manufacturerVerification,
        identityMatched: false,
      },
    },
    {
      ...corrected,
      manufacturerVerification: {
        ...manufacturerVerification,
        checkedAt: '2026-10-10T00:00:00Z',
      },
    },
  ]) {
    assert.deepEqual(
      (await applySpecificationHolds(store, partial))
        .pendingSpecificationReview,
      ['netMassG']
    );
  }
});
