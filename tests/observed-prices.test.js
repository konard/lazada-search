import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOffers } from '../src/index.js';
import { formatComparison } from '../src/telegram.js';

const products = ['cheap', 'expensive', 'missing', 'unconfirmed'].map((id) => ({
  id,
  title: id,
  category: 'whey',
}));
const offers = products.map((product, index) => ({
  id: product.id,
  productId: product.id,
  url: `https://www.lazada.vn/products/pdp-i${index}.html`,
  currency: 'VND',
  observedAt: '2026-10-09T09:00:00Z',
  variantConfirmed: product.id !== 'unconfirmed',
  price:
    product.id === 'missing'
      ? undefined
      : product.id === 'cheap'
        ? 200000
        : 900000,
}));

test('confirmed package prices sort with missing manufacturer specs, mass, protein and freight', () => {
  const report = compareOffers(products, offers, {
    sort: 'totalBeforeDelivery',
    quantity: 10,
    now: Date.parse('2026-10-09T10:00:00Z'),
  });
  assert.deepEqual(
    report.observedPrices.map((row) => row.offer.id),
    ['cheap', 'expensive']
  );
  assert.deepEqual(
    report.observedPrices.map((row) => row.metrics.totalBeforeDelivery),
    [2000000, 9000000]
  );
  assert.equal(report.ranked.length, 0);
  assert.equal(report.unsortable.length, 2);
  assert.equal(report.observedPrices[0].metrics.totalAfterDelivery, null);
  assert.equal(
    report.observedPrices[0].metrics.costPerProteinGramBeforeDelivery,
    null
  );
  const telegram = formatComparison(report);
  assert.match(telegram, /Captured price: cheap/u);
  assert.ok(
    telegram.indexOf('Captured price: cheap') <
      telegram.indexOf('Captured price: expensive')
  );
  assert.match(telegram, /2000000.00 \/ Unknown VND/u);
});

test('unknown freight cannot enter delivered-price sorting; captured timestamps stay unchanged', () => {
  const report = compareOffers(products, offers, {
    sort: 'totalAfterDelivery',
    now: Date.parse('2026-10-09T10:00:00Z'),
  });
  assert.equal(report.observedPrices.length, 0);
  const quotes = offers.map((offer) => ({
    ...offer,
    shipping: 30000,
    shippingQuantity: 1,
  }));
  const delivered = compareOffers(products, quotes, {
    sort: 'totalAfterDelivery',
    now: Date.parse('2026-10-09T10:00:00Z'),
  });
  assert.equal(delivered.observedPrices[0].metrics.totalAfterDelivery, 230000);
  assert.equal(
    delivered.observedPrices[0].offer.observedAt,
    '2026-10-09T09:00:00Z'
  );
  assert.equal(
    compareOffers(products, quotes, {
      sort: 'totalAfterDelivery',
      quantity: 10,
    }).observedPrices.length,
    0
  );
});

test('invalidated price and shipping sources cannot produce sorted confirmed totals', () => {
  const staleSources = offers.map((offer) => ({
    ...offer,
    priceInvalidated: true,
  }));
  assert.equal(
    compareOffers(products, staleSources, { sort: 'totalBeforeDelivery' })
      .observedPrices.length,
    0
  );
  const staleQuotes = offers.map((offer) => ({
    ...offer,
    shipping: 30000,
    shippingInvalidated: true,
  }));
  const report = compareOffers(products, staleQuotes, {
    sort: 'totalAfterDelivery',
  });
  assert.equal(report.observedPrices.length, 0);
  assert.equal(report.comparisons[0].metrics.shippingKnown, false);
});

const iceProduct = {
  id: 'chocolate-carton',
  title: 'Chocolate ice cream carton',
  category: 'chocolate-ice-cream',
  netMassG: 131,
  netVolumeMl: 130,
  packCount: 24,
};
const iceOffer = {
  id: 'chocolate-carton-offer',
  productId: iceProduct.id,
  url: 'https://www.lazada.vn/products/fixture-i9201-s102.html',
  currency: 'VND',
  observedAt: '2026-10-09T09:00:00Z',
  variantConfirmed: true,
  price: 648000,
};

test('Telegram shows both known ice unit prices and order quantities before manufacturer approval', () => {
  const report = compareOffers(
    [iceProduct],
    [
      {
        ...iceOffer,
        shipping: 84000,
        shippingQuantity: 2,
        coldChainConfirmed: true,
      },
    ],
    {
      quantity: 2,
      sort: 'costPerMlAfterDelivery',
      now: Date.parse('2026-10-09T10:00:00Z'),
    }
  );
  assert.equal(report.observedPrices[0].manufacturerVerified, false);
  assert.equal(report.ranked.length, 0);
  const text = formatComparison(report);
  assert.match(text, /Food quantities: 6288\.00 g; 6240\.00 ml/u);
  assert.match(text, /Food g: 206\.11 \/ 219\.47/u);
  assert.match(text, /ml: 207\.69 \/ 221\.15/u);
  assert.match(text, /Manufacturer verification pending/u);
  assert.match(text, /0 eligible offers/u);
  assert.doesNotMatch(text, /Confirmed comparison/u);
});

test('Telegram preserves missing freight and displays known volume even when gram sorting is impossible', () => {
  for (const product of [iceProduct, { ...iceProduct, netMassG: undefined }]) {
    const report = compareOffers([product], [iceOffer], {
      sort: 'costPerGramBeforeDelivery',
      now: Date.parse('2026-10-09T10:00:00Z'),
    });
    const text = formatComparison(report);
    assert.match(text, /3120\.00 ml/u);
    assert.match(text, /ml: 207\.69 \/ Unknown/u);
    assert.match(text, /Unknown shipping/u);
    assert.match(text, /0 eligible offers/u);
    if (product.netMassG) {
      assert.match(text, /Food g: 206\.11 \/ Unknown/u);
    } else {
      assert.equal(report.observedPrices.length, 0);
      assert.match(text, /Pending manufacturer verification/u);
      assert.match(text, /Food quantities: Unknown g/u);
      assert.match(text, /Food g: Unknown \/ Unknown/u);
    }
  }
});
