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

test('a removed product is cached as unavailable and the next product still loads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-removed-page-'));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    settleMs: 0,
    maxScrolls: 0,
    captureTimeoutMs: 20000,
    browserOptions: { launch: 'engine', persistent: false },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  let requests = 0;
  const removedUrl = 'https://www.lazada.vn/products/removed-i101.html';
  await collector.runtime.page.route('https://www.lazada.vn/**', (route) => {
    requests++;
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body:
        route.request().url() === removedUrl
          ? '<html><head><title>Xin lỗi! Sản phẩm này không còn tồn tại</title></head><body></body></html>'
          : '<h1>Fixture chocolate whey 500g</h1><div data-product-price>80.000 ₫</div>',
    });
  });
  const removed = await collector.page(removedUrl);
  assert.equal(removed.status, 'unavailable');
  assert.equal(removed.snapshot.priceText, undefined);
  assert.match(
    (await store.blob(removed.html.sha256)).toString(),
    /Sản phẩm này không còn tồn tại/u
  );
  const next = await collector.page(
    'https://www.lazada.vn/products/available-i102.html'
  );
  assert.equal(next.status, 'ok');
  assert.equal(next.snapshot.priceText, '80.000 ₫');
  const replay = await collector.page(removedUrl);
  assert.equal(replay.status, 'unavailable');
  assert.equal(replay.cacheHit, true);
  assert.equal(requests, 2);
});
