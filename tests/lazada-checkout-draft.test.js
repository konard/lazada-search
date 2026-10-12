import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import {
  discoverLazadaCheckoutSnapshot,
  importLazadaCheckoutSnapshot,
  lazadaCheckoutAdapterStatus,
} from '../src/lazada-checkout-adapter.js';
import { capturePreparedLazadaCheckout } from '../src/lazada-checkout-capture.js';

const original = `<html><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="line" data-item-id="100" data-sku-id="11" data-row-key="cart-100">
<input id="selected" type="checkbox" checked>
<input id="quantity" type="number" value="2">
<span id="unit">100.000 ₫</span><span id="subtotal">200.000 ₫</span>
<span id="stock">3</span><span id="available">Còn hàng</span><span id="eligible">Số lượng hợp lệ</span>
</div>
<span id="shipping">20.000 ₫</span><span id="total">200.000 ₫</span>
<span id="voucher-id">MERCH20</span><span id="voucher-amount">-20.000 ₫</span>
<span id="payment">Cash on delivery</span><span id="vouchers">MERCH20 applied</span>
<script id="state" type="application/json">{"rows":[{"key":"cart-100","itemId":"100","skuId":"11","quantity":2,"stock":3,"available":true,"allowedQuantity":2}]}</script>
</body></html>`;

function source(html = original) {
  return {
    sourceUrl: 'https://cart.lazada.vn/cart',
    sourceSha256: sha256(html),
    evidenceId: `checkout-fixture:${sha256(html)}`,
    observedAt: new Date(Date.now() - 1000).toISOString(),
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
  };
}

function layout() {
  return {
    id: 'reviewed-original-test-layout',
    reviewed: true,
    reviewedBy: 'Draft reviewer',
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

const offer = {
  id: 'offer:100-11',
  productId: 'product:100-11',
  sku: '100_VNAMZ-11',
  url: 'https://www.lazada.vn/products/pdp-i100-s11.html',
  currency: 'VND',
  price: 100000,
  available: true,
  variantConfirmed: true,
  observedAt: '2026-10-10T00:00:00.000Z',
};

test('draft checkout extracts original attribute identities and reconciles signed discounts without HTML rewriting', () => {
  const before = original;
  const result = discoverLazadaCheckoutSnapshot(original, source(), {
    layout: layout(),
    offers: [offer],
  });
  assert.equal(result.status, 'mapping-ready');
  assert.equal(result.quote.lines[0].sku, '100_VNAMZ-11');
  assert.equal(result.quote.lines[0].quantity, 2);
  assert.equal(result.quote.merchandiseSubtotal, 200000);
  assert.equal(result.quote.shipping, 20000);
  assert.equal(result.quote.discount, 20000);
  assert.equal(result.quote.total, 200000);
  assert.equal(original, before);
  assert.equal(result.checkoutLayoutLiveVerified, false);
  assert.equal(result.purchaseReady, false);
});

test('draft checkout original selected JSON row supplies exact item/SKU, quantity and stock without visible SKU text', () => {
  const mapped = layout();
  mapped.lines[0].identityBinding = {
    kind: 'embedded-json',
    rowSelector: '#line',
    scriptSelector: '#state',
    rowsPointer: '/rows',
    rowIndex: 0,
    itemIdPointer: '/itemId',
    skuIdPointer: '/skuId',
    rowKeyPointer: '/key',
    rowKeyAttribute: 'data-row-key',
    selection: { selector: '#selected', attribute: 'checked' },
  };
  mapped.lines[0].quantityBinding = {
    kind: 'embedded-json',
    pointer: '/quantity',
  };
  mapped.lines[0].stockBinding = { kind: 'embedded-json', pointer: '/stock' };
  mapped.lines[0].availabilityBinding = {
    kind: 'embedded-json',
    pointer: '/available',
  };
  mapped.lines[0].eligibilityBinding = {
    kind: 'embedded-json',
    pointer: '/allowedQuantity',
  };
  const result = discoverLazadaCheckoutSnapshot(original, source(), {
    layout: mapped,
    offers: [offer],
  });
  assert.equal(result.quote.lines[0].quantity, 2);
  assert.equal(result.quote.lines[0].sourceIdentity.kind, 'embedded-json');
  const wrong = original.replace(
    'data-row-key="cart-100"',
    'data-row-key="cart-other"'
  );
  assert.equal(
    discoverLazadaCheckoutSnapshot(wrong, source(wrong), {
      layout: mapped,
      offers: [offer],
    }).mapping,
    null
  );
});

for (const [name, change] of [
  [
    'wrong exact SKU',
    (html) => html.replace('data-sku-id="11"', 'data-sku-id="12"'),
  ],
  [
    'unselected source row',
    (html) => html.replace('type="checkbox" checked', 'type="checkbox"'),
  ],
  [
    'hidden source price',
    (html) => html.replace('id="unit"', 'id="unit" hidden'),
  ],
  [
    'wrong total',
    (html) => html.replace('id="total">200.000', 'id="total">199.000'),
  ],
  [
    'insufficient exact stock',
    (html) => html.replace('id="stock">3', 'id="stock">1'),
  ],
  [
    'unresolved dialog',
    (html) =>
      html.replace('<body>', '<body><div role="dialog">Confirm first</div>'),
  ],
  [
    'visible challenge',
    (html) =>
      html.replace(
        '<body>',
        '<body><div data-captcha>Verify to continue</div>'
      ),
  ],
]) {
  test(`draft checkout withholds an accepted mapping for ${name}`, () => {
    const html = change(original);
    const result = discoverLazadaCheckoutSnapshot(html, source(html), {
      layout: layout(),
      offers: [offer],
    });
    assert.equal(result.mapping, null);
    assert.ok(result.gaps.length > 0);
  });
}

test('draft checkout rejects wrong original SHA and persists/replays private source gaps with invalidation', async (t) => {
  assert.throws(
    () =>
      discoverLazadaCheckoutSnapshot(original, {
        ...source(),
        sourceSha256: '0'.repeat(64),
      }),
    /digest/u
  );
  const directory = await mkdtemp(join(tmpdir(), 'lazada-checkout-draft-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  await store.put('offer', offer);
  const app = { store };
  const metadata = source();
  const imported = await importLazadaCheckoutSnapshot(app, {
    html: original,
    metadata,
    layout: layout(),
  });
  assert.ok(imported.quoteId);
  assert.equal(
    (await store.get('evidence', metadata.evidenceId)).visibility,
    'private'
  );
  assert.equal(
    (await lazadaCheckoutAdapterStatus(app, { observationId: imported.id }))
      .counts.mappingReady,
    1
  );
  await store.put('invalidation', {
    id: metadata.sourceUrl,
    url: metadata.sourceUrl,
    invalidatedAt: new Date().toISOString(),
  });
  const checked = await lazadaCheckoutAdapterStatus(app, {
    observationId: imported.id,
  });
  assert.equal(checked.counts.mappingReady, 0);
  assert.equal(checked.observations[0].mapping, null);
  assert.equal(checked.observations[0].quote, null);
});

test('draft prepared capture requires private visibility and honours global CAPTCHA before touching browser state', async () => {
  let touched = 0;
  const collector = {
    tail: Promise.resolve(),
    runtime: {
      page: {},
      touch: () => {
        touched += 1;
      },
    },
  };
  await assert.rejects(
    capturePreparedLazadaCheckout({
      collector,
      store: { visibility: 'public' },
    }),
    /private/u
  );
  await assert.rejects(
    capturePreparedLazadaCheckout({
      collector,
      store: { visibility: 'private', get: async () => ({ active: true }) },
    }),
    (error) => error.code === 'COLLECTION_STOPPED'
  );
  assert.equal(touched, 0);
});
