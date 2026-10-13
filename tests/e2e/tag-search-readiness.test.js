import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
  LazadaSearch,
} from '../../src/index.js';

test('keyword redirect to a tag page waits for delayed cards before certifying its visible terminal page', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-tag-ready-'));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 0,
    maxScrolls: 0,
    browserOptions: { launch: 'engine', persistent: false },
  });
  const app = new LazadaSearch({
    store,
    cache,
    collector,
    offline: false,
    ocr: false,
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const requests = [];
  await collector.runtime.page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    assert.equal(url.origin, 'https://www.lazada.vn');
    if (url.pathname === '/catalog/') {
      await route.fulfill({
        contentType: 'text/html',
        body: '<script>location.replace("/tag/kem-chocolate/?q=kem+chocolate&sort=priceasc")</script>',
      });
      return;
    }
    assert.equal(url.pathname, '/tag/kem-chocolate/');
    await route.fulfill({
      contentType: 'text/html',
      body: '<header>Search</header><nav data-pagination><span aria-current="page">1</span><button data-next-page aria-disabled="true">Next</button></nav><script>setTimeout(()=>{const card=document.createElement("article");card.setAttribute("data-product-card","");const link=document.createElement("a");link.href="/products/fixture-i123.html";link.title="Kem chocolate 500ml";link.textContent=link.title;const price=document.createElement("span");price.setAttribute("data-card-price","");price.textContent="50000 ₫";card.append(link,price);document.body.prepend(card);},3500)</script>',
    });
  });
  const report = await app.crawl({
    queries: ['kem chocolate'],
    categoryUrls: [],
    discoveryOnly: true,
    exhaustive: true,
    searchSort: 'priceasc',
    maxPages: 1,
  });
  assert.equal(report.discoveryComplete, true);
  assert.equal(report.discovered, 1);
  assert.equal(report.scopes[0].terminalConfirmed, true);
  assert.equal((await store.list('discovery')).length, 1);
  assert.ok(
    requests.some((url) => new URL(url).pathname === '/tag/kem-chocolate/')
  );
  assert.ok(
    requests.every((url) => !new URL(url).pathname.includes('/products/'))
  );
});
