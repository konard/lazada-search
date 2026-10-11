import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditHandpickedGramOrder } from '../scripts/audit-report-order.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../docs/tables/handpicked.json', import.meta.url),
    'utf8'
  )
);
const bySku = (sku) => report.rows.find((row) => row.exactSku === sku);
const top = JSON.parse(
  await readFile(new URL('../docs/tables/top-10-partial.json', import.meta.url))
);

test('all six handpicked selections preserve prices, with supported gram costs sorted before held quantities', () => {
  assert.equal(report.rows.length, 6);
  assert.equal(report.counts.capturedExactSkuRows, 6);
  assert.equal(report.counts.duplicateResolvedListingRows, 1);
  assert.equal(report.counts.duplicateResolvedExactSkuRows, 0);
  for (const row of report.rows) {
    assert.ok(row.priceVnd > 0);
  }
  const order = auditHandpickedGramOrder(report.rows);
  assert.equal(order.rankedRows, 5);
  assert.equal(order.unresolvedRows, 1);
  assert.equal(report.counts.supportedGramRows, order.rankedRows);
});

test('ambiguous paid bags remain held while a supported seller repack uses its selected mass', () => {
  const rule = bySku('13392889869_VNAMZ-117024762283');
  assert.equal(rule.priceVnd, 2277000);
  assert.equal(rule.costs.massG, null);
  assert.equal(rule.costs.beforePerFoodGram, null);
  assert.equal(rule.costs.afterPerFoodGram, null);
  assert.equal(rule.eligibleWheyRanking, false);
  assert.ok(rule.denominatorReview.pendingFields.includes('netMassG'));
  assert.equal(rule.denominatorReview.paidMassBasis.requiresReview, true);
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
  for (const [ranking, ranked] of [
    ['wheyFoodGram', top.whey],
    ['wheyProteinGram', top.verifiedProtein],
  ]) {
    const selected = new Set(report.rows.map((row) => row.exactSku));
    const intersection = new Set(
      ranked.filter((row) => selected.has(row.sku)).map((row) => row.sku)
    );
    assert.equal(
      report.counts.memberships[ranking].uniqueExactSkuMatches,
      intersection.size
    );
    assert.ok(!intersection.has(levels.exactSku));
    assert.ok(!intersection.has('3095127497_VNAMZ-14849213308'));
  }
});
