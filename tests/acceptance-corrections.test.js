import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateOffer,
  categoryOf,
  extractNutrition,
  validateProduct,
} from '../src/index.js';
import { scopeAccountAudit } from '../scripts/account-category-scope.mjs';
import { auditCoverage } from '../src/coverage.js';
import { isShakerBundle, productFlavour } from '../src/flavour-scope.js';

const url = (id) => `https://www.lazada.vn/products/pdp-i${id}.html`;
const product = {
  id: 'ice',
  title: 'Chocolate ice cream',
  url: url(991),
  category: 'chocolate-ice-cream',
  netVolumeMl: 130,
  packCount: 24,
  proteinPerPackageG: 1,
};
const offer = {
  id: 'price',
  productId: 'ice',
  url: product.url,
  currency: 'VND',
  price: 648000,
  observedAt: '2026-10-10T17:00:00Z',
  variantConfirmed: true,
};
const options = { quantity: 2, allowStale: true, requireManufacturer: false };

test('package protein prices all food packages and order units without inventing net grams or freight', () => {
  const row = calculateOffer(product, offer, options);
  assert.equal(row.metrics.totalProteinG, 48);
  assert.equal(row.metrics.totalVolumeMl, 6240);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, 27000);
  assert.equal(row.metrics.costPerProteinGramAfterDelivery, null);
  assert.equal(row.metrics.proteinBasis, 'package');
  assert.equal(row.eligible, false);
});

test('per100ml nutrition is parsed with its original basis and prices protein independently of mass', () => {
  const nutrition = extractNutrition(
    'Thể tích: 130 ml\nTrên 100 ml\nChất đạm 2 g\nĐường 10 g\nNăng lượng 140 kcal'
  );
  assert.equal(nutrition.fields.proteinPer100ml, 2);
  assert.equal(nutrition.fields.sugarPer100ml, 10);
  assert.equal(nutrition.fields.kcalPer100ml, 140);
  assert.equal(nutrition.fields.proteinPer100g, undefined);
  const row = calculateOffer(
    { ...product, proteinPerPackageG: undefined, ...nutrition.fields },
    offer,
    options
  );
  assert.equal(row.metrics.totalProteinG, 124.8);
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, 1296000 / 124.8);
  assert.equal(row.metrics.proteinBasis, '100ml');
  assert.equal(row.metrics.proteinPer100kcal, (100 * 2) / 140);
  assert.equal(row.metrics.sugarPer25gProtein, 125);
  assert.equal(row.metrics.totalMassG, null);
  const mixed = extractNutrition('Per 100 g\nPer 100 ml\nProtein 2 g');
  assert.equal(mixed.fields.proteinPer100g, undefined);
  assert.equal(mixed.fields.proteinPer100ml, undefined);
  assert.ok(mixed.warnings.includes('Multiple nutrition columns need review'));
});

test('conflicting protein bases and invalid volume claims cannot supply a cheapest protein rank', () => {
  const row = calculateOffer(
    { ...product, proteinPer100ml: 2 },
    offer,
    options
  );
  assert.equal(row.metrics.totalProteinG, null);
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, null);
  assert.equal(row.metrics.proteinConflict, true);
  assert.ok(
    row.problems.some((problem) =>
      problem.startsWith('Conflicting protein amounts')
    )
  );
  const disputed = calculateOffer(
    {
      ...product,
      proteinPerPackageG: undefined,
      proteinPer100ml: 2,
      crossChecks: [{ conflicts: [{ field: 'proteinPer100ml' }] }],
    },
    offer,
    options
  );
  assert.equal(disputed.metrics.totalProteinG, null);
  assert.throws(
    () => validateProduct({ ...product, proteinPer100ml: -1 }),
    /proteinPer100ml/u
  );
  assert.throws(
    () => validateProduct({ ...product, proteinPerPackageG: '1' }),
    /proteinPerPackageG/u
  );
});

test('real irrelevant cached titles are excluded while gifts and ambiguous flavour siblings remain collectable', () => {
  const titles = [
    'Bình Lắc Điện USB 450ml, Máy Xay Protein Whey Cầm Tay, Cốc Khuấy Tự Động Hoàn Toàn, Sạc Lại Được, Máy Xay Sinh Tố Thể Thao Phòng Gym',
    '650Ml Điện Bình Lắc Di Động Whey Protein Tự Động Khuấy Máy Xay Sinh Tố Đa Năng Máy Trộn Nước Ép Cốc Tập Thể Hình USB Sạc',
    'Whey Protein Vegan Thực Vật Thuần Chay AFIT Giúp Tăng Cơ Giảm Mỡ - Hàng chính hãng',
    'Whey Protein thực vật Plant Protein Sữa Tăng Cân Tăng Cơ',
    'Soy Protein Isolate Chocolate 1kg',
    '[Free Shaker] 5LBS Rule 1 Protein Whey Protein Hydro Cao Cấp',
    'Whey Protein Vanilla 5lbs',
    'Clear Whey Protein Peach Tea',
    '',
  ];
  const discoveries = titles.map((title, index) => ({
    url: url(800 + index),
    title,
  }));
  const audit = {
    missingListings: discoveries.map((record) => record.url),
    missingSkuPrices: discoveries.map((record, index) => ({
      listingUrl: record.url,
      sku: String(index),
      options: [{ value: 'Chocolate' }],
    })),
    categoryReview: [],
    specifications: [],
  };
  const before = globalThis.structuredClone(audit);
  const result = scopeAccountAudit(audit, {
    discoveries,
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.deepEqual(
    result.missingListings,
    discoveries.slice(5).map((record) => record.url)
  );
  assert.deepEqual(
    result.missingSkuPrices.map((record) => record.sku),
    ['5', '6', '7', '8']
  );
  assert.equal(result.excludedCategoryListings.length, 5);
  assert.ok(
    result.excludedCategoryListings.every((record) => record.reasons.length)
  );
  assert.deepEqual(audit, before);
  assert.equal(scopeAccountAudit(audit, { discoveries }), audit);
  assert.equal(categoryOf(titles[0]), 'unknown');
  assert.equal(categoryOf(titles[1]), 'unknown');
  assert.equal(categoryOf(titles[5]), 'whey');
});

test('conflicting discovery titles do not remove a possible relevant sibling listing', () => {
  const audit = { missingListings: [url(800)] };
  const discoveries = [
    { url: url(800), title: 'Electric shaker whey protein' },
    { url: url(800), title: 'Whey powder chocolate 1kg' },
  ];
  const result = scopeAccountAudit(audit, {
    discoveries,
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.deepEqual(result.missingListings, audit.missingListings);
  assert.deepEqual(result.excludedCategoryListings, []);
});

test('completed detail collection recomputes bounded readiness without relying on stale discovery-stage flags', () => {
  const crawl = {
    queries: ['whey protein'],
    scopes: [{ query: 'whey protein', terminalConfirmed: true }],
    visibleSearchComplete: false,
    uncollectedUrls: [url(800)],
    failures: [],
  };
  const incomplete = auditCoverage({ crawl });
  assert.equal(incomplete.sourceListsComplete, true);
  assert.equal(incomplete.visibleSearchComplete, false);
  const completed = auditCoverage({
    crawl,
    products: [{ id: 'done', url: url(800), category: 'unknown' }],
  });
  assert.equal(completed.visibleSearchComplete, true);
  assert.equal(completed.complete, false);
  assert.equal(completed.purchaseReady, false);
  const failed = auditCoverage({
    crawl: { ...crawl, failures: [{ reason: 'category redirected to home' }] },
    products: [{ url: url(800) }],
  });
  assert.equal(failed.sourceListsComplete, false);
  assert.equal(failed.visibleSearchComplete, false);
  assert.equal(auditCoverage({}).visibleSearchComplete, false);
});

test('explicit no-shaker selections and peach-tea SKUs respect buyer preferences', () => {
  assert.equal(
    isShakerBundle({ selectedVariant: [{ text: 'Chocolate không bình lắc' }] }),
    false
  );
  assert.equal(
    isShakerBundle({ selectedVariant: [{ text: 'Chocolate without shaker' }] }),
    false
  );
  assert.equal(
    isShakerBundle({ selectedVariant: [{ text: 'Chocolate + Shaker' }] }),
    true
  );
  assert.equal(
    productFlavour({
      selectedVariant: [{ text: 'Peach Tea' }],
      title: 'Whey chocolate vanilla',
    }),
    'other'
  );
});
