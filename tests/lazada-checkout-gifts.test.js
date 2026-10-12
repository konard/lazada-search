import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { REQUIRED_SPEC_FIELDS } from '../src/verification.js';
import { calculateOffer } from '../src/compare.js';
import { importLazadaCheckoutSnapshot } from '../src/lazada-checkout-adapter.js';
import {
  discoverLazadaCheckoutFoodGifts,
  importLazadaCheckoutFoodGiftDiscovery,
  acquireLazadaCheckoutFoodGifts,
} from '../src/lazada-checkout-gifts.js';

const offerId = 'paid:100-11';
const sku = '100_VNAMZ-11';
const checkoutUrl = 'https://cart.lazada.vn/cart';
const officialUrl = 'https://www.optimumnutrition.com/synthetic-test-label';
const makerId = 'synthetic-manufacturer-original';
const reviewer = 'Synthetic exact package reviewer';
const counts = {
  orderQuantity: 2,
  minOrderQuantity: 2,
  maxOrderQuantity: 5,
  units: 1,
  stockUnits: 4,
  maxUnitsPerOrder: 1,
};
const excerpts = {
  identity: 'Optimum Nutrition Chocolate Isolate CHOC-1000 CURRENT-V1 VN bag',
  netMassG: 'Net weight: 1000 g',
  packCount: 'One package: 1 bag',
  proteinPer100g: 'Per 100 g Protein: 80 g',
  sugarPer100g: 'Per 100 g Sugar: 0 g',
  fatPer100g: 'Per 100 g Fat: 1 g',
  saturatedFatPer100g: 'Per 100 g Saturated Fat: 0 g',
  kcalPer100g: 'Per 100 g Energy: 400 kcal',
  ingredients: 'Ingredients: whey protein isolate, cocoa',
};

function rowIdentity(kind = 'attributes') {
  const common = {
    kind,
    rowSelector: '#paid-row',
    selection: { selector: '#selected', attribute: 'checked' },
  };
  return kind === 'attributes'
    ? {
        ...common,
        itemId: { selector: '#paid-row', attribute: 'data-item-id' },
        skuId: { selector: '#paid-row', attribute: 'data-sku-id' },
      }
    : {
        ...common,
        scriptSelector: '#state',
        rowsPointer: '/rows',
        rowIndex: 0,
        itemIdPointer: '/itemId',
        skuIdPointer: '/skuId',
        rowKeyPointer: '/key',
        rowKeyAttribute: 'data-row-key',
      };
}

function checkoutHtml(
  giftText = 'Buy 2 bags get 1 bag free chocolate whey protein'
) {
  const state = {
    rows: [{ key: 'selected-100', itemId: '100', skuId: '11', gift: counts }],
  };
  return `<html><head><title>Synthetic original checkout</title></head><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="paid-row" data-item-id="100" data-sku-id="11" data-row-key="selected-100">
<input id="selected" type="checkbox" checked><input id="quantity" type="number" value="2"><span id="other-item" data-item-id="101"></span>
<span id="price">100.000 ₫</span><span id="subtotal">200.000 ₫</span>
<span id="stock">5</span><span id="available">Còn hàng</span><span id="eligible">Số lượng hợp lệ</span>
<div id="gift-text">${giftText}</div><div id="gift-counts">${Object.entries(
    counts
  )
    .map(([field, value]) => `${field}: ${value} units`)
    .join('; ')}</div></div>
<span id="outside-counts">units: 1 units</span>
<span id="shipping">20.000 ₫</span><span id="total">220.000 ₫</span>
<span id="payment">Cash on delivery</span><span id="vouchers">None</span>
<script id="state" type="application/json">${JSON.stringify(state)}</script>
</body></html>`;
}

function reviewedLayout(reviewedAt) {
  return {
    id: 'synthetic-gift-layout',
    reviewed: true,
    reviewedBy: reviewer,
    reviewedAt,
    selectors: {
      destination: '#address',
      shipping: '#shipping',
      total: '#total',
      paymentMethod: '#payment',
      voucherState: '#vouchers',
    },
    lines: [
      {
        offerId,
        sku,
        identityBinding: rowIdentity(),
        quantityBinding: { selector: '#quantity', attribute: 'value' },
        selectors: {
          unitPrice: '#price',
          subtotal: '#subtotal',
          stock: '#stock',
          availability: '#available',
          eligibility: '#eligible',
        },
      },
    ],
    appliedDiscounts: [],
  };
}

function manufacturerProduct(sourceProof) {
  const product = {
    id: 'gift-product',
    brand: 'Optimum Nutrition',
    title: 'Optimum Nutrition Chocolate Isolate 1kg',
    category: 'whey',
    market: 'VN',
    url: 'https://www.lazada.vn/products/pdp-i100.html?skuId=11',
    netMassG: 1000,
    packCount: 1,
    proteinPer100g: 80,
    sugarPer100g: 0,
    fatPer100g: 1,
    saturatedFatPer100g: 0,
    kcalPer100g: 400,
    ingredients: ['whey protein isolate', 'cocoa'],
    evidenceIds: [makerId],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      identityMethod: 'visual-exact-variant',
      evidenceId: makerId,
      sourceUrl: officialUrl,
      checkedAt: sourceProof.reviewedAt,
      reviewId: 'synthetic-exact-review',
    },
  };
  product.claims = [...REQUIRED_SPEC_FIELDS, 'packCount'].map((field) => ({
    field,
    value: product[field],
    evidenceId: makerId,
    sourceEvidenceId: makerId,
    source: 'manufacturer',
    requiresReview: false,
    excerpt: excerpts[field],
    reviewedBy: reviewer,
    reviewedAt: sourceProof.reviewedAt,
    reviewId: 'synthetic-exact-review',
  }));
  return product;
}

function reviewedComponent(record, kind) {
  const { product, sourceProof, checkout, componentId } = record;
  const identity = {
    brand: product.brand,
    name: 'Chocolate Isolate',
    flavour: 'chocolate',
    market: 'VN',
    packageType: 'bag',
    formulaRevision: 'CURRENT-V1',
    variantCode: 'CHOC-1000',
    netMassG: 1000,
    innerPackCount: 1,
    currentFormula: true,
  };
  const fact = (value, unit, basis, excerpt, valueExcerpt, extra = {}) => ({
    ...sourceProof,
    value,
    unit,
    basis,
    excerpt,
    valueExcerpt,
    ...extra,
  });
  return {
    id: componentId,
    kind: 'bonus-food',
    product,
    identity,
    sourceIdentity: { ...identity },
    evidenceIds: [makerId, checkout.source.evidenceId],
    review: {
      ...sourceProof,
      identityMatched: true,
      excerpt: excerpts.identity,
    },
    facts: {
      netMassG: fact(
        1000,
        'g',
        'one-inner-food-package',
        excerpts.netMassG,
        '1000 g'
      ),
      proteinPer100g: fact(
        80,
        'g/100g',
        'per-100g',
        excerpts.proteinPer100g,
        '80 g',
        { basisExcerpt: 'Per 100 g' }
      ),
    },
    eligibility: {
      allocationId: 'physical-gift-once',
      offerId,
      sku,
      ...counts,
      confirmed: true,
      available: true,
      conditionsComplete: true,
      conditionsSatisfied: true,
      observedAt: checkout.source.observedAt,
      claims: Object.fromEntries(
        Object.entries(counts).map(([field, value]) => {
          const json = kind === 'embedded-json';
          const excerpt = json
            ? `"${field}":${value}`
            : `${field}: ${value} units`;
          return [
            field,
            {
              sourceUrl: checkoutUrl,
              sourceSha256: checkout.source.sourceSha256,
              evidenceId: checkout.source.evidenceId,
              reviewedBy: reviewer,
              reviewedAt: sourceProof.reviewedAt,
              value,
              unit: 'count',
              basis: [
                'orderQuantity',
                'minOrderQuantity',
                'maxOrderQuantity',
              ].includes(field)
                ? 'paid-selling-unit'
                : 'inner-food-package',
              excerpt,
              valueExcerpt: json ? String(value) : `${value} units`,
              checkoutIdentityBinding: rowIdentity(kind),
              ...(json
                ? { checkoutValuePointer: `/gift/${field}` }
                : { checkoutContextSelector: '#gift-counts' }),
            },
          ];
        })
      ),
    },
  };
}

async function fixture(t, giftText) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-gift-source-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const app = { store };
  const observedAt = new Date(Date.now() - 10000).toISOString();
  const reviewedAt = new Date(Date.now() - 1000).toISOString();
  const makerHtml = `<html><body>${Object.values(excerpts)
    .map((text) => `<p>${text}</p>`)
    .join('')}</body></html>`;
  const makerBlob = await store.putBlob(makerHtml);
  await store.put('evidence', {
    id: makerId,
    url: officialUrl,
    role: 'manufacturer-supplied-by-operator',
    html: makerBlob,
    observedAt,
  });
  const sourceProof = {
    sourceUrl: officialUrl,
    sourceSha256: makerBlob.sha256,
    evidenceId: makerId,
    reviewedBy: reviewer,
    reviewedAt,
  };
  const product = manufacturerProduct(sourceProof);
  const paidProduct = { ...product, id: 'paid-product' };
  await store.put('product', product);
  await store.put('product', paidProduct);
  const offer = {
    id: offerId,
    productId: paidProduct.id,
    sku,
    url: paidProduct.url,
    market: 'VN',
    currency: 'VND',
    price: 100000,
    available: true,
    variantConfirmed: true,
    observedAt,
  };
  await store.put('offer', offer);
  const html = checkoutHtml(giftText);
  const checkout = await importLazadaCheckoutSnapshot(app, {
    html,
    layout: reviewedLayout(reviewedAt),
    metadata: {
      sourceUrl: checkoutUrl,
      sourceSha256: sha256(html),
      evidenceId: 'synthetic-checkout-original',
      observedAt,
      market: 'vn',
      currency: 'VND',
      deliveryArea: 'Nha Trang',
    },
  });
  assert.equal(checkout.status, 'mapping-ready');
  const discovery = discoverLazadaCheckoutFoodGifts(html, checkout.mapping, {
    giftMappings: [{ offerId, sku, selector: '#gift-text' }],
    products: [paidProduct],
    offers: [offer],
  });
  const componentId = discovery[0].components[0].id;
  const record = {
    app,
    store,
    product,
    paidProduct,
    offer,
    checkout,
    html,
    discovery,
    componentId,
    sourceProof,
  };
  const component = reviewedComponent(record, 'attributes');
  await store.put('manufacturer-review', {
    id: 'synthetic-exact-review',
    productId: product.id,
    evidenceId: makerId,
    identityMatched: true,
    identityMethod: 'visual-exact-variant',
    sourceAuthority: 'manufacturer',
    manufacturerUrl: officialUrl,
    reviewedBy: reviewer,
    checkedAt: reviewedAt,
    identity: { manufacturer: { ...component.identity, packCount: 1 } },
  });
  return record;
}

async function acquire(record, component) {
  return acquireLazadaCheckoutFoodGifts(record.app, {
    observationId: record.checkout.id,
    offerId,
    components: [component],
    reviewedBy: reviewer,
  });
}

for (const kind of ['attributes', 'embedded-json']) {
  test(`Lazada gift discovery/import/acquisition confirms exact ${kind} counts once and changes only proved denominators`, async (t) => {
    const record = await fixture(t);
    assert.equal(record.discovery[0].factualApprovalGranted, false);
    assert.equal(record.discovery[0].status, 'potential');
    const input = {
      observationId: record.checkout.id,
      giftMappings: [{ offerId, sku, selector: '#gift-text' }],
    };
    await importLazadaCheckoutFoodGiftDiscovery(record.app, input);
    await importLazadaCheckoutFoodGiftDiscovery(record.app, input);
    assert.equal(
      (await record.store.get('offer', offerId)).foodComponents.length,
      1
    );
    const component = reviewedComponent(record, kind);
    const result = await acquire(record, component);
    assert.equal(result.confirmed, 1, JSON.stringify(result.observations));
    assert.equal(result.potential, 0);
    assert.equal(result.visibility, 'private');
    const storedOffer = await record.store.get('offer', offerId);
    const comparison = calculateOffer(record.paidProduct, storedOffer, {
      quantity: 2,
      requireShipping: false,
      market: 'vn',
    });
    assert.equal(comparison.metrics.totalMassG, 3000);
    assert.equal(comparison.metrics.totalProteinG, 2400);
    assert.equal(comparison.metrics.costPerGramBeforeDelivery, 200000 / 3000);
    assert.equal(comparison.metrics.totalVolumeMl, null);
    await importLazadaCheckoutFoodGiftDiscovery(record.app, input);
    assert.equal(
      (await record.store.get('offer', offerId)).foodComponents[0].status,
      'confirmed'
    );
    await acquire(record, component);
    assert.equal(
      (await record.store.get('offer', offerId)).foodComponents.length,
      1
    );
  });
}

for (const [name, mutate] of [
  [
    'different selected item',
    (component) => {
      component.eligibility.claims.units.checkoutIdentityBinding.itemId.selector =
        '#other-item';
    },
  ],
  [
    'another source row excerpt',
    (component) => {
      component.eligibility.claims.units.checkoutContextSelector =
        '#outside-counts';
    },
  ],
  [
    'original JSON value disagreement',
    (component, record) => {
      component.eligibility.claims.units = reviewedComponent(
        record,
        'embedded-json'
      ).eligibility.claims.units;
      component.eligibility.claims.units.checkoutValuePointer =
        '/gift/stockUnits';
    },
  ],
  [
    'unattached original digest',
    (component) => {
      component.eligibility.claims.units.sourceSha256 = '0'.repeat(64);
    },
  ],
]) {
  test(`Lazada gift acquisition withholds the bonus for ${name}`, async (t) => {
    const record = await fixture(t);
    const component = reviewedComponent(record, 'attributes');
    mutate(component, record);
    const result =
      name === 'unattached original digest'
        ? await assert.rejects(
            acquire(record, component),
            /exact original checkout/u
          )
        : await acquire(record, component);
    if (result) {
      assert.equal(result.confirmed, 0);
      assert.equal(result.potential, 1);
      assert.ok(result.observations[0].evidenceValidation.reasons.length);
    }
    const comparison = calculateOffer(
      record.paidProduct,
      await record.store.get('offer', offerId),
      { quantity: 2, requireShipping: false, market: 'vn' }
    );
    assert.equal(comparison.metrics.totalMassG, 2000);
    assert.equal(comparison.metrics.costPerGramBeforeDelivery, 100);
  });
}

test('Lazada gift source invalidation and non-food accessories cannot enter confirmed food quantities', async (t) => {
  const record = await fixture(t, 'Free Shaker');
  assert.equal(record.discovery[0].components[0].kind, 'non-food');
  await assert.rejects(
    acquire(record, {
      ...reviewedComponent(record, 'attributes'),
      kind: 'non-food',
    }),
    /accessories/u
  );
  await record.store.put('invalidation', {
    id: 'withdraw-checkout',
    evidenceIds: [record.checkout.source.evidenceId],
    invalidatedAt: new Date().toISOString(),
  });
  await assert.rejects(
    importLazadaCheckoutFoodGiftDiscovery(record.app, {
      observationId: record.checkout.id,
      giftMappings: [{ offerId, sku, selector: '#gift-text' }],
    }),
    /non-invalidated/u
  );
});
