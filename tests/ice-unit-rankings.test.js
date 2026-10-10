import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichIceRow, rankIceRows } from '../scripts/ice-unit-rankings.mjs';

const base = {
  sku: 'example-chocolate',
  packagesPerSellingUnit: 5,
  quantity: 1,
  massG: 200,
  volumeMl: null,
  totalBeforeDelivery: 39000,
  totalAfterDelivery: null,
  available: true,
};
const fact = (value) => ({
  value,
  identityMatched: true,
  sourceUrl: 'https://manufacturer.example/chocolate',
  sourceSha256: 'a'.repeat(64),
  excerpt: 'Exact selected package label',
});
const review = (facts, extra = {}) => ({
  id: 'exact-label',
  skus: [base.sku],
  facts,
  ...extra,
});

test('volume-based protein does not require a guessed mass or density', () => {
  const row = enrichIceRow(
    { ...base, massG: null, packagesPerSellingUnit: 1, volumeMl: 130 },
    [review({ proteinPer100ml: fact(2) })]
  );
  assert.equal(row.massG, null);
  assert.equal(row.proteinG, 2.6);
  assert.equal(row.beforePerProteinGram, 39000 / 2.6);
  assert.equal(row.beforePerFoodGram, null);
});

test('empty manufacturer API defaults cannot establish zero-protein nutrition', () => {
  const row = enrichIceRow(base, [
    review({
      proteinPerPackageG: {
        ...fact(0),
        placeholder: true,
        hasDeclaredBasis: false,
      },
    }),
  ]);
  assert.equal(row.proteinG, null);
  assert.equal(row.beforePerProteinGram, null);
});

test('each denominator includes all five food packages once', () => {
  const row = enrichIceRow(base, [
    review({ netVolumeMl: fact(60), proteinPerPackageG: fact(1.2) }),
  ]);
  assert.equal(row.massG, 200);
  assert.equal(row.volumeMl, 300);
  assert.equal(row.proteinG, 6);
  assert.equal(row.beforePerFoodGram, 195);
  assert.equal(row.beforePerMl, 130);
  assert.equal(row.beforePerProteinGram, 6500);
  assert.equal(row.afterPerProteinGram, null);
});

test('historical sample and wrong variant facts never fill current quantities', () => {
  const row = enrichIceRow(base, [
    review({
      netVolumeMl: { ...fact(60), identityMatched: false },
      proteinPer100g: { ...fact(4.6), identityMatched: false },
    }),
    { skus: ['different-flavour'], facts: { netVolumeMl: fact(99) } },
  ]);
  assert.equal(row.volumeMl, null);
  assert.equal(row.proteinG, null);
});

test('missing, sold-out and rejected flavours stay outside independent rankings', () => {
  const rows = [
    { sku: 'mass-only', beforePerFoodGram: 195, beforePerMl: null },
    { sku: 'volume-only', beforePerFoodGram: null, beforePerMl: 90 },
    { sku: 'sold-out', beforePerFoodGram: 1, available: false },
    {
      sku: 'vanilla-core',
      beforePerFoodGram: 2,
      strictChocolateEligible: false,
    },
  ];
  assert.deepEqual(
    rankIceRows(rows, 'beforePerFoodGram').map((r) => r.sku),
    ['mass-only']
  );
  assert.deepEqual(
    rankIceRows(rows, 'beforePerMl').map((r) => r.sku),
    ['volume-only']
  );
});

test('conflicting package and nutrition evidence is retained for review', () => {
  const row = enrichIceRow(base, [
    review({ netVolumeMl: fact(60), proteinPer100g: fact(3) }),
    review({ netVolumeMl: fact(80), proteinPerPackageG: fact(2) }),
  ]);
  assert.equal(row.volumeMl, null);
  assert.equal(row.proteinG, null);
  assert.deepEqual(row.specificationConflicts, ['netVolumeMl', 'proteinG']);
});

test('exact manufacturer correction takes priority and preserves seller claim', () => {
  const row = enrichIceRow(base, [
    review({ netVolumeMl: { ...fact(60), sourceAuthority: 'manufacturer' } }),
    review({
      netVolumeMl: { ...fact(80), sourceAuthority: 'seller-promotional-panel' },
    }),
  ]);
  assert.equal(row.volumeMl, 300);
  assert.equal(row.supersededSpecificationFacts[0].fact.value, 80);
  assert.deepEqual(row.specificationConflicts, []);
});
