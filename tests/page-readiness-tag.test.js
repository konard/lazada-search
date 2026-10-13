import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { inspectPageReadiness } from '../src/page-readiness.js';

test('redirected tag searches require cards or an explicit empty state even when the terminal pager already exists', () => {
  const url = 'https://www.lazada.vn/tag/kem-chocolate/?q=kem+chocolate';
  const inspect = (html) =>
    inspectPageReadiness({ url, document: parseHTML(html).document });
  const pager =
    '<nav data-pagination><button data-next-page aria-disabled="true">Next</button></nav>';
  assert.equal(inspect(`<header>Search</header>${pager}`).ready, false);
  assert.equal(
    inspect(
      `<article data-product-card>Chocolate ice cream 500ml</article>${pager}`
    ).ready,
    true
  );
  assert.equal(
    inspect(`<div data-empty-results>No products found</div>${pager}`).ready,
    true
  );
});
