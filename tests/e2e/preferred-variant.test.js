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
  LazadaSearch,
  executeOperation,
} from '../../src/index.js';

test('generic Scitec-style listing replaces the wrong default with Socola/Không Bình, waits for SKU/price and reuses the corrected capture', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-preferred-variant-'));
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
  let navigations = 0;
  const skuBase = {
    skus: [
      { skuId: '101', propPath: '1:1;2:1' },
      { skuId: '102', propPath: '1:1;2:2' },
      { skuId: '103', propPath: '1:2;2:1' },
    ],
    properties: [
      {
        pid: '1',
        name: 'Hương vị',
        values: [
          { vid: '1', name: 'Socola' },
          { vid: '2', name: 'Zprotein Brownie5lbs' },
        ],
      },
      {
        pid: '2',
        name: 'Mua kèm',
        values: [
          { vid: '1', name: 'Bình Lắc' },
          { vid: '2', name: 'Không Bình' },
        ],
      },
    ],
  };
  const url = 'https://www.lazada.vn/products/pdp-i13427532777.html';
  const namespace = 'lazada:vn:Nha Trang';
  await store.put('cache', {
    id: `${namespace}:${url}`,
    url,
    fetchedAt: Date.now(),
    checkedAt: Date.now(),
    status: 'ok',
    snapshot: {
      title: 'Scitec Whey Protein vị Vani',
      sku: '13427532777_VNAMZ-103',
      skuCatalog: skuBase.skus.map((row) => ({
        sku: row.skuId,
        options: row.propPath.split(';').map((part) => {
          const [pid, vid] = part.split(':');
          const prop = skuBase.properties.find((value) => value.pid === pid);
          return {
            name: prop.name,
            value: prop.values.find((value) => value.vid === vid).name,
          };
        }),
      })),
    },
  });
  await collector.runtime.page.route('https://www.lazada.vn/**', (route) => {
    navigations += 1;
    return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<h1>Scitec Whey Protein Professional vị Vani</h1><div data-product-price>3.070.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">13427532777_VNAMZ-103</span></div>
      <button data-sku-option data-group="flavour" data-value="1" aria-checked="false">Socola</button><button data-sku-option data-group="flavour" data-value="2" aria-checked="true">Zprotein Brownie5lbs</button>
      <button data-sku-option data-group="accessory" data-value="1" aria-checked="true">Bình Lắc</button><button data-sku-option data-group="accessory" data-value="2" aria-checked="false">Không Bình</button>
      <script>window.__moduleData__ = ${JSON.stringify({ data: { root: { fields: { productOption: { skuBase } } } } })};
      window.optionClicks=[]; for(const button of document.querySelectorAll('button')) button.onclick=()=>{
        window.optionClicks.push(button.textContent);document.body.setAttribute('aria-busy','true');
        for(const sibling of document.querySelectorAll('[data-group="'+button.dataset.group+'"]')) sibling.setAttribute('aria-checked',String(sibling===button));
        setTimeout(()=>{const flavour=document.querySelector('[data-group="flavour"][aria-checked="true"]').dataset.value;const accessory=document.querySelector('[data-group="accessory"][aria-checked="true"]').dataset.value;
        document.querySelector('.key-value').textContent='13427532777_VNAMZ-'+(flavour==='2'?'103':accessory==='1'?'101':'102');document.querySelector('[data-product-price]').textContent=accessory==='2'?'2.950.000 ₫':'3.070.000 ₫';document.body.removeAttribute('aria-busy');},200);
      };</script>`,
    });
  });
  const result = await collector.page(url, {
    namespace,
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.equal(result.snapshot.sku, '13427532777_VNAMZ-102');
  assert.equal(result.snapshot.priceText, '2.950.000 ₫');
  assert.deepEqual(
    result.snapshot.selectedVariant.map((row) => row.text),
    ['Socola', 'Không Bình']
  );
  assert.equal(result.variantSelection.reason, 'preferred-scoped-sku');
  assert.deepEqual(
    await collector.runtime.page.evaluate(() => globalThis.optionClicks),
    ['Socola', 'Không Bình']
  );
  assert.equal(navigations, 1);
  const cached = await collector.page(url, {
    namespace,
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.snapshot.sku, result.snapshot.sku);
  assert.equal(navigations, 1);
  const app = new LazadaSearch({
    store,
    collector,
    ocr: false,
    maxImages: 0,
    flavourScope: 'chocolate-or-unflavoured',
  });
  assert.equal((await app.collect(url)).offer.sku, result.snapshot.sku);
  assert.equal(
    (
      await executeOperation(app, {
        operation: 'collect',
        input: { url },
        options: { flavourScope: 'chocolate-or-unflavoured' },
      })
    ).offer.price,
    2950000
  );
  assert.equal(navigations, 1);
});
