import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch, MARKETS } from '../src/index.js';
import { parseArguments } from '../src/config.js';

const categoryUrl = 'https://www.lazada.vn/protein/';
const cheap = 'https://www.lazada.vn/products/chocolate-whey-100g-i7101.html';
const bulk = 'https://www.lazada.vn/products/chocolate-whey-10kg-i7102.html';

async function application(t, load) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-category-unit-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    collector: { page: load },
    offline: true,
    ocr: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return app;
}

function capture(url, snapshot = {}) {
  return {
    id: `fixture:${url}`,
    fetchedAt: Date.now(),
    status: 'ok',
    cacheHit: true,
    snapshot: {
      url,
      cards: [],
      searchCoverage: { terminalConfirmed: true },
      ...snapshot,
    },
  };
}

test('category-only discovery ignores supplied keywords and uses actual default market categories', async (t) => {
  const visited = [];
  const app = await application(t, async (url) => {
    visited.push(url);
    return capture(url);
  });
  const report = await app.crawl({
    categoryOnly: true,
    queries: ['kem chocolate', 'unrelated broad search'],
    discoveryOnly: true,
    searchSort: 'priceasc',
  });
  assert.deepEqual(report.queries, []);
  assert.equal(report.scopes.length, MARKETS.vn.categoryUrls.length);
  assert.ok(report.scopes.every((scope) => scope.type === 'category'));
  assert.equal(report.discoveryComplete, true);
  assert.deepEqual(
    visited.map((url) => new URL(url).pathname).sort(),
    MARKETS.vn.categoryUrls.map((url) => new URL(url).pathname).sort()
  );
  assert.ok(visited.every((url) => !new URL(url).searchParams.has('q')));
});

for (const sort of ['priceasc', 'pricedesc']) {
  test(`${sort} survives an unsorted next link without filtering cheap packets or bulk containers`, async (t) => {
    const visited = [];
    const app = await application(t, async (url) => {
      visited.push(url);
      const page = Number(new URL(url).searchParams.get('page') || 1);
      return capture(url, {
        cards: [
          {
            url: page === 1 ? cheap : bulk,
            title:
              page === 1
                ? 'Chocolate whey protein 100 g'
                : 'Chocolate whey protein 10 kg',
            priceText: page === 1 ? '50.000 ₫' : '2.000.000 ₫',
          },
        ],
        nextUrl: page === 1 ? `${categoryUrl}?page=2` : null,
        searchCoverage: {
          currentPage: page,
          terminalConfirmed: page === 2,
          lastPage: 2,
          reportedTotal: 2,
        },
      });
    });
    const report = await app.crawl({
      categoryOnly: true,
      categoryUrls: [categoryUrl],
      discoveryOnly: true,
      searchSort: sort,
      maxPages: 2,
    });
    assert.equal(report.discoveryComplete, true);
    assert.equal(report.searchSort, sort);
    assert.equal(visited.length, 2);
    for (const url of visited) {
      const params = new URL(url).searchParams;
      assert.equal(params.get('sort'), sort);
      assert.ok(
        [...params.keys()].every((key) => ['sort', 'page'].includes(key))
      );
    }
    const discoveries = await app.store.list('discovery');
    assert.deepEqual(
      discoveries.map((entry) => entry.url).sort(),
      [cheap, bulk].sort()
    );
    assert.deepEqual(
      discoveries.map((entry) => entry.searchPrice).sort((a, b) => a - b),
      [50000, 2000000]
    );
    assert.equal(report.uncollected, 2);
  });
}

test('a category redirected to a broad tag cannot admit cards or start product collection', async (t) => {
  const app = await application(t, async (url) =>
    capture(url, {
      url: 'https://www.lazada.vn/tag/kem-chocolate/',
      cards: [
        {
          url: cheap,
          title: 'Chocolate whey protein 100 g',
          priceText: '50.000 ₫',
        },
      ],
    })
  );
  let detailVisits = 0;
  app.collect = async () => {
    detailVisits += 1;
    throw Error('A redirected category must never reach details');
  };
  const report = await app.crawl({
    categoryOnly: true,
    categoryUrls: [categoryUrl],
    searchSort: 'priceasc',
  });
  assert.equal(detailVisits, 0);
  assert.equal(report.discoveryComplete, false);
  assert.equal(report.scopes[0].terminalConfirmed, false);
  assert.equal(report.failures.length, 1);
  assert.match(
    report.failures[0].error,
    /Category scope mismatch at \/tag\/kem-chocolate/u
  );
  assert.deepEqual(await app.store.list('discovery'), []);
  assert.deepEqual(report.products, []);
});

test('invalid sorting is rejected before a category request', async (t) => {
  let visits = 0;
  const app = await application(t, async (url) => {
    visits += 1;
    return capture(url);
  });
  await assert.rejects(
    app.crawl({ categoryOnly: true, searchSort: 'cheapest-under-budget' }),
    /Unsupported search sort/u
  );
  assert.equal(visits, 0);
});

test('committed buying preferences use cached relevant mixed sources, while explicit filters override them', () => {
  const names = [
    'LAZADA_MARKET',
    'LAZADA_DELIVERY_AREA',
    'LAZADA_FLAVOUR_SCOPE',
    'LAZADA_CATEGORY_ONLY',
    'LAZADA_SEARCH_SORT',
  ];
  const original = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.LAZADA_CATEGORY_ONLY = 'false';
    process.env.LAZADA_SEARCH_SORT = 'pricedesc';
    const args = [
      'discover',
      '--configuration',
      'data/cases/vietnam-nha-trang/preferences.lenv',
    ];
    const configured = parseArguments(args);
    assert.equal(configured.categoryOnly, false);
    assert.equal(configured.searchSort, 'default');
    assert.deepEqual(MARKETS.vn.queries, [
      'whey protein',
      'whey isolate',
      'protein powder',
    ]);
    assert.ok(
      MARKETS.vn.categoryUrls.every((url) => !url.endsWith('/protein/'))
    );
    assert.equal(configured.flavourScope, 'chocolate-or-unflavoured');
    assert.equal(configured.market, 'vn');
    assert.equal(configured.deliveryArea, 'Nha Trang');
    const overridden = parseArguments([
      ...args,
      '--category-only',
      '--search-sort',
      'pricedesc',
    ]);
    assert.equal(overridden.categoryOnly, true);
    assert.equal(overridden.searchSort, 'pricedesc');
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
