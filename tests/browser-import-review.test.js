import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHTML } from 'linkedom';
import {
  AssociativeStore,
  LazadaSearch,
  specificationProblems,
  calculateOffer,
  extractPage,
  classifyPage,
} from '../src/index.js';

const observedAt = '2026-10-09T17:00:00Z';
const html = (
  sku = '11',
  price = '728.000',
  destination = 'Khánh Hòa, Phường Nha Trang'
) =>
  `<html><head><title>MusaKing whey</title></head><body><h1>MusaKing whey 500g chocolate</h1><div data-product-price>${price} ₫</div><div data-seller>Seller</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-${sku}</span></div><div class="delivery-v2"><span class="location-v2__address">${destination}</span>Giao tiêu chuẩn, phí vận chuyển 51.100 ₫</div><script>const redirectText='chỉ có trên ứng dụng di động Lazada'; const fake='Protein 100g Fat 100g';</script></body></html>`;

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-browser-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  app.collector.start = () => {
    throw Error('Import must not start a browser');
  };
  return { store, app };
}

test('browser DOM imports preserve SKU identities, source URLs and original times without requests', async (t) => {
  const { app, store } = await setup(t);
  const one = await app.importCapture({
    url: 'https://www.lazada.vn/products/musa-i100-s11.html',
    html: html(),
    observedAt,
  });
  const two = await app.importCapture({
    url: 'https://www.lazada.vn/products/renamed-i100-s12.html',
    html: html('12', '768.000'),
    observedAt,
  });
  assert.notEqual(one.product.id, two.product.id);
  assert.equal(one.product.url, two.product.url);
  assert.equal(one.offer.price, 728000);
  assert.equal(two.offer.price, 768000);
  assert.equal(two.offer.observedAt, observedAt.replace('Z', '.000Z'));
  assert.equal(two.product.proteinPer100g, undefined);
  assert.equal(
    (await store.get('evidence', one.offer.evidenceId)).sourceUrl,
    'https://www.lazada.vn/products/musa-i100-s11.html'
  );
  assert.equal(app.cache.stats.downloads, 0);
});

test('a SKU URL that renders a mismatched default SKU is rejected', async (t) => {
  const { app } = await setup(t);
  await assert.rejects(
    app.importCapture({
      url: 'https://www.lazada.vn/products/musa-i100-s12.html',
      html: html(),
      observedAt,
    }),
    /requested SKU/u
  );
  await assert.rejects(
    app.importCapture({
      url: 'https://www.lazada.vn/products/musa-i100-s11.html',
      html: '<html>[Truncated]',
      observedAt,
    }),
    /incomplete/u
  );
});

test('a Nha Trang estimate is retained only for one package and never multiplied for bulk freight', async (t) => {
  const { app } = await setup(t);
  const result = await app.importCapture({
    url: 'https://www.lazada.vn/products/musa-i100-s11.html',
    html: html(),
    observedAt,
  });
  assert.equal(result.offer.shipping, 51100);
  assert.equal(result.offer.shippingQuantity, 1);
  assert.equal(result.offer.quoteObservedAt, observedAt.replace('Z', '.000Z'));
  assert.equal(
    calculateOffer(result.product, result.offer, { quantity: 10 }).metrics
      .totalAfterDelivery,
    null
  );
  const other = await app.importCapture({
    url: 'https://www.lazada.vn/products/musa-i100-s12.html',
    html: html('12', '768.000', 'Thành phố Hồ Chí Minh, Phường Bến Thành'),
    observedAt,
  });
  assert.equal(other.offer.shipping, undefined);
});

async function reviewedFixture(t) {
  const { app, store } = await setup(t);
  const { product } = await app.importCapture({
    url: 'https://www.lazada.vn/products/musa-i100-s11.html',
    html: html(),
    observedAt,
  });
  const official = 'official-page';
  const imageUrl = 'https://cdn.hstatic.net/official-chocolate-label.jpg';
  const blob = await store.putBlob(Buffer.from('test image evidence'));
  await store.put('cache', {
    id: 'manufacturer:https://musaking.com/products/whey-isolate',
    url: 'https://musaking.com/products/whey-isolate',
    snapshot: { productImages: [imageUrl] },
  });
  await store.put('cache', { id: `image:${imageUrl}`, blob });
  await store.put('evidence', {
    id: 'official-image',
    role: 'ocr',
    url: imageUrl,
    image: blob,
  });
  await store.put('evidence', {
    id: official,
    role: 'manufacturer-supplied-by-operator',
    url: 'https://musaking.com/products/whey-isolate',
    extracted: { evidenceIds: [] },
  });
  product.evidenceIds.push(official);
  product.crossChecks = [
    {
      evidenceId: official,
      sourceAuthority: 'manufacturer',
      manufacturerUrl: 'https://musaking.com/products/whey-isolate',
    },
  ];
  await store.put('product', product);
  const identity = {
    brand: 'MusaKing',
    name: 'Isolate Whey Protein Blend',
    flavour: 'Chocolate',
    netMassG: 500,
    packCount: 1,
  };
  const values = {
    netMassG: 500,
    packCount: 1,
    proteinPer100g: (25 / 35) * 100,
    sugarPer100g: (1 / 35) * 100,
    fatPer100g: (0.9 / 35) * 100,
    saturatedFatPer100g: (0.5 / 35) * 100,
    kcalPer100g: (125 / 35) * 100,
    ingredients: ['whey protein isolate', 'whey protein concentrate', 'cocoa'],
  };
  const review = {
    evidenceId: official,
    listingEvidenceId: product.evidenceIds[0],
    identity: { listing: identity, manufacturer: identity },
    reviewedBy: 'Test reviewer',
    reason: 'Compared exact brand, chocolate formula and one 500 g package',
    facts: Object.fromEntries(
      Object.entries(values).map(([field, value]) => [
        field,
        {
          value,
          evidenceId: 'official-image',
          excerpt: `Visible official label ${field}`,
        },
      ])
    ),
  };
  return { app, store, product, review };
}

test('exact visual manufacturer review promotes checked image facts, retains evidence and corrects seller data', async (t) => {
  const { app, store, product, review } = await reviewedFixture(t);
  product.proteinPer100g = 99;
  await store.put('product', product);
  const updated = await app.reviewManufacturer(product.id, review);
  assert.deepEqual(specificationProblems(updated), []);
  assert.equal(updated.proteinType, 'blend');
  assert.equal(updated.corrections[0].previous, 99);
  assert.ok(
    updated.claims.find((c) => c.field === 'proteinPer100g').sourceEvidenceId
  );
  assert.ok(
    (
      await store.get('evidence', 'official-page')
    ).extracted.evidenceIds.includes('official-image')
  );
});

for (const field of ['flavour', 'netMassG', 'packCount']) {
  test(`visual matching rejects a different manufacturer ${field}`, async (t) => {
    const { app, product, review } = await reviewedFixture(t);
    review.identity.manufacturer = {
      ...review.identity.manufacturer,
      [field]: field === 'flavour' ? 'Vanilla' : 2,
    };
    await assert.rejects(
      app.reviewManufacturer(product.id, review),
      /identity mismatch/u
    );
  });
}

test('seller images and omitted nutrition facts cannot become verified manufacturer specifications', async (t) => {
  const { app, store, product, review } = await reviewedFixture(t);
  const original = await store.get('evidence', 'official-image');
  await store.put('evidence', {
    ...original,
    url: 'https://img.lazcdn.com/seller-label.jpg',
  });
  await assert.rejects(
    app.reviewManufacturer(product.id, review),
    /not published/u
  );
  await store.put('evidence', original);
  delete review.facts.sugarPer100g;
  const updated = await app.reviewManufacturer(product.id, review);
  assert.ok(
    specificationProblems(updated).includes(
      'Manufacturer specification required: sugarPer100g'
    )
  );
});

test('selected SKU availability ignores hidden application notices and preserves quantity limits', () => {
  const { document } = parseHTML(
    `<html><body><h1>Whey</h1><div data-product-price>728.000 ₫</div><button class="add-to-cart-buy-now-btn">Mua ngay</button><div class="sku-quantity-selection-v2"><input min="1" max="30"></div><script>const hidden='hết hàng';</script></body></html>`
  );
  const page = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i100.html',
  });
  assert.equal(page.available, true);
  assert.equal(page.minQuantity, 1);
  assert.equal(page.maxQuantity, 30);
  assert.ok(!page.rawText.includes('hết hàng'));
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div class="quantity-content-warning">Sản phẩm đã hết hàng</div>'
  );
  assert.equal(extractPage({ document, url: page.url }).available, false);
});

test('manufacturer images retain published flavour variants and the largest observed Shopify rendition', () => {
  const choices = JSON.stringify([
    { image: { full_src: 'https://manufacturer.example/chocolate-5lb.webp' } },
  ]);
  const { document } = parseHTML(
    `<html><body><form data-product_variations='${choices}'></form><img class="product-gallery-grid__image" src="/cdn/shop/files/label.png?v=1&width=400"><img class="product-gallery-grid__image" src="/cdn/shop/files/label.png?v=1&width=1800"><div class="nutritional-info-image"><img src="/nutrition.jpg"></div><script>const text='Performing security verification';</script></body></html>`
  );
  const page = extractPage({
    document,
    url: 'https://manufacturer.example/product',
  });
  assert.deepEqual(page.productImages, [
    'https://manufacturer.example/cdn/shop/files/label.png?v=1&width=1800',
    'https://manufacturer.example/nutrition.jpg',
    'https://manufacturer.example/chocolate-5lb.webp',
  ]);
  assert.equal(classifyPage(page), 'ok');
});

test('quote timestamps must be valid observations', async (t) => {
  const { app } = await setup(t);
  const { offer } = await app.importCapture({
    url: 'https://www.lazada.vn/products/musa-i100-s11.html',
    html: html(),
    observedAt,
  });
  await assert.rejects(
    app.quote(offer.id, { shipping: 100, quoteObservedAt: 'not a date' }),
    /valid observation/u
  );
  await assert.rejects(
    app.quote(offer.id, {
      shipping: 100,
      quoteObservedAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    /valid observation/u
  );
});

test('chocolate ice cream containing cookies stays in the food category', async () => {
  const { categoryOf } = await import('../src/index.js');
  assert.equal(
    categoryOf(
      '[chỉ giao HCM chọn giao hàng 2h]Kem socola cookie bánh quy Joyday'
    ),
    'chocolate-ice-cream'
  );
  assert.equal(categoryOf('Chocolate ice cream molds'), 'unknown');
  assert.equal(
    categoryOf('KẸO SOCOLA HỖN HỢP KEM SŨA MERCI PETITS ĐỨC 125GR'),
    'unknown'
  );
  assert.equal(categoryOf('Bánh quy nhân kem socola'), 'unknown');
});
