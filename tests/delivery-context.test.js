import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AssociativeStore, EvidenceCache, LazadaSearch } from '../src/index.js';
import { calculateOffer } from '../src/compare.js';
import { captureDelivery } from '../src/delivery.js';
import {
  deliveryAreaForDestination,
  deliveryContextMatches,
} from '../src/delivery-context.js';
import { reportUnitCosts } from '../scripts/report-unit-costs.mjs';

const nhaTrang = 'Khánh Hòa, Phường Nha Trang';
const hoChiMinh = 'Thành phố Hồ Chí Minh, Phường Bến Thành';
const url = 'https://www.lazada.vn/products/chocolate-i201-s11.html';
const observedAt = '2026-10-10T15:35:24.245Z';
const product = {
  id: 'ice',
  category: 'chocolate-ice-cream',
  netMassG: 500,
  netVolumeMl: 860,
  proteinPer100g: 5,
};
const offer = {
  id: 'ice-offer',
  productId: product.id,
  price: 100000,
  currency: 'VND',
  shipping: 30000,
  shippingQuantity: 1,
  deliveryArea: 'Nha Trang',
  shippingDestination: nhaTrang,
  variantConfirmed: true,
  coldChainConfirmed: true,
  observedAt,
};
const options = {
  deliveryArea: 'Nha Trang',
  requireManufacturer: false,
  now: Date.parse(observedAt),
};

test('address evidence determines delivery area without relabelling other cities or nearby wards', () => {
  assert.equal(deliveryAreaForDestination(nhaTrang), 'Nha Trang');
  assert.equal(
    deliveryAreaForDestination('Tỉnh Khánh Hòa, Thành phố Nha Trang'),
    'Nha Trang'
  );
  assert.equal(deliveryAreaForDestination(hoChiMinh), hoChiMinh);
  assert.equal(
    deliveryAreaForDestination('Khánh Hòa, Phường Cam Ranh'),
    'Khánh Hòa, Phường Cam Ranh'
  );
  assert.equal(deliveryAreaForDestination(undefined), '');
  assert.equal(deliveryContextMatches(offer, 'Nha Trang'), true);
  assert.equal(
    deliveryContextMatches(
      { ...offer, shippingDestination: hoChiMinh },
      'Nha Trang'
    ),
    false
  );
  assert.equal(
    deliveryContextMatches({ ...offer, deliveryArea: undefined }, 'Nha Trang'),
    false
  );
});

test('mismatched source addresses never produce delivered gram, ml or protein prices', () => {
  for (const change of [
    { deliveryArea: 'Ho Chi Minh City' },
    { shippingDestination: hoChiMinh },
    { shippingDestination: 'Khánh Hòa, Phường Cam Ranh' },
    { shippingDestination: hoChiMinh, shipping: 0 },
    { deliveryArea: undefined },
  ]) {
    const wrong = { ...offer, ...change };
    const row = calculateOffer(product, wrong, options);
    assert.equal(row.metrics.shippingKnown, false);
    assert.equal(row.metrics.shipping, null);
    assert.equal(row.metrics.totalBeforeDelivery, 100000);
    assert.equal(row.metrics.costPerGramBeforeDelivery, 200);
    for (const field of [
      'totalAfterDelivery',
      'costPerGramAfterDelivery',
      'costPerMlAfterDelivery',
      'costPerProteinGramAfterDelivery',
      'costPer25gProteinAfterDelivery',
    ]) {
      assert.equal(row.metrics[field], null, field);
    }
    assert.ok(
      row.problems.includes('Delivery price not confirmed for this area')
    );
    assert.equal(
      reportUnitCosts({ product, offer: wrong }).deliveryQuoteMatched,
      false
    );
    assert.equal(
      reportUnitCosts({ product, offer: wrong }).totalAfterDelivery,
      null
    );
    const optionalShipping = calculateOffer(product, wrong, {
      ...options,
      requireShipping: false,
    });
    assert.equal(optionalShipping.metrics.totalAfterDelivery, null);
    assert.equal(optionalShipping.metrics.costPerGramAfterDelivery, null);
    assert.equal(optionalShipping.metrics.shippingKnown, false);
  }
  const exact = calculateOffer(product, offer, options);
  assert.equal(exact.metrics.totalAfterDelivery, 130000);
  assert.equal(exact.metrics.costPerGramAfterDelivery, 260);
  assert.equal(exact.metrics.costPerMlAfterDelivery, 130000 / 860);
  assert.equal(exact.metrics.costPerProteinGramAfterDelivery, 5200);
  assert.equal(
    calculateOffer(product, { ...offer, shipping: 0 }, options).metrics
      .totalAfterDelivery,
    100000
  );
});

test('an explicitly supplied freight amount is distinct from the wrong page estimate', () => {
  const wrong = { ...offer, shippingDestination: hoChiMinh };
  assert.equal(calculateOffer(product, wrong).metrics.totalAfterDelivery, null);
  assert.equal(
    calculateOffer(product, wrong, { ...options, shipping: 9000 }).metrics
      .totalAfterDelivery,
    109000
  );
  assert.equal(
    calculateOffer(product, offer, { ...options, quantity: 10 }).metrics
      .totalAfterDelivery,
    null
  );
  assert.ok(
    !calculateOffer(
      product,
      { ...wrong, deliveryAvailable: false },
      options
    ).problems.includes('The listing cannot deliver to this destination')
  );
});

const html = (destination) =>
  `<meta charset="utf-8"><h1>Whey chocolate 500g</h1><div data-product-price>100.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">201_VNAMZ-11</span></div><div class="delivery-v2"><span class="location-v2__address">${destination}</span>phí vận chuyển 30.000 ₫</div>`;

async function fixture(
  t,
  destination = nhaTrang,
  sourceDestination = destination
) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-delivery-context-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({ store, offline: true });
  const collector = {
    store,
    cache,
    page: (pageUrl, input) => cache.get(pageUrl, input),
    start: () => {
      throw new Error('No browser allowed');
    },
  };
  const original = await store.putBlob(Buffer.from(html(sourceDestination)));
  await store.put('cache', {
    id: `delivery:${destination}:1:${url}`,
    url,
    fetchedAt: Date.parse(observedAt),
    checkedAt: Date.parse(observedAt),
    observedAt,
    html: original,
    snapshot: {
      url,
      title: 'Whey chocolate 500g',
      priceText: '100.000',
      sku: '201_VNAMZ-11',
    },
    shipping: 30000,
    shippingQuantity: 1,
    shippingDestination: destination,
    text: `phí vận chuyển 30.000 ₫ ${destination}`,
    evidenceId: `delivery:${original.sha256}`,
  });
  return { store, collector, original, cache };
}

test('cached destination declarations must match unchanged original HTML without navigation', async (t) => {
  const { collector, cache } = await fixture(t, nhaTrang, hoChiMinh);
  const result = await captureDelivery(collector, url, {
    province: 'Khánh Hòa',
    locality: 'Phường Nha Trang',
  });
  assert.equal(result.cacheHit, true);
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /destination mismatch/u);
  assert.equal(cache.stats.downloads, 0);
  const app = new LazadaSearch({
    store: collector.store,
    collector,
    cache,
    offline: true,
    ocr: false,
  });
  await assert.rejects(app.delivery(url), /destination mismatch/u);
  assert.equal((await collector.store.list('offer')).length, 0);
});

test('cached destination estimates verify original digest and retain the valid observation', async (t) => {
  const { collector, original, store } = await fixture(t);
  const destination = { province: 'Khánh Hòa', locality: 'Phường Nha Trang' };
  const exact = await captureDelivery(collector, url, destination);
  assert.equal(exact.error, undefined);
  assert.equal(exact.shipping, 30000);
  assert.equal(exact.observedAt, observedAt);
  collector.store = {
    get: store.get.bind(store),
    blob: async () => Buffer.from(html(hoChiMinh)),
  };
  const corrupt = await captureDelivery(collector, url, destination);
  assert.equal(corrupt.html.sha256, original.sha256);
  assert.match(corrupt.error, /original digest/u);
});

test('explicit archived text subsets retain exact shipping context and reject contradictory addresses', async (t) => {
  const { collector, store, original } = await fixture(t);
  const id = `delivery:${nhaTrang}:1:${url}`;
  const legacy = { ...(await store.get('cache', id)) };
  delete legacy.html;
  legacy.captureSubset = true;
  legacy.originalSnapshotSha256 = original.sha256;
  legacy.text = `Tuỳ chọn giao hàng :\n${nhaTrang}\nTHAY ĐỔI\nphí vận chuyển 30.000 ₫`;
  await store.put('cache', legacy);
  const destination = { province: 'Khánh Hòa', locality: 'Phường Nha Trang' };
  const exact = await captureDelivery(collector, url, destination);
  assert.equal(exact.error, undefined);
  assert.equal(exact.deliverySourceValidation, 'captured-text-subset');
  assert.equal(exact.shipping, 30000);
  await store.put('cache', {
    ...legacy,
    text: legacy.text.replace(nhaTrang, hoChiMinh),
  });
  assert.match(
    (await captureDelivery(collector, url, destination)).error,
    /captured destination/u
  );
  await store.put('cache', { ...legacy, shipping: 0 });
  assert.match(
    (await captureDelivery(collector, url, destination)).error,
    /captured amount/u
  );
  await store.put('cache', { ...legacy, captureSubset: false });
  assert.match(
    (await captureDelivery(collector, url, destination)).error,
    /source provenance/u
  );
});

test('a valid custom-city estimate retains its own area and original observation', async (t) => {
  const { store, collector, cache } = await fixture(t, hoChiMinh);
  const app = new LazadaSearch({
    store,
    collector,
    cache,
    offline: true,
    ocr: false,
  });
  const collected = await app.importCapture({
    url,
    html: html(hoChiMinh),
    observedAt,
  });
  assert.equal(collected.offer.shipping, undefined);
  const result = await app.delivery(url, {
    province: 'Thành phố Hồ Chí Minh',
    locality: 'Phường Bến Thành',
  });
  assert.equal(result.applied, true);
  const recorded = await store.get('offer', collected.offer.id);
  assert.equal(recorded.deliveryArea, hoChiMinh);
  assert.equal(recorded.shippingDestination, hoChiMinh);
  assert.equal(recorded.quoteObservedAt, observedAt);
  const row = (await app.compare({ now: Date.parse(observedAt) }))
    .comparisons[0];
  assert.equal(row.metrics.totalAfterDelivery, null);
  assert.equal(row.metrics.totalBeforeDelivery, 100000);
});

test('real offline CLI comparison keeps a mislabeled city quote out of delivered prices', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-destination-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  await store.put('product', {
    ...product,
    title: 'Chocolate ice cream 500g 860ml',
    url,
    ingredients: ['milk', 'cocoa'],
    observedAt,
  });
  await store.put('offer', { ...offer, url, shippingDestination: hoChiMinh });
  const execute = promisify(execFile);
  const { stdout } = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'compare',
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
      '--allow-stale',
      '--delivery-area',
      'Nha Trang',
      '--sort',
      'costPerGramBeforeDelivery',
    ],
    { cwd: new URL('..', import.meta.url), timeout: 30000 }
  );
  const report = JSON.parse(stdout);
  assert.equal(report.comparisons.length, 1);
  const row = report.comparisons[0];
  assert.equal(row.metrics.totalBeforeDelivery, 100000);
  assert.equal(row.metrics.totalAfterDelivery, null);
  assert.equal(row.metrics.costPerGramBeforeDelivery, 200);
  assert.equal(row.metrics.costPerGramAfterDelivery, null);
  assert.equal(row.offer.shippingDestination, hoChiMinh);
  assert.ok(
    row.problems.includes('Delivery price not confirmed for this area')
  );
  assert.equal((await store.get('offer', offer.id)).shipping, 30000);
});
