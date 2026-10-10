import test from 'node:test';
import assert from 'node:assert/strict';
import {
  productFlavour,
  matchesFlavourScope,
  compareOffers,
  BrowserCollector,
} from '../src/index.js';
import { parseArguments, comparisonOptions } from '../src/config.js';
import { apiComparisonOptions } from '../src/server.js';

const scope = 'chocolate-or-unflavoured';
const powder = (title, options = {}) => ({
  category: 'whey',
  title,
  ...options,
});
const ice = (title, options = {}) => ({
  category: 'chocolate-ice-cream',
  title,
  ...options,
});

test('strict shopping scope includes plain/chocolate and rejects mixed or unspecified flavours', () => {
  for (const product of [
    powder('Whey isolate unflavored'),
    powder('Whey VỊ TỰ NHIÊN'),
    powder('Bột đậu nành chocolate', { category: 'protein-powder' }),
    powder('Milk chocolate whey'),
    ice('Kem sô-cô-la'),
    ice('Kem cacao'),
  ]) {
    assert.equal(matchesFlavourScope(product, scope), true, product.title);
  }
  for (const product of [
    powder('Whey Vanilla'),
    powder('Whey cookies & cream'),
    powder('Whey strawberry'),
    powder('Whey 1kg'),
    ice('Chocolate banana ice cream'),
    ice('Kem socola hạnh nhân Celano 70ML'),
    ice('Kem ốc quế Merino dâu socola 60g'),
    ice('KEM SOCOLA MỨT DÂU, CAM', { selectedVariant: [{ text: 'Nhân cam' }] }),
    ice('Kem Aice Cà Phê Socola Giòn'),
    ice('Kem chocolate almond'),
    ice('Chocolate vanilla 3 in 1'),
    ice('Vanilla ice cream coated with chocolate'),
    ice('Ice cream 460ml'),
  ]) {
    assert.equal(matchesFlavourScope(product, scope), false, product.title);
  }
});

test('selected SKU and exact manufacturer flavour take precedence over general advertising', () => {
  assert.equal(
    matchesFlavourScope(
      powder('Chocolate whey', {
        selectedVariant: [{ text: 'Sôcôla' }, { text: 'BÌNH BỘT' }],
      }),
      scope
    ),
    false
  );
  assert.equal(
    matchesFlavourScope(
      powder('Chocolate whey', {
        selectedVariant: [{ text: 'Chocolate + Shaker' }],
      }),
      scope
    ),
    false
  );
  assert.equal(
    matchesFlavourScope(
      powder('Chocolate whey, free shaker promotion', {
        selectedVariant: [{ text: 'Chocolate' }],
      }),
      scope
    ),
    true
  );
  assert.equal(
    productFlavour(
      powder('Chocolate Vanilla whey', {
        selectedVariant: [{ text: 'Chocolate 1kg' }, { text: 'Gift shaker' }],
      })
    ),
    'chocolate'
  );
  assert.equal(
    productFlavour(
      powder('Chocolate Vanilla whey', {
        selectedVariant: [{ text: 'Vanilla' }],
      })
    ),
    'other'
  );
  const reviewed = ice('Chocolate ice cream', {
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      identity: { flavour: 'Vanilla with chocolate coating' },
    },
  });
  assert.equal(matchesFlavourScope(reviewed, scope), false);
  const untrusted = {
    ...reviewed,
    manufacturerVerification: {
      ...reviewed.manufacturerVerification,
      sourceAuthority: 'retailer',
    },
  };
  assert.equal(productFlavour(untrusted), 'chocolate');
});

test('flavour scope excludes rows from every ranking and survives CLI/HTTP option parsing', () => {
  const products = [
    powder('Natural whey', { id: 'a' }),
    powder('Vanilla whey', { id: 'b' }),
    ice('Chocolate banana', { id: 'c' }),
    ice('Chocolate', { id: 'd' }),
  ];
  const offers = products.map((p) => ({
    id: p.id,
    productId: p.id,
    currency: 'VND',
    price: 100,
    variantConfirmed: true,
    observedAt: new Date().toISOString(),
  }));
  const report = compareOffers(products, offers, { flavourScope: scope });
  assert.deepEqual(report.comparisons.map((r) => r.product.id).sort(), [
    'a',
    'd',
  ]);
  assert.ok(
    [...report.ranked, ...report.excluded, ...report.observedPrices].every(
      (r) => ['a', 'd'].includes(r.product.id)
    )
  );
  assert.equal(report.assumptions.flavourScope, scope);
  assert.equal(
    comparisonOptions(parseArguments(['compare', '--flavour-scope', scope]))
      .flavourScope,
    scope
  );
  assert.equal(
    apiComparisonOptions(new URLSearchParams({ flavourScope: scope }))
      .flavourScope,
    scope
  );
  assert.throws(
    () => compareOffers([], [], { flavourScope: 'vanilla' }),
    /Unsupported flavour scope/
  );
});

test('a requested full SKU already selected never triggers another variant action', async () => {
  const collector = new BrowserCollector();
  await collector.selectRequestedVariant(
    'https://www.lazada.vn/products/pdp-i3300919067.html?skuId=3300919067_VNAMZ-16058119853',
    { sku: '3300919067_VNAMZ-16058119853', skuCatalog: [] }
  );
  await assert.rejects(
    collector.selectRequestedVariant(
      'https://www.lazada.vn/products/pdp-i3300919067.html?skuId=999',
      { sku: '3300919067_VNAMZ-16058119853', skuCatalog: [] }
    ),
    /absent/
  );
});
