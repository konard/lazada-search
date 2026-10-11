import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichIceRow, rankIceRows } from '../scripts/ice-unit-rankings.mjs';

const reviews = JSON.parse(
  await readFile(
    new URL(
      '../docs/acceptance/ice-dual-units/gelato-thai-expanded-review.json',
      import.meta.url
    )
  )
).reviews;
const sku = '1561216831_VNAMZ-6599331044';
const sellerRow = {
  sku,
  massG: 3000,
  volumeMl: 6000,
  totalBeforeDelivery: 539000,
  packagesPerSellingUnit: 1,
  quantity: 1,
  available: true,
};

test('committed iBerri review withholding 3kg prevents a fallback gram-price winner', () => {
  const row = enrichIceRow(sellerRow, reviews);
  assert.equal(row.massG, null);
  assert.equal(row.beforePerFoodGram, null);
  assert.equal(row.volumeMl, 6000);
  assert.equal(row.beforePerMl, 539000 / 6000);
  assert.deepEqual(rankIceRows([row], 'beforePerFoodGram'), []);
  assert.ok(row.invalidatedSpecificationFields.includes('netMassG'));
  assert.equal(
    row.research.find((entry) => entry.withheldSellerClaims.netMassG)
      .withheldSellerClaims.netMassG,
    3000
  );
});

test('unapplied manufacturer matrices do not turn generic family weights into exact package facts', () => {
  const review = reviews.find((entry) =>
    entry.skus.includes('3047760589_VNAMZ-14661082727')
  );
  const row = enrichIceRow({ ...sellerRow, sku: review.skus[0] }, [review]);
  assert.equal(row.massG, null);
  assert.equal(row.beforePerFoodGram, null);
});

test('a later exact manufacturer package fact can resolve a withheld seller weight', () => {
  const row = enrichIceRow(sellerRow, [
    ...reviews,
    {
      id: 'new-exact-label-fixture',
      skus: [sku],
      facts: {
        netMassG: {
          value: 3200,
          identityMatched: true,
          sourceAuthority: 'manufacturer',
          sourceUrl: 'https://manufacturer.example/exact-chocolate-tub',
          sourceSha256: 'a'.repeat(64),
          excerpt: 'Exact current package net mass 3200 g',
        },
      },
    },
  ]);
  assert.equal(row.massG, 3200);
  assert.equal(row.beforePerFoodGram, 539000 / 3200);
});
