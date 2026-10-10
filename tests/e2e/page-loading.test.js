import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
} from '../../src/index.js';

test('delayed product and detail loaders settle before recording price, promotions and specifications', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-loading-'));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    settleMs: 0,
    maxScrolls: 1,
    browserOptions: { launch: 'engine', persistent: false },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  await collector.runtime.page.route('https://www.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<h1>Fixture whey 500g</h1><div data-product-price>100.000 ₫</div><div class="pdp-product-desc-v2"><div class="iweb-loading-container">Loading</div></div><script>setTimeout(()=>{document.querySelector('[data-product-price]').textContent='80.000 ₫';document.querySelector('.pdp-product-desc-v2').textContent='Net weight: 500g. Ingredients: Whey protein isolate.';},1700);</script>`,
    })
  );
  const capture = await collector.page(
    'https://www.lazada.vn/products/fixture-i101.html'
  );
  assert.equal(capture.snapshot.priceText, '80.000 ₫');
  assert.equal(capture.screenshotMode, 'viewport');
  assert.equal(capture.screenshot.sha256, capture.screenshots[0].blob.sha256);
  assert.equal(capture.screenshots[0].role, 'before-scroll');
  assert.match(capture.snapshot.description, /Net weight: 500g/u);
  assert.doesNotMatch(
    (await store.blob(capture.html.sha256)).toString(),
    /<div class="iweb-loading-container">/u
  );
});
