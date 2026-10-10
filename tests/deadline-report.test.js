import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reportUnitCosts } from '../scripts/report-unit-costs.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../docs/tables/top-10-partial.json', import.meta.url),
    'utf8'
  )
);

test('both whey top tens exclude soy and paid shaker selection', () => {
  for (const [rows, metric] of [
    [report.whey, 'beforePerFoodGram'],
    [report.verifiedProtein, 'beforePerProteinGram'],
  ]) {
    assert.equal(rows.length, 10);
    assert.ok(rows.every((r) => r.category === 'whey'));
    assert.ok(rows.every((r) => r.sku !== '3326435113_VNAMZ-16271820615'));
    assert.ok(rows.every((r) => r.sku !== '13335359191_VNAMZ-116522825388'));
    assert.ok(
      rows.every((row) => Number.isFinite(row[metric]) && row[metric] > 0)
    );
    assert.deepEqual(
      rows.map((row) => row[metric]),
      rows.map((row) => row[metric]).sort((a, b) => a - b)
    );
  }
  assert.equal(report.soyProtein[0].sku, '3326435113_VNAMZ-16271820615');
});

test('ProSupps retains printed 907 g when newly captured cheaper offers move it outside the top ten', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../docs/tables/catalog.json', import.meta.url))
  );
  const captured = catalog.comparisons.find(
    ({ offer }) => offer.sku === '1553990700_VNAMZ-6552645102'
  );
  assert.ok(
    captured,
    'The original selected offer must remain in the complete captured catalog'
  );
  const row = reportUnitCosts(captured);
  assert.equal(row.massG, 907);
  assert.equal(row.beforePerFoodGram, 1150000 / 907);
  assert.equal(row.beforePerMl, null);
  const ranked = report.whey.find((r) => r.sku === captured.offer.sku);
  if (ranked) {
    assert.equal(ranked.massG, 907);
  }
});

test('ice cream selling units preserve the five-stick and five-cone quantities', () => {
  const sticks = report.iceCream.find(
    (r) => r.sku === '367656830_VNAMZ-116917756014'
  );
  assert.equal(sticks.packagesPerSellingUnit, 5);
  assert.equal(sticks.massG, 200);
  assert.equal(sticks.beforePerFoodGram, 39000 / 200);
  const cones = report.iceCream.find(
    (r) => r.sku === '497264871_VNAMZ-15825435034'
  );
  assert.equal(cones.massG, 300);
  assert.equal(cones.beforePerFoodGram, 89000 / 300);
  assert.equal(cones.available, false);
});

test('ice evidence keeps every captured candidate and never invents frozen-delivery prices', () => {
  assert.ok(report.iceCream.length >= 10);
  for (const row of report.iceCream) {
    assert.equal(row.afterPerFoodGram, null);
    assert.equal(row.afterPerMl, null);
  }
  const tub = report.iceCream.find(
    (r) => r.sku === '1561216831_VNAMZ-6599331044'
  );
  assert.equal(tub.volumeMl, 6000);
  assert.equal(tub.beforePerMl, 539000 / 6000);
});
