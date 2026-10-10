import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWheyVerificationWorklist } from '../scripts/export-whey-verification-worklist.mjs';

const url = 'https://www.lazada.vn/products/pdp-i100.html';
const product = {
  id: 'captured-vanilla',
  url,
  sku: '100_VNAMZ-1',
  category: 'whey',
  title: 'Vanilla whey product with chocolate sibling',
  selectedVariant: [{ text: 'Vanilla' }],
  netMassG: 500,
  evidenceIds: ['seller-evidence'],
  ingredients: [],
};
const catalog = {
  market: 'vn',
  deliveryArea: 'Nha Trang',
  products: [product],
  offers: [],
  discoveries: [
    {
      id: 'discovery1',
      title: 'Vanilla whey',
      url: 'https://www.lazada.vn/products/vanilla-whey-i101.html',
      category: 'whey',
      cacheId: 'search-original',
      classification: 'candidate',
    },
    {
      id: 'unknown-category',
      title: 'Unknown imported powder',
      url: 'https://www.lazada.vn/products/pdp-i102.html',
      category: 'unknown',
      cacheId: 'search-original',
      classification: 'needs-category-review',
    },
  ],
  skuInventories: [
    {
      url,
      cacheId: 'product-original',
      skus: [
        { sku: '1', url, options: [{ name: 'Flavour', value: 'Vanilla' }] },
        { sku: '2', url, options: [{ name: 'Flavour', value: 'Chocolate' }] },
        { sku: '3', url, options: [{ name: 'Flavour', value: 'Vanilla' }] },
        { sku: '4', url, options: [{ name: 'Weight', value: '1kg' }] },
        {
          sku: '5',
          url,
          options: [{ name: 'Flavour', value: 'Chocolate + Shaker' }],
        },
      ],
    },
  ],
};

test('vanilla discovery titles and unknown categories remain resumable tasks', () => {
  const report = buildWheyVerificationWorklist(catalog);
  assert.equal(report.discoveryTasks.length, 2);
  const vanilla = report.discoveryTasks.find((task) =>
    task.url.includes('i101')
  );
  assert.equal(vanilla.flavourExcluded, false);
  assert.equal(vanilla.stage, 'collect-listing-and-all-selling-options');
  const unknown = report.discoveryTasks.find((task) =>
    task.url.includes('i102')
  );
  assert.equal(unknown.stage, 'review-category-before-filtering');
  assert.equal(unknown.status, 'pending');
});

test('exact selected options exclude only that SKU while unknown and chocolate siblings remain pending', () => {
  const report = buildWheyVerificationWorklist(catalog);
  const options = new Map(
    report.uncapturedSkuTasks.map((task) => [task.sku, task])
  );
  assert.equal(
    options.has('1'),
    false,
    'full captured SKU matches bare inventory SKU'
  );
  assert.equal(options.get('2').status, 'pending');
  assert.equal(options.get('3').status, 'out-of-scope-selected-option');
  assert.equal(
    options.get('4').status,
    'pending',
    'mass-only selected option cannot inherit vanilla title'
  );
  assert.equal(options.get('5').exclusionReason, 'selected-shaker-option');
  assert.equal(report.counts.pendingSkuTasks, 2);
  assert.equal(report.counts.excludedSkuOptions, 2);
});

test('source pointers retain original byte hashes and unresolved references remain explicit', () => {
  const report = buildWheyVerificationWorklist(catalog, {
    input: { sha256: 'input-digest' },
    sources: [
      {
        id: 'search-original',
        url: 'https://www.lazada.vn/catalog/',
        html: { sha256: 'original-search-bytes' },
      },
      {
        id: 'product-original',
        url,
        html: { sha256: 'original-product-bytes' },
      },
      { id: 'unrelated-source', url: 'https://example.com' },
    ],
  });
  assert.equal(report.originalSourcePointers.length, 2);
  assert.equal(
    report.originalSourcePointers[0].html.sha256,
    'original-search-bytes'
  );
  assert.equal(report.counts.unresolvedEvidencePointers, 1);
  assert.equal(report.input.sha256, 'input-digest');
  assert.equal(report.assumptions.networkRequests, 0);
  assert.equal(report.assumptions.sharedStoreWrites, 0);
});

test('soy isolate is separate and zero package price or stale shipping never becomes a verified whey winner', () => {
  const soy = {
    ...product,
    id: 'soy',
    sku: '100_VNAMZ-6',
    category: 'protein-powder',
    title: 'Soy protein isolate chocolate',
    selectedVariant: [{ text: 'Chocolate' }],
  };
  const report = buildWheyVerificationWorklist({
    ...catalog,
    products: [soy],
    offers: [
      {
        id: 'soy-price',
        productId: soy.id,
        price: 0,
        currency: 'VND',
        variantConfirmed: true,
      },
    ],
  });
  assert.equal(report.counts.strictSoySkus, 1);
  assert.equal(report.counts.strictWheySkus, 0);
  assert.equal(report.counts.verifiedStrictWheySkus, 0);
  assert.ok(
    report.capturedSkus[0].tasks.includes('capture-exact-selected-sku-price')
  );
  assert.equal(report.capturedSkus[0].manufacturerVerified, false);
  assert.equal(report.capturedSkus[0].costs.afterPerFoodGram, null);
});

test('a quarantined normalized category cannot be promoted by its whey title', () => {
  const report = buildWheyVerificationWorklist({
    ...catalog,
    products: [
      {
        ...product,
        category: 'unknown',
        selectedVariant: [{ text: 'Chocolate' }],
      },
    ],
    discoveries: [],
    skuInventories: [],
  });
  assert.equal(report.capturedSkus.length, 1);
  assert.equal(report.capturedSkus[0].scopeEligible, false);
  assert.match(report.capturedSkus[0].scopeExclusion, /category is outside/u);
});

test('unknown brands and invalidated specifications require explicit follow-up actions', () => {
  const report = buildWheyVerificationWorklist({
    ...catalog,
    products: [
      {
        ...product,
        title: 'Unbranded chocolate whey',
        selectedVariant: [{ text: 'Chocolate' }],
        specificationsInvalidated: true,
      },
    ],
  });
  const row = report.capturedSkus[0];
  assert.ok(row.tasks.includes('identify-manufacturer-from-original-package'));
  assert.equal(row.manufacturerVerified, false);
  assert.ok(
    row.manufacturerProblems.some((problem) => problem.includes('invalidated'))
  );
});
