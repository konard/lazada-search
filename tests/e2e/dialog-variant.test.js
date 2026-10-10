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

test('product-learning notice resolves before selecting the exact SKU; unknown dialogs block extraction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-dialog-sku-'));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    settleMs: 0,
    maxScrolls: 0,
    browserOptions: { launch: 'engine' },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  await collector.runtime.page.route('https://www.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: route.request().url().includes('unknown')
        ? '<div role="dialog">Unrecognized confirmation</div><h1>Whey</h1><div data-product-price>200.000 ₫</div>'
        : `<h1>Fixture whey 1 kg</h1><div data-product-price>200.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">101_VNAMZ-201</span></div>
        <button data-sku-option data-sku-id="201" aria-checked="true">Vanilla</button>
        <button data-sku-option data-sku-id="202" aria-checked="false">Chocolate</button>
        <div class="message__item">Thông tin này chỉ mang tính chất trợ giúp tìm hiểu về sản phẩm, không nhằm mục đích quảng cáo. Vui lòng xác nhận Quý khách là nhân viên y tế hoặc có nhu cầu tìm hiểu về sản phẩm.</div>
        <div role="dialog" id="notice"><p>Thông tin này chỉ mang tính chất trợ giúp tìm hiểu về sản phẩm, không nhằm mục đích quảng cáo. Vui lòng xác nhận Quý khách là nhân viên y tế hoặc có nhu cầu tìm hiểu về sản phẩm.</p><label><input type="checkbox">Không hỏi lại</label><button id="confirm">Xác nhận</button></div>
        <script>window.__moduleData__ = {"data":{"root":{"fields":{"productOption":{"skuBase":{"skus":[{"skuId":"201","propPath":"1:1"},{"skuId":"202","propPath":"1:2"}],"properties":[{"pid":"1","name":"Flavour","values":[{"vid":"1","name":"Vanilla"},{"vid":"2","name":"Chocolate"}]}]}}}}}};
        document.getElementById('confirm').onclick=()=>{if(!document.querySelector('#notice input').checked)throw Error('Remember the learning preference');document.getElementById('notice').remove();};
        document.querySelector('[data-sku-id="202"]').onclick=()=>{if(document.getElementById('notice'))throw Error('Dialog must be resolved first');document.querySelector('.key-value').textContent='101_VNAMZ-202';document.querySelector('[data-product-price]').textContent='250.000 ₫';};</script>`,
    })
  );
  const selected = await collector.page(
    'https://www.lazada.vn/products/fixture-i101-s202.html'
  );
  assert.equal(selected.snapshot.sku, '101_VNAMZ-202');
  assert.equal(selected.snapshot.priceText, '250.000 ₫');
  assert.equal(await collector.runtime.page.locator('#notice').count(), 0);
  await assert.rejects(
    collector.page('https://www.lazada.vn/products/unknown-i102.html'),
    /Unresolved page dialog/
  );
  assert.equal(
    await store.get(
      'cache',
      'page:https://www.lazada.vn/products/unknown-i102.html'
    ),
    undefined
  );
});
