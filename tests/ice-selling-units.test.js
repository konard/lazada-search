import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import {
  calculateOffer,
  categoryOf,
  compareOffers,
  extractPage,
  massGrams,
  matchesFlavourScope,
  packCountOf,
  parseProduct,
  validateProduct,
} from '../src/index.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/ice-selling-units.json', import.meta.url))
);
const parsed = (name) =>
  parseProduct(fixture.cases.find((c) => c.name === name).snapshot);

test('committed original Pongta carton preserves exact price, count and measured volume without inventing mass or protein', async () => {
  const bytes = gunzipSync(
    await readFile(
      new URL(
        '../docs/acceptance/ice-dual-units/expanded-root-pongta-carton.html.gz',
        import.meta.url
      )
    )
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    '39f5a43f7e064f82736e983ae9e30c134490cd1061a6009bdc3378fa57f322e1'
  );
  const { document } = parseHTML(bytes.toString());
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i3040048563.html?skuId=14623760583',
  });
  const { product, offer } = parseProduct(snapshot);
  assert.equal(offer.sku, '3040048563_VNAMZ-14623760583');
  assert.equal(offer.price, 648000);
  assert.equal(offer.variantConfirmed, true);
  assert.equal(product.category, 'chocolate-ice-cream');
  assert.equal(product.packCount, 24);
  assert.equal(product.netVolumeMl, 130);
  assert.equal(product.netMassG, undefined);
  assert.equal(product.proteinPer100g, undefined);
  assert.match(
    product.claims.find((c) => c.field === 'packCount').excerpt,
    /24 chai/u
  );
  const row = calculateOffer(product, offer, { quantity: 2 });
  assert.equal(row.metrics.totalVolumeMl, 6240);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.costPerMlBeforeDelivery, 1296000 / 6240);
  assert.equal(row.metrics.costPerMlAfterDelivery, null);
  assert.equal(row.metrics.totalProteinG, null);
  assert.equal(row.eligible, false);
  assert.equal(row.manufacturerVerified, false);
});

test('bottle, can and multiplier expressions identify inner food package counts independently of carton/container amounts', () => {
  for (const text of [
    'Thùng24 chai kem choco 130ml',
    'Thùng 24 lon kem chocolate 130ml',
    '24 bottles chocolate ice cream',
    '24 cans chocolate ice cream',
    'carton of 24',
    'case of 24',
    '24 x 130 ml / 131g',
    '24×130ml',
    '130ml x 24',
  ]) {
    assert.equal(packCountOf(text), 24, text);
  }
  for (const text of [
    '24 servings',
    'Shipping weight 24kg',
    '1 thùng',
    '24 months',
    'SKU 24',
  ]) {
    assert.equal(packCountOf(text), undefined, text);
  }
  for (const title of [
    'Thùng24 chai kem choco Power Cap Chocolate 130ml',
    'Kem chai Binggrae chocolate 130ml',
    'Kem mochi Aice chocolate',
  ]) {
    assert.equal(categoryOf(title), 'chocolate-ice-cream', title);
  }
  for (const title of [
    'Chocolate milk drink 24 bottles',
    'Kem chai dưỡng da socola',
    'Chocolate ice cream syrup 24 bottles',
  ]) {
    assert.equal(categoryOf(title), 'unknown', title);
  }
});

test('selected single and carton options use edible units without copying logistics counts or shipping weights', () => {
  for (const item of fixture.cases.slice(0, 4)) {
    const { product, offer } = parseProduct(item.snapshot);
    assert.equal(product.netMassG, item.expected.netMassG, item.name);
    assert.equal(product.netVolumeMl, item.expected.netVolumeMl, item.name);
    assert.equal(product.packCount, item.expected.packCount, item.name);
    assert.equal(
      product.packageCountUnresolved,
      item.expected.packageCountUnresolved,
      item.name
    );
    assert.equal(offer.price, item.expected.price, item.name);
  }
  const { product, offer } = parsed('two-cartons');
  const metrics = calculateOffer(product, offer, { quantity: 3 }).metrics;
  assert.equal(metrics.totalMassG, 131 * 48 * 3);
  assert.equal(metrics.totalVolumeMl, 130 * 48 * 3);
  assert.equal(metrics.totalBeforeDelivery, 1260000 * 3);
  const title = 'Kem chai chocolate 130ml/131g';
  const description = 'Quy cách: 24 chai/thùng';
  const single = parseProduct({
    ...fixture.cases[0].snapshot,
    title,
    description,
    selectedVariant: [{ text: 'Chai lẻ' }],
  }).product;
  assert.equal(single.packCount, 1);
  const unspecified = parseProduct({
    ...fixture.cases[0].snapshot,
    title,
    description,
    selectedVariant: [],
  }).product;
  assert.equal(unspecified.packCount, undefined);
  const carton = parseProduct({
    ...fixture.cases[0].snapshot,
    title,
    description,
    selectedVariant: [{ text: '1 thùng' }],
  }).product;
  assert.equal(carton.packCount, 24);
  assert.match(
    carton.claims.find((c) => c.field === 'packCount').excerpt,
    /Quy cách: 24 chai\/thùng/u
  );
  const titleCartons = parseProduct({
    ...fixture.cases[0].snapshot,
    title: '2 thùng 24 chai kem choco 130ml/131g',
    selectedVariant: [],
  }).product;
  assert.equal(titleCartons.packCount, 48);
  const conflicting = parseProduct({
    ...fixture.cases[0].snapshot,
    title,
    description: 'Quy cách: 24 chai/thùng\nQuy cách: 30 chai/thùng',
  }).product;
  assert.equal(conflicting.packCount, undefined);
  assert.equal(conflicting.packageCountUnresolved, true);
  for (const value of [
    'Shipping weight: 3500g; net weight: 131g',
    'Gross weight: 3.5kg; net weight: 131g',
    'Trọng lượng vận chuyển: 3500g; Khối lượng tịnh: 131g',
    'Trọng lượng cả bì: 3,5kg; Khối lượng tịnh: 131g',
  ]) {
    assert.equal(massGrams(value), 131, value);
  }
});

test('white-core and coating-only cheap fixtures stay outside strict rankings without gaining a vanilla or nutrition identity', () => {
  for (const item of fixture.cases.slice(4)) {
    const { product, offer } = parseProduct(item.snapshot);
    assert.equal(
      matchesFlavourScope(product, 'chocolate-or-unflavoured'),
      item.expected.strictChocolateEligible
    );
    assert.equal(product.proteinPer100g, undefined);
    assert.equal(product.manufacturerVerification, undefined);
    assert.equal(offer.price, item.expected.price);
    assert.equal(
      compareOffers([product], [offer], {
        flavourScope: 'chocolate-or-unflavoured',
      }).comparisons.length,
      0
    );
  }
});

test('unresolved carton count suppresses food/protein denominators but retains exact price in the worklist until evidence review', () => {
  const { product, offer } = parsed('unresolved-carton');
  const row = calculateOffer(
    { ...product, proteinPer100g: 2 },
    { ...offer, shipping: 10000 }
  );
  assert.equal(row.metrics.totalBeforeDelivery, 600000);
  assert.equal(row.metrics.totalAfterDelivery, 610000);
  for (const field of [
    'totalMassG',
    'totalVolumeMl',
    'totalProteinG',
    'costPerGramBeforeDelivery',
    'costPerMlBeforeDelivery',
    'costPerProteinGramAfterDelivery',
  ]) {
    assert.equal(row.metrics[field], null, field);
  }
  assert.ok(
    row.problems.some((p) => p.includes('count of inner food packages'))
  );
  const unitReport = compareOffers([product], [offer], {
    sort: 'costPerMlBeforeDelivery',
  });
  assert.equal(unitReport.observedPrices.length, 0);
  assert.equal(unitReport.unsortable.length, 1);
  const priceReport = compareOffers([product], [offer], {
    sort: 'totalBeforeDelivery',
  });
  assert.equal(priceReport.observedPrices.length, 1);
  const evidenceId = 'exact-package-label';
  const reviewed = validateProduct({
    ...product,
    packCount: 24,
    reviewedFields: ['packCount'],
    evidenceIds: [evidenceId],
    claims: [
      {
        field: 'packCount',
        value: 24,
        source: 'manual-review',
        requiresReview: false,
        evidenceId,
      },
    ],
  });
  assert.equal(reviewed.packageCountUnresolved, undefined);
  assert.equal(calculateOffer(reviewed, offer).metrics.totalVolumeMl, 3120);
  const unreviewed = validateProduct({ ...product, packCount: 24 });
  assert.equal(unreviewed.packageCountUnresolved, true);
  assert.equal(calculateOffer(unreviewed, offer).metrics.totalVolumeMl, null);
  assert.throws(
    () => validateProduct({ ...product, packageCountUnresolved: 'false' }),
    /must be a boolean/u
  );
});

test('shippingQuantity counts selected selling units while inner quantities and fixed discounts are applied once', () => {
  const { product, offer } = parsed('carton24');
  const quote = { ...offer, shipping: 50000, shippingQuantity: 2 };
  const row = calculateOffer(product, quote, { quantity: 2, discount: 40000 });
  assert.equal(row.metrics.totalMassG, 24 * 131 * 2);
  assert.equal(row.metrics.totalVolumeMl, 24 * 130 * 2);
  assert.equal(row.metrics.totalBeforeDelivery, 1256000);
  assert.equal(row.metrics.totalAfterDelivery, 1306000);
  assert.equal(row.metrics.costPerGramAfterDelivery, 1306000 / 6288);
  assert.equal(row.metrics.costPerMlAfterDelivery, 1306000 / 6240);
  assert.equal(
    calculateOffer(product, { ...quote, shippingQuantity: 24 }, { quantity: 2 })
      .metrics.totalAfterDelivery,
    null
  );
});
