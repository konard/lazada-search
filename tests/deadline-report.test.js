import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { reportUnitCosts } from '../scripts/report-unit-costs.mjs';
import { deadlineFoodGramRanking } from '../scripts/deadline-report-costs.mjs';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';

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

test('original Hydropure food ranking retains seller2040g while factory protein arithmetic remains a separate conditional reference', async () => {
  const html = await readFile(
    new URL(
      '../docs/acceptance/bonus-hydropure-evidence/3095127497-14849213302-public.html',
      import.meta.url
    )
  );
  const hash =
    '55616c2c7fce2641eb592a39517f29d3371ed5dd48585c1c1a0f7100331ec852';
  assert.equal(createHash('sha256').update(html).digest('hex'), hash);
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i3095127497.html?skuId=14849213302',
  });
  const captured = parseProduct(snapshot, {
    evidenceId: `original:${hash}`,
    observedAt: '2026-10-10T15:35:24.245Z',
  });
  const row = {
    ...captured,
    manufacturerVerified: false,
    metrics: { totalMassG: 2050 },
  };
  const original = globalThis.structuredClone(row);
  const [food] = deadlineFoodGramRanking([row]);
  assert.equal(food.row.offer.sku, '3095127497_VNAMZ-14849213302');
  assert.equal(food.mass, 2040);
  assert.equal(food.before, 999997 / 2040);
  assert.equal(food.conditional, false);
  assert.equal(food.costs.proteinG, null);
  assert.equal(food.costs.beforePerProteinGram, null);
  const conditionalFactory = {
    conditional: true,
    identityMatched: false,
    ...reportUnitCosts(row, {
      productOverride: {
        netMassG: 2050,
        packCount: 1,
        proteinPer100g: (100 * 28) / 36,
      },
    }),
  };
  assert.equal(conditionalFactory.massG, 2050);
  assert.equal(conditionalFactory.proteinG, (2050 * 28) / 36);
  assert.equal(
    conditionalFactory.beforePerProteinGram,
    999997 / ((2050 * 28) / 36)
  );
  assert.equal(deadlineFoodGramRanking([row])[0].mass, 2040);
  assert.deepEqual(row, original);
});

test('food ranking cannot fill missing or disputed seller denominators from cached comparison or factory leads', () => {
  const row = {
    product: {
      category: 'whey',
      title: 'Chocolate whey',
      selectedVariant: [{ text: 'Chocolate' }],
    },
    offer: {
      sku: '3095127497_VNAMZ-14849213302',
      price: 999997,
      currency: 'VND',
      variantConfirmed: true,
      observedAt: '2026-10-10T15:35:24.245Z',
    },
    manufacturerVerified: false,
    metrics: { totalMassG: 2050 },
  };
  for (const product of [
    row.product,
    {
      ...row.product,
      netMassG: 2040,
      pendingSpecificationReview: ['netMassG'],
    },
    { ...row.product, netMassG: 2040, massEvidence: { conflicting: true } },
    { ...row.product, netMassG: 2040, packageCountUnresolved: true },
  ]) {
    assert.deepEqual(deadlineFoodGramRanking([{ ...row, product }]), []);
  }
});

test('food ranking preserves already reconciled exact manufacturer quantities and current destination quotes', () => {
  const row = {
    product: {
      category: 'whey',
      netMassG: 2050,
      packCount: 1,
      ingredients: ['whey protein isolate'],
      manufacturerVerification: {
        identityMatched: true,
        sourceAuthority: 'manufacturer',
      },
      claims: [
        {
          field: 'netMassG',
          value: 2050,
          source: 'manufacturer',
          requiresReview: false,
        },
      ],
    },
    offer: {
      price: 999997,
      currency: 'VND',
      variantConfirmed: true,
      observedAt: '2026-10-10T15:35:24.245Z',
      shipping: 37700,
      shippingQuantity: 1,
      deliveryArea: 'Nha Trang',
    },
    manufacturerVerified: true,
    metrics: { totalMassG: 2040 },
  };
  const original = globalThis.structuredClone(row);
  const [food] = deadlineFoodGramRanking([row]);
  assert.equal(food.mass, 2050);
  assert.equal(food.before, 999997 / 2050);
  assert.equal(food.after, 1037697 / 2050);
  assert.equal(food.row.manufacturerVerified, true);
  assert.equal(food.conditional, false);
  assert.deepEqual(row, original);
});
