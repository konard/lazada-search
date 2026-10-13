import test from 'node:test';
import assert from 'node:assert/strict';
import {
  caseEvidenceGates,
  capturedOfferOriginals,
  readinessComparisons,
} from '../src/case-evidence-gates.js';
import { draftWorkflowFixture } from './helpers/draft-workflows.js';

const now = Date.now();
const originalListingHtml =
  '<html><body><h1>Chocolate whey</h1><div data-product-price>100.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-11</span></div><div class="delivery-v2"><span class="location-v2__address">Khánh Hòa, Phường Nha Trang</span>Giao tiêu chuẩn, phí vận chuyển 10.000 ₫</div></body></html>';
function row(category) {
  return {
    product: {
      id: category,
      category,
      title: 'Chocolate',
      ingredients: ['Whey protein isolate'],
      manufacturerVerification: { identity: { coreFlavour: 'chocolate' } },
    },
    manufacturerVerified: true,
    eligible: true,
    offer: {
      id: category,
      url: 'https://www.lazada.vn/products/pdp-i100.html',
      sku: '100_VNAMZ-11',
      price: 100000,
      currency: 'VND',
      variantConfirmed: true,
      available: true,
      evidenceId: 'price',
      observedAt: new Date(now).toISOString(),
      quoteEvidenceId: 'quote',
      quoteObservedAt: new Date(now).toISOString(),
      shipping: 10000,
      shippingQuantity: 3,
      deliveryArea: 'Nha Trang',
      shippingDestination: 'Khánh Hòa, Phường Nha Trang',
      coldChainConfirmed: true,
      stock: 10,
    },
    metrics: {
      quantity: 3,
      shipping: 10000,
      totalBeforeDelivery: 300000,
      totalAfterDelivery: 310000,
      totalMassG: 3000,
      totalVolumeMl: 6000,
      totalProteinG: 2400,
      costPerGramBeforeDelivery: 100,
      costPerGramAfterDelivery: 310000 / 3000,
      costPerMlBeforeDelivery: 50,
      costPerMlAfterDelivery: 310000 / 6000,
      costPerProteinGramBeforeDelivery: 125,
      costPerProteinGramAfterDelivery: 310000 / 2400,
    },
  };
}
function inputs() {
  return {
    coverage: {
      scope: 'test-scope',
      manifest: {
        declaredRows: 2,
        scopedPricesComplete: true,
        scope: 'test-scope',
      },
      observedScopeReady: true,
    },
    rows: [row('whey'), row('chocolate-ice-cream')],
    originals: { complete: true },
    translation: { completeCachedCatalogEnglishAccepted: true },
    quantity: 3,
    deliveryArea: 'Nha Trang',
    now,
    maxPriceAgeMs: 86400000,
  };
}

test('captured readiness can advance only when every declared-inventory evidence gate passes', () => {
  const data = inputs();
  assert.ok(Object.values(caseEvidenceGates(data)).every(Boolean));
  for (const mutate of [
    (value) => {
      value.coverage.manifest.declaredRows = 0;
    },
    (value) => {
      value.coverage.manifest.scope = 'other-city';
    },
    (value) => {
      value.coverage.observedScopeReady = false;
    },
    (value) => {
      value.rows = [];
    },
    (value) => {
      value.rows[0].product.category = 'soy';
    },
    (value) => {
      value.rows[0].manufacturerVerified = false;
    },
    (value) => {
      value.originals.complete = false;
    },
    (value) => {
      value.translation.completeCachedCatalogEnglishAccepted = false;
    },
    (value) => {
      value.rows[1].metrics.totalVolumeMl = null;
    },
    (value) => {
      value.rows[1].metrics.costPerMlAfterDelivery = NaN;
    },
    (value) => {
      value.rows[1].metrics.costPerProteinGramBeforeDelivery = null;
    },
    (value) => {
      value.rows[1].offer.coldChainConfirmed = false;
    },
    (value) => {
      delete value.rows[1].product.manufacturerVerification.identity
        .coreFlavour;
    },
    (value) => {
      value.rows[1].product.manufacturerVerification.identity.coreFlavour =
        'vanilla';
    },
    (value) => {
      value.rows[1].offer.stock = 2;
    },
    (value) => {
      value.rows[1].offer.shippingQuantity = 1;
    },
    (value) => {
      value.rows[1].offer.quoteObservedAt = new Date(now + 1).toISOString();
    },
    (value) => {
      value.rows[1].offer.quoteObservedAt = 'not-a-date';
    },
    (value) => {
      value.rows[1].offer.observedAt = new Date(now - 86400001).toISOString();
    },
  ]) {
    const changed = globalThis.structuredClone(data);
    mutate(changed);
    assert.ok(
      Object.values(caseEvidenceGates(changed)).some((passed) => !passed)
    );
  }
});

test('readiness verifies actual saved originals under a collection stop and withdraws changed or invalidated evidence', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const original = await store.putBlob(originalListingHtml);
  const observedAt = new Date(now).toISOString();
  const url = row('whey').offer.url;
  await store.put('evidence', { id: 'price', html: original, observedAt, url });
  await store.put('evidence', {
    id: 'quote',
    html: original,
    observedAt,
    url,
    shippingQuantity: 1,
    shippingDestination: 'Khánh Hòa, Phường Nha Trang',
  });
  const bindings = ['price', 'quote'].map((evidenceId) => ({
    evidenceId,
    sourceSha256: original.sha256,
  }));
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
  });
  const rows = [row('whey')];
  rows[0].offer.shippingQuantity = 1;
  assert.equal(
    (await capturedOfferOriginals(app, rows, bindings)).complete,
    true
  );
  for (const change of [
    { price: 99999 },
    { sku: '100_VNAMZ-12' },
    { shipping: 9999 },
    { shippingQuantity: 3 },
    { shippingDestination: 'Hồ Chí Minh' },
  ]) {
    const changed = globalThis.structuredClone(rows);
    Object.assign(changed[0].offer, change);
    assert.equal(
      (await capturedOfferOriginals(app, changed, bindings)).complete,
      false
    );
  }
  const different = await store.putBlob(
    'Different valid original at the same date'
  );
  await store.put('evidence', {
    id: 'price',
    html: different,
    observedAt,
    url,
  });
  assert.equal(
    (await capturedOfferOriginals(app, rows, bindings)).complete,
    false
  );
  await store.put('evidence', {
    id: 'price',
    html: original,
    observedAt,
    url: 'https://www.lazada.vn/products/pdp-i200.html',
  });
  assert.equal(
    (await capturedOfferOriginals(app, rows, bindings)).complete,
    false
  );
  await store.put('evidence', { id: 'price', html: original, observedAt, url });
  await store.put('invalidation', {
    id: 'review-revocation',
    evidenceIds: ['quote'],
    invalidated: true,
  });
  const withdrawn = await capturedOfferOriginals(app, rows, bindings);
  assert.equal(withdrawn.complete, false);
  assert.equal(withdrawn.problems[0].offerId, 'whey');
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
});

test('missing, changed-date and corrupt source descriptors cannot establish current price originals', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const rows = [row('whey')];
  assert.equal((await capturedOfferOriginals(app, rows)).complete, false);
  const html = await store.putBlob('Synthetic original');
  const bindings = ['price', 'quote'].map((evidenceId) => ({
    evidenceId,
    sourceSha256: html.sha256,
  }));
  await store.put('evidence', {
    id: 'price',
    html,
    observedAt: '2020-01-01T00:00:00.000Z',
    url: rows[0].offer.url,
  });
  await store.put('evidence', {
    id: 'quote',
    html,
    observedAt: rows[0].offer.quoteObservedAt,
    url: rows[0].offer.url,
  });
  assert.equal(
    (await capturedOfferOriginals(app, rows, bindings)).complete,
    false
  );
  await store.put('evidence', {
    id: 'price',
    html: { ...html, bytes: html.bytes + 1 },
    observedAt: rows[0].offer.observedAt,
    url: rows[0].offer.url,
  });
  assert.equal(
    (await capturedOfferOriginals(app, rows, bindings)).complete,
    false
  );
  assert.equal((await capturedOfferOriginals(app, [])).complete, false);
});

test('only an eligible exact one-line basket contributes net freight and one-time discounts to captured readiness', () => {
  const offerRow = row('whey');
  offerRow.eligible = false;
  const line = row('whey');
  const basket = {
    quote: {
      id: 'exact-basket',
      lines: [{ quantity: 3 }],
      evidenceId: 'quote',
      observedAt: line.offer.observedAt,
      deliveryArea: 'Nha Trang',
      shippingDestination: line.offer.shippingDestination,
      coldChainConfirmed: true,
    },
    lines: [line],
    metrics: {
      ...line.metrics,
      totalBeforeDelivery: 280000,
      totalAfterDelivery: 285000,
      shipping: 10000,
      costPerGramBeforeDelivery: 280000 / 3000,
      costPerGramAfterDelivery: 95,
    },
  };
  const result = readinessComparisons(
    { comparisons: [offerRow] },
    { ranked: [basket] },
    3
  );
  assert.equal(result[0].metrics.shipping, 5000);
  assert.equal(result[0].offer.shipping, 5000);
  assert.equal(result[0].sourceQuoteId, 'exact-basket');
  assert.equal(result[0].eligible, true);
  const mixed = globalThis.structuredClone(basket);
  mixed.quote.lines.push({ quantity: 1 });
  assert.equal(
    readinessComparisons({ comparisons: [offerRow] }, { ranked: [mixed] }, 3)[0]
      .eligible,
    false
  );
  assert.equal(
    readinessComparisons(
      { comparisons: [offerRow] },
      { ranked: [basket] },
      2
    )[0].eligible,
    false
  );
  assert.equal(
    readinessComparisons({ comparisons: [offerRow] }, { ranked: [] }, 3)[0]
      .eligible,
    false
  );
});

test('readiness requires a positive finite integer quantity and a nonnegative freshness interval', async (t) => {
  const { app } = await draftWorkflowFixture(t);
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(app.caseReadiness({ quantity }), /quantity/u);
  }
  await assert.rejects(
    app.caseReadiness({ maxPriceAgeMs: -1 }),
    /maxPriceAgeMs/u
  );
});

test('fully discounted source-qualified orders retain zero unit rates as valid comparisons', () => {
  const data = inputs();
  for (const value of data.rows) {
    value.offer.shipping = 0;
    value.metrics.shipping = 0;
    value.metrics.totalBeforeDelivery = 0;
    value.metrics.totalAfterDelivery = 0;
    for (const field of [
      'costPerGramBeforeDelivery',
      'costPerGramAfterDelivery',
      'costPerMlBeforeDelivery',
      'costPerMlAfterDelivery',
      'costPerProteinGramBeforeDelivery',
      'costPerProteinGramAfterDelivery',
    ]) {
      value.metrics[field] = 0;
    }
  }
  assert.ok(Object.values(caseEvidenceGates(data)).every(Boolean));
  data.rows[0].metrics.totalBeforeDelivery = -1;
  assert.equal(caseEvidenceGates(data).exactQuantityDestinationAndStock, false);
});
