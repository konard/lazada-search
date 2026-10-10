import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  inspectPageReadiness,
  waitForPageReady,
} from '../src/page-readiness.js';

test('saved HTML reveals visible loading placeholders and missing product prices', () => {
  const url = 'https://www.lazada.vn/products/fixture-i101.html';
  const check = (html) =>
    inspectPageReadiness({ document: parseHTML(html).document, url });
  assert.equal(
    check('<h1>Whey</h1><div class="iweb-loading-container"></div>').ready,
    false
  );
  assert.equal(
    check('<h1>Whey</h1><div data-product-price>80.000 ₫</div>').ready,
    true
  );
  assert.equal(
    check(
      '<h1>Whey</h1><div data-product-price>80.000 ₫</div><div class="iweb-loading-container" style="display:none"></div>'
    ).ready,
    true
  );
});

test('search readiness requires stable visible product cards or an explicit empty-results state', () => {
  const check = (html) =>
    inspectPageReadiness({
      document: parseHTML(html).document,
      url: 'https://www.lazada.vn/catalog/?q=whey',
    });
  assert.equal(
    check('<header>Search</header><footer>Footer</footer>').ready,
    false
  );
  assert.equal(
    check('<article data-product-card>Whey 500g</article>').ready,
    true
  );
  assert.equal(
    check('<article data-product-card style="display:none">Whey</article>')
      .ready,
    false
  );
  assert.equal(
    check('<div data-empty-results>No products found</div>').ready,
    true
  );
  assert.notEqual(
    check('<article data-product-card>Whey 500g</article>').fingerprint,
    check('<article data-product-card>Whey 1kg</article>').fingerprint
  );
});

test('stuck loaders fail without accepting a transient price or advancing navigation', async () => {
  let time = 0;
  const page = {
    getByText: () => ({ isVisible: async () => false }),
    locator: () => ({ count: async () => 0 }),
    evaluate: async () => ({
      ready: false,
      blockers: ['iweb-loading-container'],
      fingerprint: 'unsettled price',
    }),
    waitForTimeout: async (ms) => {
      time += ms;
    },
  };
  await assert.rejects(
    waitForPageReady(page, { timeoutMs: 1500, now: () => time }),
    /loading did not settle.*iweb-loading-container/u
  );
});
