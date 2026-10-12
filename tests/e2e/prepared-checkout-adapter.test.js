import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  LazadaSearch,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
} from '../../src/index.js';
import { capturePreparedLazadaCheckout } from '../../src/lazada-checkout-capture.js';
import { planCheckoutScenarios } from '../../src/checkout-scenarios.js';
import { runPreparedLazadaCheckoutScenarios } from '../../src/lazada-checkout-actions.js';

const checkoutUrl = 'https://cart.lazada.vn/cart';
const html = `<html><head><title>Local prepared checkout</title></head><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="line" data-item-id="100" data-sku-id="11">
<input id="selected" type="checkbox" checked><input id="quantity" type="number" value="2">
<span id="unit">100.000 ₫</span><span id="subtotal">200.000 ₫</span>
<span id="stock">3</span><span id="available">Còn hàng</span><span id="eligible">Số lượng hợp lệ</span></div>
<span id="shipping">20.000 ₫</span><span id="total">200.000 ₫</span>
<span id="voucher-id">MERCH20</span><span id="voucher-amount">-20.000 ₫</span>
<span id="payment">Cash on delivery</span><span id="vouchers">MERCH20 applied</span>
</body></html>`;

function reviewedLayout() {
  return {
    id: 'synthetic-browser-layout',
    reviewed: true,
    reviewedBy: 'Fixture reviewer',
    reviewedAt: new Date().toISOString(),
    selectors: {
      destination: '#address',
      shipping: '#shipping',
      total: '#total',
      paymentMethod: '#payment',
      voucherState: '#vouchers',
    },
    lines: [
      {
        offerId: 'offer:100-11',
        sku: '100_VNAMZ-11',
        identityBinding: {
          kind: 'attributes',
          rowSelector: '#line',
          itemId: { selector: '#line', attribute: 'data-item-id' },
          skuId: { selector: '#line', attribute: 'data-sku-id' },
          selection: { selector: '#selected', attribute: 'checked' },
        },
        quantityBinding: { selector: '#quantity', attribute: 'value' },
        selectors: {
          unitPrice: '#unit',
          subtotal: '#subtotal',
          stock: '#stock',
          availability: '#available',
          eligibility: '#eligible',
        },
      },
    ],
    appliedDiscounts: [
      {
        id: 'MERCH20',
        scope: 'merchandise',
        selector: '#voucher-amount',
        identitySelector: '#voucher-id',
        amountSign: 'negative-reduction',
      },
    ],
  };
}

test('actual Chromium prepared checkout binds original quantities and stops on changed live controls, dialogs and CAPTCHA', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-prepared-checkout-e2e-')
  );
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const cache = new EvidenceCache({
    store,
    offline: true,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    browserOptions: { launch: 'engine', persistent: false },
  });
  const app = new LazadaSearch({
    store,
    cache,
    collector,
    offline: true,
    ocr: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.put('offer', {
    id: 'offer:100-11',
    productId: 'product:100-11',
    sku: '100_VNAMZ-11',
    url: 'https://www.lazada.vn/products/pdp-i100-s11.html',
    currency: 'VND',
    price: 100000,
    available: true,
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  });
  await collector.start();
  const page = collector.runtime.page;
  let intercepted = 0;
  await page.route('**/*', (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url() === checkoutUrl
    ) {
      intercepted += 1;
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: html,
      });
    }
    return route.abort();
  });
  await page.goto(checkoutUrl);
  const position = await page.evaluate(() => ({
    x: globalThis.scrollX,
    y: globalThis.scrollY,
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  }));
  const input = {
    layout: reviewedLayout(),
    deliveryArea: 'Nha Trang',
    readiness: { stableMs: 2000, timeoutMs: 4000 },
  };
  const captured = await capturePreparedLazadaCheckout(app, input);
  const quote = await store.get('basket-quote', captured.quoteId);
  assert.equal(quote.total, 200000);
  assert.equal(quote.shipping, 20000);
  assert.equal(quote.lines[0].quantity, 2);
  assert.equal(quote.lines[0].sku, '100_VNAMZ-11');
  assert.equal(quote.visibility, 'private');
  assert.equal(intercepted, 1);
  assert.deepEqual(
    await page.evaluate(() => ({
      x: globalThis.scrollX,
      y: globalThis.scrollY,
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    })),
    position
  );

  await page.locator('#quantity').evaluate((element) => {
    element.value = '3';
  });
  await assert.rejects(
    capturePreparedLazadaCheckout(app, input),
    /quantity|serialized|original/iu
  );
  assert.equal((await store.list('basket-quote')).length, 1);
  await page.locator('#quantity').evaluate((element) => {
    element.value = '2';
  });
  await page.evaluate(() => {
    const dialog = globalThis.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = 'Resolve first';
    globalThis.document.body.append(dialog);
  });
  await assert.rejects(capturePreparedLazadaCheckout(app, input), /dialog/u);
  assert.equal((await store.list('basket-quote')).length, 1);
  await page.evaluate(() => {
    globalThis.document.querySelector('[role="dialog"]').remove();
    globalThis.document.body.innerHTML =
      '<h1>Verify you are human</h1><iframe src="about:blank" id="captcha-fixture" title="captcha"></iframe>';
  });
  await assert.rejects(capturePreparedLazadaCheckout(app, input), (error) =>
    Boolean(error.challenge)
  );
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
  await assert.rejects(capturePreparedLazadaCheckout(app, input), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(intercepted, 1);
});

const actionHtml = `<html><head><title>Local checkout action fixture</title></head><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="line" data-item-id="100" data-sku-id="11">
<input id="selected" type="checkbox" checked><input id="quantity" type="number" value="1">
<span id="unit">100.000 ₫</span><span id="subtotal">100.000 ₫</span>
<span id="stock">3</span><span id="available">Còn hàng</span><span id="eligible">Số lượng hợp lệ</span></div>
<input id="voucher-choice" type="checkbox" value="MERCH20">
<input id="payment-choice" type="radio" value="cod" name="payment">
<input id="payment-other" type="radio" value="other" name="payment" checked>
<span id="shipping">20.000 ₫</span><span id="total">120.000 ₫</span>
<span id="voucher-id">MERCH20</span><span id="voucher-amount">0 ₫</span>
<span id="payment">Other payment</span><span id="vouchers">None</span>
<form id="submission"><button id="place-order" type="submit">Place order</button></form>
<script>
globalThis.fixtureEvents = [];
globalThis.fixtureSubmissions = 0;
const quantity = document.querySelector('#quantity');
const voucher = document.querySelector('#voucher-choice');
const payment = document.querySelector('#payment-choice');
const format = value => value.toLocaleString('vi-VN') + ' ₫';
function recalculate() {
  const subtotal = 100000 * Number(quantity.value);
  const discount = voucher.checked ? 20000 : 0;
  document.querySelector('#subtotal').textContent = format(subtotal);
  document.querySelector('#voucher-amount').textContent = format(discount);
  document.querySelector('#total').textContent = format(subtotal + 20000 - discount);
  document.querySelector('#vouchers').textContent = voucher.checked ? 'MERCH20 applied' : 'None';
  document.querySelector('#payment').textContent = payment.checked ? 'Cash on delivery' : 'Other payment';
}
quantity.addEventListener('change', () => {
  quantity.setAttribute('value', quantity.value);
  fixtureEvents.push(['quantity', quantity.value]);
  recalculate();
});
voucher.addEventListener('change', () => {
  fixtureEvents.push(['voucher', voucher.checked]);
  recalculate();
});
payment.addEventListener('change', () => {
  fixtureEvents.push(['payment', payment.checked]);
  recalculate();
});
document.querySelector('#submission').addEventListener('submit', event => {
  event.preventDefault(); fixtureSubmissions += 1;
});
</script></body></html>`;

function actionLayout() {
  const layout = reviewedLayout();
  delete layout.appliedDiscounts[0].amountSign;
  layout.actionBindings = {
    quantityInputs: [
      { offerId: 'offer:100-11', sku: '100_VNAMZ-11', selector: '#quantity' },
    ],
    vouchers: [
      {
        id: 'MERCH20',
        selector: '#voucher-choice',
        identityAttribute: 'value',
        identityValue: 'MERCH20',
      },
    ],
    payments: [
      {
        text: 'Cash on delivery',
        selector: '#payment-choice',
        identityAttribute: 'value',
        identityValue: 'cod',
      },
    ],
  };
  return layout;
}

test('actual intercepted Chromium quantity, voucher and payment events produce a reconciled validated original without submitting', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-checkout-actions-e2e-')
  );
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const cache = new EvidenceCache({
    store,
    offline: true,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    browserOptions: { launch: 'engine', persistent: false },
  });
  const app = new LazadaSearch({
    store,
    cache,
    collector,
    offline: true,
    ocr: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const offerId = 'offer:100-11';
  const sku = '100_VNAMZ-11';
  await store.put('product', {
    id: 'product:100-11',
    title: 'Chocolate whey protein',
    category: 'whey',
    selectedVariant: [{ text: 'Chocolate' }],
    claims: [],
    evidenceIds: [],
    url: 'https://www.lazada.vn/products/pdp-i100-s11.html',
  });
  await store.put('offer', {
    id: offerId,
    productId: 'product:100-11',
    sku,
    currency: 'VND',
    price: 100000,
    url: 'https://www.lazada.vn/products/pdp-i100-s11.html',
    available: true,
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  });
  const plan = await planCheckoutScenarios(app, {
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
    lines: [{ offerId, sku, quantities: [2] }],
    voucherSelections: [{ text: 'MERCH20 applied', voucherIds: ['MERCH20'] }],
    paymentMethods: ['Cash on delivery'],
  });
  await collector.start();
  const page = collector.runtime.page;
  let requests = 0;
  await page.route('**/*', (route) => {
    requests += 1;
    if (
      route.request().isNavigationRequest() &&
      route.request().url() === checkoutUrl
    ) {
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: actionHtml,
      });
    }
    return route.abort();
  });
  await page.goto(checkoutUrl);
  // Only scheduling time is virtual; input events, blur, browser DOM, frame
  // animation, original serialization and source reconciliation remain real.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const wait = page.waitForTimeout.bind(page);
  page.waitForTimeout = async (ms) => {
    t.mock.timers.tick(ms);
    await wait(5);
  };
  const mutations = [];
  const put = store.put.bind(store);
  store.put = async (kind, record) => {
    if (kind === 'checkout-action-clock') {
      mutations.push(Date.parse(record.observedAt));
    }
    return put(kind, record);
  };
  const startedAt = Date.now();
  const result = await runPreparedLazadaCheckoutScenarios(app, {
    planId: plan.plan.id,
    maxScenarios: 1,
    layout: actionLayout(),
    allowCartChanges: true,
  });
  assert.equal(result.results[0].preparation.cartMutations, 3);
  assert.equal(result.results[0].capture.results[0].status, 'validated');
  assert.equal(result.purchases, 0);
  assert.equal(page.url(), checkoutUrl);
  assert.equal(requests, 1);
  assert.ok(mutations[0] - startedAt >= 60000);
  assert.ok(mutations[1] - mutations[0] >= 60000);
  assert.ok(mutations[2] - mutations[1] >= 60000);
  assert.deepEqual(await page.evaluate(() => globalThis.fixtureEvents), [
    ['quantity', '2'],
    ['voucher', true],
    ['payment', true],
  ]);
  assert.equal(await page.evaluate(() => globalThis.fixtureSubmissions), 0);
  const quote = await store.get(
    'basket-quote',
    result.results[0].capture.results[0].quoteId
  );
  assert.equal(quote.lines[0].quantity, 2);
  assert.equal(quote.merchandiseSubtotal, 200000);
  assert.equal(quote.shipping, 20000);
  assert.equal(quote.discount, 20000);
  assert.equal(quote.total, 200000);
  const originalEvidence = await store.get('evidence', quote.evidenceId);
  const originalBytes = await store.blob(originalEvidence.html.sha256);
  assert.match(originalBytes.toString(), /id="quantity"[^>]*value="2"/u);
  assert.equal(originalEvidence.visibility, 'private');
});
