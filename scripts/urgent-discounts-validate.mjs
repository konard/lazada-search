import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { listingKey } from '../src/util.js';

const directory = 'docs/acceptance/urgent-discounts';
const text = await readFile(`${directory}/reviewed-shortlist.json`, 'utf8');
const report = JSON.parse(text);
const close = (actual, expected) => {
  assert.ok(
    Math.abs(actual - expected) < Math.max(1e-8, Math.abs(expected) * 1e-10)
  );
};
const observed = report.allReviewedSelectedSkuObservations;
const canonicalSkus = observed.map(
  (row) => `${listingKey(row.url)}:${row.sku}`
);
assert.equal(new Set(canonicalSkus).size, canonicalSkus.length);
assert.equal(report.networkDownloads, 0);
assert.ok(
  !/\+84[\s-]*\d{8,10}|browser-profile|"(?:shippingDestination|cookie|authorization|sessionToken|password)"\s*:/iu.test(
    text
  )
);
for (const row of observed) {
  assert.ok(row.salePriceVnd > 0);
  assert.equal(row.saleAlreadyIncluded, true);
  if (row.originalPriceVnd > row.salePriceVnd) {
    close(row.saleSavingsVnd, row.originalPriceVnd - row.salePriceVnd);
  }
  for (const scenario of row.bulkScenarios) {
    if (row.bulkTiers.length === 0) {
      close(
        scenario.beforeDeliveryVnd,
        Math.max(
          0,
          row.salePriceVnd * scenario.quantity -
            row.confirmedAdditionalMonetaryDiscountVnd
        )
      );
    }
    if (!row.unitRankingWithheld && row.netMassG > 0) {
      close(
        scenario.foodMassG,
        row.netMassG * row.packCount * scenario.quantity
      );
      close(
        scenario.vndPerFoodGramBeforeDelivery,
        scenario.beforeDeliveryVnd / scenario.foodMassG
      );
    }
    if (!row.unitRankingWithheld && row.netVolumeMl > 0) {
      close(
        scenario.foodVolumeMl,
        row.netVolumeMl * row.packCount * scenario.quantity
      );
      close(
        scenario.vndPerMlBeforeDelivery,
        scenario.beforeDeliveryVnd / scenario.foodVolumeMl
      );
    }
    if (scenario.proteinG > 0) {
      close(scenario.proteinG, (scenario.foodMassG * row.proteinPer100g) / 100);
      close(
        scenario.vndPerProteinGramBeforeDelivery,
        scenario.beforeDeliveryVnd / scenario.proteinG
      );
    }
    if (
      scenario.quantity > 1 &&
      row.shippingQuotedQuantity !== scenario.quantity
    ) {
      assert.equal(scenario.freightVnd, null);
      assert.equal(scenario.afterDeliveryVnd, null);
      assert.equal(scenario.eligible, false);
    }
    if (scenario.afterDeliveryVnd !== null) {
      close(
        scenario.afterDeliveryVnd,
        scenario.beforeDeliveryVnd + scenario.freightVnd
      );
    }
    if (row.maxQuantity !== null && scenario.quantity > row.maxQuantity) {
      assert.equal(scenario.eligible, false);
    }
    if (row.unitRankingWithheld) {
      assert.equal(scenario.foodMassG, null);
      assert.equal(scenario.proteinG, null);
      assert.equal(scenario.vndPerFoodGramBeforeDelivery, null);
      assert.equal(scenario.eligible, false);
    }
  }
}
for (const row of [
  ...report.verifiedWhey,
  ...report.provisionalWhey,
  ...report.chocolateIceCream,
]) {
  assert.equal(row.requestedFlavorScopeMatched, true);
  assert.equal(row.unitRankingWithheld, false);
  assert.notEqual(row.available, false);
}
const seeq = observed.find(
  (row) => row.sku === '13479894070_VNAMZ-117397989208'
);
assert.equal(seeq.unitRankingWithheld, true);
assert.equal(seeq.netMassG, null);
const merinoCombo = observed.find(
  (row) => row.sku === '367656830_VNAMZ-116917756014'
);
assert.equal(merinoCombo.unitRankingWithheld, false);
close(merinoCombo.netMassG, 40);
close(merinoCombo.packCount, 5);
close(merinoCombo.metrics.totalMassG, 200);
close(merinoCombo.metrics.costPerGramBeforeDelivery, 195);
const priority = observed.find(
  (row) => row.sku === '3300919067_VNAMZ-16058119853'
);
if (priority.manufacturerVerified) {
  close(priority.netMassG, 2268);
  close(priority.proteinPer100g, (100 * 30) / 33);
  close(priority.metrics.totalProteinG, (2268 * 30) / 33);
  close(
    priority.metrics.costPerProteinGramBeforeDelivery,
    priority.salePriceVnd / ((2268 * 30) / 33)
  );
  if (priority.onePackageFreightVnd !== null) {
    close(
      priority.metrics.costPerProteinGramAfterDelivery,
      (priority.salePriceVnd + priority.onePackageFreightVnd) /
        ((2268 * 30) / 33)
    );
  }
}
const validation = {
  checkedAt: new Date().toISOString(),
  sourceCheckedAt: report.checkedAt,
  observedSelectedSkuCount: observed.length,
  bulkScenarioCount: observed.reduce(
    (count, row) => count + row.bulkScenarios.length,
    0
  ),
  downloads: 0,
  uniqueCanonicalSkuCheck: 'passed',
  saleDiscountNotSubtractedTwice: 'passed',
  foodPackDenominatorAppliedOnce: 'passed',
  unknownBulkFreightNotExtrapolated: 'passed',
  quantityBoundsPreserved: 'passed',
  rejectedProteinAsPowderMass: 'passed',
  merinoSelectedFiveStickDenominator: 'passed',
  privateFieldsExcluded: 'passed',
  currentItsJustIndependentProteinArithmetic: priority.manufacturerVerified
    ? 'passed'
    : 'exact verification pending',
};
await writeFile(
  `${directory}/validation.json`,
  `${JSON.stringify(validation, null, 2)}\n`
);
console.log(JSON.stringify(validation));
