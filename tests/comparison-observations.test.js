import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers } from '../src/index.js';

const url = 'https://www.lazada.vn/products/pdp-i367656830.html';
const observedAt = '2026-10-10T05:42:15.424Z';
const product = (id, packCount = 1) => ({
  id,
  url,
  title: 'Kem cacao 40g',
  category: 'chocolate-ice-cream',
  netMassG: 40,
  packCount,
  proteinPer100g: 3,
});
const offer = (id, productId, changes = {}) => ({
  id,
  productId,
  url,
  sku: '367656830_VNAMZ-116917756014',
  currency: 'VND',
  price: 39000,
  variantConfirmed: true,
  observedAt,
  ...changes,
});
const options = {
  allowStale: true,
  requireManufacturer: false,
  requireShipping: false,
  sort: 'costPerGramBeforeDelivery',
};

test('private/public alias captures never turn a conflicting five-pack into a cheap unit-cost winner', () => {
  const report = compareOffers(
    [product('public', 5), product('private')],
    [offer('a', 'public'), offer('b', 'private')],
    options
  );
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.duplicateObservations.length, 1);
  assert.deepEqual(report.duplicateObservations[0].offerIds, ['a', 'b']);
  const row = report.comparisons[0];
  assert.equal(row.metrics.totalBeforeDelivery, 39000);
  assert.equal(row.metrics.costPerGramBeforeDelivery, null);
  assert.equal(row.metrics.totalMassG, null);
  assert.match(row.problems.join(';'), /Conflicting package/);
  assert.equal(report.observedPrices.length, 0);
  assert.equal(report.ranked.length, 0);
});

test('newer price and observation defeat old aliases and distinct SKUs remain separate', () => {
  const report = compareOffers(
    [product('old', 5), product('new', 5)],
    [
      offer('old', 'old'),
      offer('new', 'new', {
        price: 41000,
        observedAt: '2026-10-10T07:00:00.000Z',
      }),
      offer('different', 'new', { sku: '367656830_VNAMZ-999' }),
    ],
    options
  );
  assert.equal(report.comparisons.length, 2);
  const row = report.comparisons.find((r) => r.offer.id === 'new');
  assert.equal(row.metrics.costPerGramBeforeDelivery, 205);
  assert.equal(row.offer.price, 41000);
  assert.equal(row.observationConflicts, undefined);
});

test('equal-time contradictory SKU prices are retained for audit and withheld from price ranking', () => {
  const report = compareOffers(
    [product('same', 5)],
    [offer('a', 'same'), offer('b', 'same', { price: 38000 })],
    { ...options, sort: 'totalBeforeDelivery' }
  );
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.observedPrices.length, 0);
  assert.match(report.comparisons[0].problems.join(';'), /Conflicting prices/);
  assert.equal(report.duplicateObservations[0].offerIds.length, 2);
});
