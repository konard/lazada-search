import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = JSON.parse(
  await readFile(
    new URL('../docs/tables/handpicked.json', import.meta.url),
    'utf8'
  )
);
const bySku = (sku) => report.rows.find((row) => row.exactSku === sku);

test('all six handpicked selections have prices and explicit gram denominators', () => {
  assert.equal(report.rows.length, 6);
  assert.equal(report.counts.capturedExactSkuRows, 6);
  assert.equal(report.counts.duplicateResolvedListingRows, 1);
  assert.equal(report.counts.duplicateResolvedExactSkuRows, 0);
  for (const row of report.rows) {
    assert.ok(row.priceVnd > 0);
    assert.ok(row.costs.massG > 0, row.exactSku);
    assert.ok(row.costs.beforePerFoodGram > 0, row.exactSku);
  }
});

test('seller repacks use exact selected selling quantities', () => {
  const rule = bySku('13392889869_VNAMZ-117024762283');
  assert.equal(rule.costs.massG, 2000);
  assert.equal(rule.costs.beforePerFoodGram, 2277000 / 2000);
  assert.equal(rule.manufacturerVerified, false);
  const on = bySku('3265021607_VNAMZ-15762183506');
  assert.equal(on.costs.massG, 900);
  assert.equal(on.costs.beforePerFoodGram, 1087200 / 900);
});

test('handpicked matches distinguish exact flavours and exclude vanilla and peanut butter', () => {
  const levels = bySku('13451810835_VNAMZ-117268785502');
  assert.equal(levels.costs.massG, 2560);
  assert.equal(levels.available, false);
  assert.equal(levels.eligibleWheyRanking, false);
  assert.equal(
    bySku('3095127497_VNAMZ-14849213308').eligibleWheyRanking,
    false
  );
  assert.equal(report.counts.memberships.wheyFoodGram.uniqueExactSkuMatches, 3);
  assert.equal(
    report.counts.memberships.wheyProteinGram.uniqueExactSkuMatches,
    1
  );
});
