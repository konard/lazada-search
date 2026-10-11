import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  LazadaSearch,
  extractBasketQuote,
  basketIdentity,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

const html = await readFile(
  new URL('./fixtures/basket-quote.html', import.meta.url)
);
const mapping = () => ({
  market: 'vn',
  currency: 'VND',
  deliveryArea: 'Nha Trang',
  destination: 'Khánh Hòa, Phường Nha Trang',
  sourceUrl: 'https://cart.lazada.vn/cart',
  sourceSha256: sha256(html),
  observedAt: new Date().toISOString(),
  evidenceId: 'fixture-checkout-source',
  mappingReviewedBy: 'fixture-reviewer',
  selectors: {
    destination: '#destination',
    shipping: '#shipping',
    total: '#total',
    coldChain: '#cold-chain',
  },
  coldChainText: 'Frozen delivery supported',
  lines: [
    {
      offerId: 'offer-a',
      sku: '100_VNAMZ-11',
      quantity: 3,
      selectors: {
        sku: '#line-a .sku',
        quantity: '#line-a .quantity',
        unitPrice: '#line-a .unit-price',
        subtotal: '#line-a .subtotal',
      },
    },
  ],
  appliedDiscounts: [
    {
      id: 'merchandise-20k',
      scope: 'merchandise',
      selector: '#merchandise-voucher',
    },
    { id: 'shipping-5k', scope: 'shipping', selector: '#shipping-voucher' },
  ],
});

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-basket-'));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    flavourScope: 'chocolate-or-unflavoured',
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const input = mapping();
  await store.put('evidence', {
    id: input.evidenceId,
    sourceUrl: input.sourceUrl,
    observedAt: input.observedAt,
    html: await store.putBlob(html),
    role: 'checkout',
  });
  await store.put('product', {
    id: 'product-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    title: 'Fixture whey chocolate 1kg',
    category: 'whey',
    sku: '100_VNAMZ-11',
    netMassG: 1000,
    proteinPer100g: 80,
    packCount: 1,
    selectedVariant: [{ text: 'Chocolate' }],
  });
  await store.put('offer', {
    id: 'offer-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    productId: 'product-a',
    sku: '100_VNAMZ-11',
    currency: 'VND',
    price: 110000,
    observedAt: input.observedAt,
    variantConfirmed: true,
    available: true,
    stock: 10,
    shipping: 77777,
    shippingQuantity: 1,
    deliveryArea: 'Hồ Chí Minh',
    discount: 999999,
  });
  return { app, store, input };
}

test('checkout lines reconcile fixed shipping and separately applied vouchers once per basket', () => {
  const quote = extractBasketQuote(html, mapping());
  assert.equal(quote.merchandiseSubtotal, 300000);
  assert.equal(quote.shipping, 10000);
  assert.equal(quote.discount, 25000);
  assert.equal(quote.total, 285000);
  assert.equal(quote.coldChainConfirmed, true);
});

test('source extraction rejects wrong identity, quantity, area, digest, duplicate vouchers and unreconciled totals', () => {
  const mutations = [
    (input) => {
      input.sourceSha256 = '0'.repeat(64);
    },
    (input) => {
      input.lines[0].quantity = 2;
    },
    (input) => {
      input.lines[0].sku = '100_VNAMZ-12';
    },
    (input) => {
      input.deliveryArea = 'Hồ Chí Minh';
    },
    (input) => {
      input.selectors.total = '#shipping';
    },
    (input) => {
      input.appliedDiscounts.push(input.appliedDiscounts[0]);
    },
    (input) => {
      input.lines[0].selectors.unitPrice = '.sku';
    },
    (input) => {
      input.sourceUrl = 'https://user:password@cart.lazada.vn/cart';
    },
    (input) => {
      input.sourceUrl = 'ftp://cart.lazada.vn/cart';
    },
  ];
  for (const mutate of mutations) {
    const input = mapping();
    mutate(input);
    assert.throws(() => extractBasketQuote(html, input));
  }
});

test('basket identity is order-independent but exact quantities and SKU choices cannot share freight', () => {
  const a = { offerId: 'a', sku: '100_VNAMZ-11', quantity: 3 };
  const b = { offerId: 'b', sku: '200_VNAMZ-21', quantity: 2 };
  assert.equal(basketIdentity([a, b]), basketIdentity([b, a]));
  assert.notEqual(basketIdentity([a]), basketIdentity([{ ...a, quantity: 4 }]));
  assert.throws(() => basketIdentity([a, a]), /Repeated/u);
});

test('discount scope cannot transfer excess freight savings to food and distinct IDs cannot count one DOM voucher twice', () => {
  const original = html.toString();
  for (const [oldValue, newValue] of [
    ['20.000 ₫', '305.000 ₫'],
    ['5.000 ₫', '15.000 ₫'],
  ]) {
    const changed = Buffer.from(original.replace(oldValue, newValue));
    assert.throws(
      () =>
        extractBasketQuote(changed, {
          ...mapping(),
          sourceSha256: sha256(changed),
        }),
      /discounts exceed/u
    );
  }
  const input = mapping();
  input.appliedDiscounts.push({
    ...input.appliedDiscounts[0],
    id: 'renamed-same-voucher',
  });
  assert.throws(() => extractBasketQuote(html, input), /same applied voucher/u);
  const hidden = Buffer.from(
    original.replace('id="total"', 'id="total" style="display: none"')
  );
  assert.throws(
    () =>
      extractBasketQuote(hidden, {
        ...mapping(),
        sourceSha256: sha256(hidden),
      }),
    /Hidden/u
  );
});

test('basket comparisons apply original availability receipts and unresolved specification holds', async (t) => {
  const { app, store, input } = await setup(t);
  const offer = await store.get('offer', 'offer-a');
  const url = 'https://www.lazada.vn/products/pdp-i100.html';
  await store.put('offer', { ...offer, url });
  await app.saveBasketQuote(input);
  await store.put('listing-availability', {
    id: 'removed',
    url,
    status: 'unavailable',
    verification: 'original-html-confirmed',
    html: { sha256: 'a'.repeat(64) },
    observedAt: new Date(Date.parse(input.observedAt) + 1).toISOString(),
  });
  assert.ok(
    (
      await app.compareBaskets({ requireManufacturer: false })
    ).excluded[0].problems.includes('Unavailable')
  );
  await store.put('listing-availability', {
    id: 'removed',
    url,
    status: 'available',
  });
  const product = await store.get('product', 'product-a');
  await store.put('product', {
    ...product,
    pendingSpecificationReview: ['netMassG'],
  });
  const result = await app.compareBaskets({ requireManufacturer: false });
  assert.equal(result.ranked.length, 0);
  assert.equal(result.excluded[0].metrics.totalMassG, null);
  assert.ok(
    result.excluded[0].problems.some((message) => message.includes('netMassG'))
  );
});

test('captured basket prices override a product-page estimate without mutating the original offer', async (t) => {
  const { app, store, input } = await setup(t);
  const before = await store.get('offer', 'offer-a');
  await app.saveBasketQuote(input);
  const result = await app.compareBaskets({
    requireManufacturer: false,
    minMassG: 3000,
  });
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].metrics.totalMassG, 3000);
  assert.equal(result.ranked[0].metrics.totalProteinG, 2400);
  assert.equal(result.ranked[0].metrics.totalBeforeDelivery, 280000);
  assert.equal(result.ranked[0].metrics.totalAfterDelivery, 285000);
  assert.equal(result.ranked[0].metrics.costPerGramAfterDelivery, 95);
  const pricedLine = result.ranked[0].lines[0];
  assert.equal(pricedLine.offer.evidenceId, input.evidenceId);
  assert.equal(pricedLine.offer.priceScope, 'exact-checkout-line');
  assert.equal(pricedLine.offer.observedAt, input.observedAt);
  assert.equal(pricedLine.offer.shipping, undefined);
  assert.equal(pricedLine.offer.shippingQuantity, undefined);
  assert.equal(pricedLine.offer.shippingDestination, input.destination);
  assert.equal(
    result.ranked[0].metrics.costPerProteinGramAfterDelivery,
    118.75
  );
  assert.deepEqual(await store.get('offer', 'offer-a'), before);
  assert.equal(
    (await app.compareBaskets({ requireManufacturer: false, minMassG: 3001 }))
      .ranked.length,
    0
  );
  assert.equal(
    (
      await app.compareBaskets({
        requireManufacturer: false,
        now: Date.parse(input.observedAt) + 86400001,
        allowStale: 'false',
      })
    ).ranked.length,
    0
  );
});

test('source tampering or invalidation removes a quoted basket from rankings without a request', async (t) => {
  const { app, store, input } = await setup(t);
  const quote = await app.saveBasketQuote(input);
  await store.put('basket-quote', { ...quote, shipping: 0 });
  assert.match(
    (await app.compareBaskets({ requireManufacturer: false })).excluded[0]
      .problems[0],
    /original source/u
  );
  await store.put('basket-quote', quote);
  await app.cache.invalidate(input.sourceUrl, {
    reason: 'incorrect checkout source',
  });
  assert.equal(
    (await app.compareBaskets({ requireManufacturer: false })).ranked.length,
    0
  );
  assert.equal(app.cache.stats.downloads, 0);
});

test('stock, stale quotes, factory verification and frozen delivery remain acceptance gates', async (t) => {
  const { app, store, input } = await setup(t);
  await app.saveBasketQuote(input);
  assert.equal((await app.compareBaskets()).ranked.length, 0);
  const offer = await store.get('offer', 'offer-a');
  await store.put('offer', { ...offer, stock: 2 });
  assert.ok(
    (
      await app.compareBaskets({ requireManufacturer: false })
    ).excluded[0].problems.includes('Quantity exceeds available offer')
  );
  await store.put('offer', offer);
  assert.equal(
    (
      await app.compareBaskets({
        requireManufacturer: false,
        now: Date.parse(input.observedAt) + 86400001,
      })
    ).ranked.length,
    0
  );
  for (const text of [
    'Frozen delivery not supported',
    'No frozen delivery',
    'Without cold chain',
    'Frozen delivery isn’t available',
    "Frozen delivery can't be confirmed",
    'Frozen delivery',
    'Không hỗ trợ giao hàng đông lạnh',
  ]) {
    const negativeHtml = Buffer.from(
      html.toString().replace('Frozen delivery supported', text)
    );
    assert.equal(
      extractBasketQuote(negativeHtml, {
        ...input,
        sourceSha256: sha256(negativeHtml),
        coldChainText: text,
      }).coldChainConfirmed,
      false
    );
  }
});
