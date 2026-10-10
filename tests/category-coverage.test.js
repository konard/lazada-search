import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCoverage } from '../src/coverage.js';

const categories = [
  'https://www.lazada.vn/ice-cream-all/',
  'https://www.lazada.vn/ice-cream-cone/',
  'https://www.lazada.vn/protein/',
];

function categoryScope(url, extras = {}) {
  const sorted = new URL(url);
  sorted.searchParams.set('sort', 'priceasc');
  return {
    query: `category:${sorted.href}`,
    url: sorted.href,
    type: 'category',
    terminalConfirmed: true,
    ...extras,
  };
}

function report(overrides = {}) {
  return {
    visibleSearchComplete: true,
    queries: [],
    categoryUrls: categories,
    scopes: categories.map((url) => categoryScope(url)),
    failures: [],
    ...overrides,
  };
}

test('three completed sorted categories do not synthesize duplicate unfinished scopes', () => {
  const crawl = report();
  const original = globalThis.structuredClone(crawl);
  const result = auditCoverage({ crawl });
  assert.equal(result.searchedScopes, 3);
  assert.deepEqual(result.unfinishedSearches, []);
  assert.equal(result.visibleSearchComplete, true);
  assert.equal(result.complete, false);
  assert.deepEqual(crawl, original);
});

test('stored legacy category queries without type or source URL recognize sort and page equivalence', () => {
  const result = auditCoverage({
    crawl: report({
      scopes: categories.map((url) => ({
        query: `category:${url}?sort=pricedesc&page=8`,
        terminalConfirmed: true,
      })),
    }),
  });
  assert.equal(result.searchedScopes, 3);
  assert.deepEqual(result.unfinishedSearches, []);
});

test('an actually missing category still produces one not-started coverage gap', () => {
  const result = auditCoverage({
    crawl: report({ scopes: categories.slice(0, 2).map(categoryScope) }),
  });
  assert.equal(result.searchedScopes, 3);
  assert.deepEqual(result.unfinishedSearches, [
    {
      query: `category:${categories[2]}`,
      terminalConfirmed: false,
      visitedPages: 0,
      stopReason: 'not-started',
    },
  ]);
});

test('equal category filters match despite parameter order while distinct filters remain coverage gaps', () => {
  const configured = `${categories[2]}?brand=123&rating=4&price=0-100000`;
  const same = `${categories[2]}?rating=4&price=0-100000&brand=123&page=9`;
  const matched = auditCoverage({
    crawl: report({
      categoryUrls: [configured],
      scopes: [categoryScope(same)],
    }),
  });
  assert.deepEqual(matched.unfinishedSearches, []);
  for (const source of [
    `${categories[2]}?brand=456&rating=4&price=0-100000`,
    `${categories[2]}?brand=123&rating=4`,
    `${configured}&q=chocolate`,
  ]) {
    const result = auditCoverage({
      crawl: report({
        categoryUrls: [configured],
        scopes: [categoryScope(source)],
      }),
    });
    assert.equal(result.searchedScopes, 2);
    assert.equal(result.unfinishedSearches.length, 1);
    assert.equal(result.unfinishedSearches[0].query, `category:${configured}`);
  }
});

test('other hosts, category paths and keyword source types cannot satisfy a configured category', () => {
  for (const scope of [
    categoryScope('https://www.lazada.sg/protein/'),
    categoryScope('https://www.lazada.vn/tag/protein/'),
    categoryScope(categories[2], { type: 'keyword', query: 'whey protein' }),
    { type: 'category', url: 'invalid-source', terminalConfirmed: true },
  ]) {
    const result = auditCoverage({
      crawl: report({ categoryUrls: [categories[2]], scopes: [scope] }),
    });
    assert.equal(result.unfinishedSearches.length, 1);
    assert.equal(
      result.unfinishedSearches[0].query,
      `category:${categories[2]}`
    );
  }
});

test('keyword scope matching remains exact and does not use category URL normalization', () => {
  const result = auditCoverage({
    crawl: report({
      categoryUrls: [],
      queries: ['whey protein', 'Chocolate Ice Cream'],
      scopes: [
        { query: 'whey protein', terminalConfirmed: true },
        { query: 'chocolate ice cream', terminalConfirmed: true },
      ],
    }),
  });
  assert.equal(result.searchedScopes, 3);
  assert.equal(result.unfinishedSearches.length, 1);
  assert.equal(result.unfinishedSearches[0].query, 'Chocolate Ice Cream');
});
