import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  EvidenceCache,
  DomainScheduler,
  BrowserCollector,
} from '../../src/index.js';

test('a stalled browser navigation is cancelled and cannot poison the next capture', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-capture-budget-'));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    captureTimeoutMs: 500,
    settleMs: 0,
    browserOptions: { launch: 'engine' },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const oldPage = collector.runtime.page;
  await oldPage.route('https://www.lazada.vn/**', () => {});
  const started = Date.now();
  await assert.rejects(
    collector.page('https://www.lazada.vn/products/pdp-i1.html'),
    /Page capture timed out/
  );
  assert.ok(Date.now() - started < 10000);
  assert.equal(oldPage.isClosed(), true);
  assert.equal(collector.runtime, undefined);
  collector.captureTimeoutMs = 15000;
  await collector.start();
  await collector.runtime.page.route('https://www.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Recovered whey</h1><div data-product-price>300.000 ₫</div>',
    })
  );
  const result = await collector.page(
    'https://www.lazada.vn/products/pdp-i2.html'
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.title, 'Recovered whey');
  const reuse = await collector.page(
    'https://www.lazada.vn/products/pdp-i2.html'
  );
  assert.equal(reuse.cacheHit, true);
});
