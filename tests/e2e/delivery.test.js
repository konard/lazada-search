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

test('Browser Commander selects Nha Trang, caches the exact one-package estimate and records delivery restrictions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-delivery-e2e-'));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 25,
    browserOptions: { launch: 'engine' },
  });
  const app = new LazadaSearch({ store, cache, collector, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  let navigations = 0;
  await collector.runtime.page.route(
    'https://www.lazada.vn/**',
    async (route) => {
      navigations++;
      const ice = route.request().url().includes('ice');
      const title = ice ? 'Kem socola 860ml' : 'Whey protein isolate 1kg';
      const quote = ice
        ? 'Sản phẩm này không thể giao đến địa chỉ của bạn.'
        : 'Giao tiêu chuẩn, phí vận chuyển 80.200 ₫';
      await route.fulfill({
        contentType: 'text/html',
        body: `<meta charset="utf-8"><h1>${title}</h1><div data-product-price>100.000 ₫</div><div data-seller>Fixture</div><div class="delivery-v2"><span class="location-v2__address">Thành phố Hồ Chí Minh, Phường Bến Thành</span><button class="automation-location-link-change">THAY ĐỔI</button><div id="regions"></div><p id="quote"></p></div><script>
      document.querySelector('.automation-location-link-change').onclick=()=>{
        document.querySelector('#regions').innerHTML='<button class="automation-location-list-item">Khánh Hòa</button>';
        document.querySelector('.automation-location-list-item').onclick=()=>{
          document.querySelector('#regions').innerHTML='<button class="automation-location-list-item">Phường Nha Trang</button>';
          document.querySelector('.automation-location-list-item').onclick=()=>{
            document.querySelector('.location-v2__address').textContent='Khánh Hòa, Phường Nha Trang';
            document.querySelector('#regions').replaceChildren();
            document.querySelector('#quote').textContent=${JSON.stringify(quote)};
          };
        };
      };
    </script>`,
      });
    }
  );
  const powderUrl = 'https://www.lazada.vn/products/fixture-whey-i201.html';
  const collected = await app.collect(powderUrl);
  const quote = await app.delivery(powderUrl);
  assert.equal(quote.shipping, 80200);
  assert.equal(quote.shippingDestination, 'Khánh Hòa, Phường Nha Trang');
  assert.equal(quote.shippingQuantity, 1);
  assert.equal(quote.applied, true);
  const recorded = await store.get('offer', collected.offer.id);
  assert.equal(recorded.quoteEvidenceId, quote.evidenceId);
  assert.ok((await store.get('evidence', quote.evidenceId)).screenshot.sha256);
  const before = navigations;
  assert.equal((await app.delivery(powderUrl)).cacheHit, true);
  assert.equal(navigations, before);
  const bulk = (await app.compare({ quantity: 10 })).comparisons[0];
  assert.equal(bulk.metrics.totalBeforeDelivery, 1000000);
  assert.equal(bulk.metrics.totalAfterDelivery, null);
  const iceUrl = 'https://www.lazada.vn/products/fixture-ice-i202.html';
  const ice = await app.collect(iceUrl);
  assert.equal((await app.delivery(iceUrl)).applied, false);
  assert.equal(
    (await store.get('offer', ice.offer.id)).deliveryAvailable,
    false
  );
  assert.ok(
    (
      await app.compare({ category: 'chocolate-ice-cream' })
    ).comparisons[0].problems.includes(
      'The listing cannot deliver to this destination'
    )
  );
});
