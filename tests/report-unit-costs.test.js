import test from 'node:test';
import assert from 'node:assert/strict';
import {
  powderCategory,
  reportUnitCosts,
} from '../scripts/report-unit-costs.mjs';

const row = {
  product: { category: 'chocolate-ice-cream', netMassG: 40, packCount: 5 },
  offer: {
    price: 39000,
    currency: 'VND',
    variantConfirmed: true,
    observedAt: '2026-10-10T16:00:00Z',
  },
};

test('five sticks use food mass of the entire selected pack', () => {
  const cost = reportUnitCosts(row);
  assert.equal(cost.massG, 200);
  assert.equal(cost.beforePerFoodGram, 195);
  assert.equal(cost.beforePerMl, null);
  assert.equal(cost.afterPerFoodGram, null);
});

test('declared ice cream volume is independent of mass', () => {
  const cost = reportUnitCosts({
    ...row,
    product: {
      category: 'chocolate-ice-cream',
      netMassG: 3000,
      netVolumeMl: 6000,
    },
    offer: { ...row.offer, price: 539000 },
  });
  assert.equal(cost.beforePerFoodGram, 539000 / 3000);
  assert.equal(cost.beforePerMl, 539000 / 6000);
});

test('whey and soy stay separate; soy lecithin does not classify whey as soy', () => {
  assert.equal(
    powderCategory({
      category: 'protein-powder',
      title: 'Soy isolate chocolate',
    }),
    'soy'
  );
  assert.equal(
    powderCategory({ category: 'whey', title: 'Whey with soy lecithin' }),
    'whey'
  );
  assert.equal(
    powderCategory({ category: 'whey', title: 'Soy Protein Isolate' }),
    'soy'
  );
  assert.equal(
    powderCategory({ category: 'protein-powder', title: 'Unknown blend' }),
    'other-protein'
  );
  assert.equal(
    powderCategory({
      category: 'whey',
      manufacturerVerification: { identityMatched: true },
      ingredients: ['soy protein isolate', 'whey protein isolate'],
    }),
    'mixed-protein'
  );
  assert.equal(
    powderCategory({
      category: 'whey',
      manufacturerVerification: { identityMatched: true },
      ingredients: ['soy protein isolate'],
    }),
    'soy'
  );
});

test('powder cannot use shaker capacity as a food volume denominator', () => {
  const cost = reportUnitCosts({
    ...row,
    product: { category: 'whey', netMassG: 907, netVolumeMl: 600 },
  });
  assert.equal(cost.beforePerMl, null);
  assert.equal(cost.volumeMl, null);
});

test('shipping must match destination and quantity; zero freight is a valid quote', () => {
  const offer = {
    ...row.offer,
    shipping: 0,
    shippingQuantity: 1,
    deliveryArea: 'Nha Trang',
    coldChainConfirmed: true,
  };
  assert.equal(reportUnitCosts({ ...row, offer }).afterPerFoodGram, 195);
  for (const change of [
    { shippingQuantity: 5 },
    { deliveryArea: 'HCM' },
    { shippingInvalidated: true },
    { deliveryAvailable: false },
    { shippingQuantity: undefined },
    { coldChainConfirmed: false },
  ]) {
    assert.equal(
      reportUnitCosts({ ...row, offer: { ...offer, ...change } })
        .afterPerFoodGram,
      null
    );
  }
});

test('confirmed bulk tier and fixed discount are applied once to the order', () => {
  const cost = reportUnitCosts(
    {
      ...row,
      offer: {
        ...row.offer,
        bulkTiers: [{ minQuantity: 3, unitPrice: 35000 }],
        discount: 10000,
        shipping: 5000,
        shippingQuantity: 3,
        deliveryArea: 'Nha Trang',
        coldChainConfirmed: true,
      },
    },
    { quantity: 3 }
  );
  assert.equal(cost.massG, 600);
  assert.equal(cost.totalBeforeDelivery, 95000);
  assert.equal(cost.totalAfterDelivery, 100000);
  assert.equal(cost.beforePerFoodGram, 95000 / 600);
  assert.equal(cost.afterPerFoodGram, 100000 / 600);
});
