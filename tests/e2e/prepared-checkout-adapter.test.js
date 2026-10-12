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
