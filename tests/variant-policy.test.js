import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preferredVariant,
  cachedVariantMatches,
} from '../src/variant-policy.js';
import {
  LazadaSearch,
  BrowserCollector,
  AssociativeStore,
  EvidenceCache,
} from '../src/index.js';

const scope = 'chocolate-or-unflavoured';
const sku = (id, flavour, accessory, available = true) => ({
  sku: id,
  available,
  options: [
    { name: 'Hương vị', value: flavour },
    ...(accessory ? [{ name: 'Mua kèm', value: accessory }] : []),
  ],
});
const snapshot = {
  title: 'Scitec Whey Protein Professional 5LBS vị Vani',
  sku: '13427532777_VNAMZ-103',
  skuCatalog: [
    sku('103', 'Zprotein Brownie5lbs', 'Bình Lắc'),
    sku('101', 'Socola', 'Bình Lắc'),
    sku('102', 'Socola', 'Không Bình'),
    sku('104', 'Vanilla', 'Không Bình'),
    sku('105', 'Unflavored', 'Không Bình'),
  ],
};

test('generic whey listing chooses the complete chocolate/no-shaker SKU over unrelated defaults and plain siblings', () => {
  assert.equal(preferredVariant(snapshot, scope).sku, '102');
  assert.equal(preferredVariant(snapshot, 'all'), undefined);
  assert.equal(
    cachedVariantMatches(
      'https://www.lazada.vn/products/pdp-i13427532777.html',
      snapshot,
      scope
    ),
    false
  );
  assert.equal(
    cachedVariantMatches(
      'https://www.lazada.vn/products/pdp-i13427532777.html',
      { ...snapshot, sku: '13427532777_VNAMZ-102' },
      scope
    ),
    true
  );
});

test('explicit SKU requests retain the selected plain flavour', () => {
  assert.equal(
    cachedVariantMatches(
      'https://www.lazada.vn/products/pdp-i13427532777.html?skuId=105',
      { ...snapshot, sku: '13427532777_VNAMZ-105' },
      scope
    ),
    true
  );
  assert.equal(
    cachedVariantMatches(
      'https://www.lazada.vn/products/pdp-i13427532777-s105.html',
      snapshot,
      scope
    ),
    false
  );
});

test('out-of-stock chocolate falls behind purchasable unflavoured powder and no-shaker combinations are required when offered', () => {
  assert.equal(
    preferredVariant(
      {
        ...snapshot,
        skuCatalog: snapshot.skuCatalog.map((row) => ({
          ...row,
          available: row.sku !== '102',
        })),
      },
      scope
    ).sku,
    '105'
  );
  assert.equal(
    preferredVariant(
      {
        ...snapshot,
        skuCatalog: [sku('1', 'Chocolate + Shaker'), sku('2', 'Vanilla')],
      },
      scope
    ),
    undefined
  );
});

test('ice cream requires chocolate core and excludes plain, coated or mixed flavours', () => {
  const ice = {
    ...snapshot,
    title: 'Kem ice cream',
    skuCatalog: [
      sku('1', 'Unflavored'),
      sku('2', 'Vanilla coated with chocolate'),
      sku('3', 'Chocolate almond'),
      sku('4', 'Kem socola'),
    ],
  };
  assert.equal(preferredVariant(ice, scope).sku, '4');
  assert.equal(
    preferredVariant({ ...ice, skuCatalog: ice.skuCatalog.slice(0, 3) }, scope),
    undefined
  );
});

test('shopping scope is passed to the default browser collector and invalid values fail before browser startup', () => {
  const app = new LazadaSearch({
    store: new AssociativeStore(),
    ocr: false,
    flavourScope: scope,
  });
  assert.equal(app.collector.flavourScope, scope);
  assert.throws(
    () => new BrowserCollector({ flavourScope: 'vanilla' }),
    /Unsupported flavour scope/
  );
});

test('a fully cached exact chocolate sibling is reused when the generic listing has an incompatible default', async () => {
  const url = 'https://www.lazada.vn/products/pdp-i13427532777.html';
  const selectedUrl = `${url}?skuId=102`;
  const records = new Map([
    [`page:${url}`, { snapshot, status: 'ok', url }],
    [
      `page:${selectedUrl}`,
      {
        id: `page:${selectedUrl}`,
        url: selectedUrl,
        status: 'ok',
        snapshot: {
          ...snapshot,
          sku: '13427532777_VNAMZ-102',
          priceText: '2.950.000 ₫',
        },
        fetchedAt: Date.now(),
        checkedAt: Date.now(),
        repositoryReusable: true,
      },
    ],
  ]);
  const store = {
    get: async (kind, id) => (kind === 'cache' ? records.get(id) : undefined),
  };
  const cache = new EvidenceCache({ store, offline: true });
  const collector = new BrowserCollector({ store, cache, flavourScope: scope });
  collector.start = () => {
    throw Error('Cached selected evidence must not start a browser');
  };
  const result = await collector.page(url);
  assert.equal(result.cacheHit, true);
  assert.equal(result.snapshot.sku, '13427532777_VNAMZ-102');
  assert.equal(cache.stats.downloads, 0);
  assert.equal(records.get(`page:${url}`).snapshot.sku, snapshot.sku);
  assert.equal(
    await collector.cachedPreferredUrl(url, { refresh: true }, scope),
    url
  );
  assert.equal(
    await collector.cachedPreferredUrl(
      url,
      { acceptCached: () => false },
      scope
    ),
    url
  );
  records.get(`page:${selectedUrl}`).invalidatedAt = new Date().toISOString();
  assert.equal(await collector.cachedPreferredUrl(url, {}, scope), url);
});
