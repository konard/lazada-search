import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShoppingReport,
  shoppingReportMarkdown,
  calculateOffer,
} from '../src/index.js';
import { sha256 } from '../src/util.js';
import { draftWorkflowFixture } from './helpers/draft-workflows.js';

// These test drafts have not been executed. Fixtures are synthetic only.
test('all six ice unit prices use independent mass, volume and protein denominators', async (t) => {
  const { app } = await draftWorkflowFixture(t);
  const report = await buildShoppingReport(app, { quantities: [1], limit: 10 });
  const set = report.reports[0];
  const ice = set.rankings['chocolate-ice-cream'].costPerGramBeforeDelivery.top;
  assert.equal(ice.length, 1);
  assert.deepEqual(ice[0].quantities, {
    foodG: 100,
    ml: 200,
    proteinG: 5,
    sellingUnits: 1,
    innerPackagesPerSellingUnit: 1,
  });
  assert.equal(ice[0].metrics.costPerGramBeforeDelivery, 20000 / 100);
  assert.equal(ice[0].metrics.costPerMlBeforeDelivery, 20000 / 200);
  assert.equal(ice[0].metrics.costPerProteinGramBeforeDelivery, 20000 / 5);
  assert.equal(ice[0].metrics.costPerGramAfterDelivery, 25000 / 100);
  assert.equal(ice[0].metrics.costPerMlAfterDelivery, 25000 / 200);
  assert.equal(ice[0].metrics.costPerProteinGramAfterDelivery, 25000 / 5);
  assert.deepEqual(
    set.rankings['chocolate-ice-cream'].costPerGramBeforeDelivery.buyableTop,
    []
  );
  assert.equal(report.purchaseReady, false);
});

test('cheaper soy, vanilla, chocolate-coating and shaker options never displace target whey or ice', async (t) => {
  const { app } = await draftWorkflowFixture(t);
  const report = await app.shoppingReport();
  const set = report.reports[0];
  const whey = set.rankings.whey.costPerGramBeforeDelivery.top;
  assert.deepEqual(
    whey.map((row) => row.title),
    ['Unflavoured whey powder', 'Chocolate whey powder']
  );
  assert.equal(whey[0].metrics.costPerGramBeforeDelivery, 1000000 / 2000);
  assert.equal(
    set.rankings.soy.costPerGramBeforeDelivery.top[0].title,
    'Chocolate soy isolate'
  );
  assert.equal(
    set.rankings['chocolate-ice-cream'].costPerMlBeforeDelivery.top.length,
    1
  );
  assert.ok(whey.every((row) => row.quantities.ml === null));
});

test('held inner pack counts withhold every derived denominator even when label numbers exist', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const ice = await store.get('product', 'draft-product-5');
  await store.put('product', {
    ...ice,
    pendingSpecificationReview: ['packCount'],
  });
  const report = await app.shoppingReport();
  const row = report.reports[0].rows.find(
    (entry) => entry.productId === ice.id
  );
  assert.equal(row.quantities.foodG, null);
  assert.equal(row.quantities.ml, null);
  assert.equal(row.quantities.proteinG, null);
  for (const metric of Object.keys(row.metrics).filter((key) =>
    key.startsWith('costPer')
  )) {
    assert.equal(row.metrics[metric], null);
  }
});

test('no shipping quote for ten units is extrapolated from a one-unit quote', async (t) => {
  const { app } = await draftWorkflowFixture(t);
  const report = await app.shoppingReport({ quantities: [1, 10] });
  const ice = report.reports[1].rows.find(
    (row) => row.productId === 'draft-product-5'
  );
  assert.equal(ice.quantities.foodG, 1000);
  assert.equal(ice.quantities.ml, 2000);
  assert.equal(ice.metrics.costPerGramBeforeDelivery, 200);
  assert.equal(ice.metrics.costPerMlBeforeDelivery, 100);
  assert.equal(ice.metrics.totalAfterDelivery, null);
  assert.equal(ice.metrics.costPerGramAfterDelivery, null);
  assert.equal(ice.metrics.costPerMlAfterDelivery, null);
});

test('handpicked exact SKU intersection differs from listing intersection and sorts by gram price', async (t) => {
  const { app, data } = await draftWorkflowFixture(t);
  const unflavoured = data.offers[1];
  const chocolate = data.offers[0];
  const sibling = new URL(chocolate.url);
  sibling.searchParams.set('skuId', '999999');
  const report = await app.shoppingReport({
    handpicked: [chocolate.url, unflavoured.url, sibling.href],
  });
  const picked = report.reports[0].handpicked;
  assert.deepEqual(
    picked.sortedByGramPrice.map((row) => row.sku),
    [unflavoured.sku, chocolate.sku]
  );
  assert.equal(
    picked.membershipCounts.costPerGramBeforeDelivery.submittedListingMatches,
    3
  );
  assert.equal(
    picked.membershipCounts.costPerGramBeforeDelivery.submittedExactSkuMatches,
    2
  );
  assert.equal(picked.submitted[2].matches.length, 0);
  assert.ok(picked.submitted[2].listingMatches.length > 0);
});

function projectedApplication(row, baskets = []) {
  return {
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
    store: {
      list: (kind) => Promise.resolve(kind === 'offer' ? [row.offer] : []),
    },
    compare: () => Promise.resolve({ comparisons: [row], assumptions: {} }),
    compareBaskets: () =>
      Promise.resolve({ observations: baskets, assumptions: {} }),
    audit: () => Promise.resolve({ complete: false }),
  };
}

test('reviewed original-bound English and all three qualifications appear in Markdown', async () => {
  const product = {
    id: 'p',
    url: 'https://www.lazada.vn/products/fixture-i1-s2.html',
    title: 'Kem sô cô la',
    category: 'chocolate-ice-cream',
    netMassG: 100,
    netVolumeMl: 200,
    proteinPer100g: 5,
    packCount: 1,
    presentation: {
      title: {
        status: 'reviewed',
        originalText: 'Kem sô cô la',
        sourceSha256: sha256(Buffer.from('Kem sô cô la')),
        text: 'Chocolate ice cream',
      },
    },
  };
  const offer = {
    id: 'o',
    productId: 'p',
    url: product.url,
    sku: '1_VNAMZ-2',
    currency: 'VND',
    price: 20000,
    available: true,
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  };
  const source = calculateOffer(product, offer, {
    requireManufacturer: false,
    requireShipping: false,
  });
  const row = { ...source, manufacturerVerified: true, eligible: true };
  const report = await buildShoppingReport(projectedApplication(row));
  assert.equal(report.reports[0].rows[0].title, 'Chocolate ice cream');
  assert.equal(report.reports[0].rows[0].originalTitle, product.title);
  const markdown = shoppingReportMarkdown(report);
  assert.match(markdown, /Manufacturer-verified observations/);
  assert.match(markdown, /Qualified buying options/);
  assert.match(markdown, /Chocolate ice cream/);
  assert.match(markdown, /Kem sô cô la/);
});

test('invalidly bound English falls back to original; out-of-scope checkout never enters target ranks', async () => {
  const product = {
    id: 'p',
    title: 'Vanilla whey powder',
    category: 'whey',
    netMassG: 1000,
    proteinPer100g: 80,
    selectedVariant: [{ text: 'Vanilla' }],
    presentation: {
      title: {
        status: 'reviewed',
        originalText: 'Chocolate whey powder',
        text: 'Chocolate whey powder',
      },
    },
  };
  const offer = {
    id: 'o',
    productId: 'p',
    url: 'https://www.lazada.vn/products/fixture-i1-s2.html',
    sku: '1_VNAMZ-2',
    currency: 'VND',
    price: 100,
    available: true,
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  };
  const row = calculateOffer(product, offer, {
    requireManufacturer: false,
    requireShipping: false,
  });
  const quote = {
    id: 'q',
    observedAt: offer.observedAt,
    deliveryArea: 'Nha Trang',
    lines: [{ offerId: 'o', sku: offer.sku, quantity: 1, unitPrice: 100 }],
    appliedDiscounts: [],
  };
  const report = await buildShoppingReport(
    projectedApplication(row, [
      {
        quote,
        lines: [row],
        metrics: row.metrics,
        eligible: true,
        problems: [],
      },
    ])
  );
  assert.deepEqual(
    report.reports[0].rankings.whey.costPerGramBeforeDelivery.top,
    []
  );
  assert.equal(report.reports[0].pendingRows[0].title, product.title);
});
