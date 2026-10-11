import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch } from '../src/index.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-latest-observation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

test('out-of-order cached prices retain the newest observation and every original history', async (t) => {
  const store = await setup(t);
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  const latest = {
    id: 'sku-1',
    price: 200000,
    observedAt: '2026-10-11T00:00:00Z',
    available: true,
  };
  const older = {
    ...latest,
    price: 150000,
    observedAt: '2026-10-10T00:00:00Z',
  };
  await app.saveOffer(latest);
  assert.equal((await app.saveOffer(older)).price, latest.price);
  assert.equal(
    (await store.get('offer', latest.id)).observedAt,
    latest.observedAt
  );
  assert.deepEqual(
    (await store.list('offer-history')).map((record) => record.price).sort(),
    [150000, 200000]
  );
  await app.close();
});

test('concurrent catalog writers preserve the newest SKU price and permit corrections of identical observations', async (t) => {
  const store = await setup(t);
  const dates = [11, 9, 10].map((day) =>
    new Date(Date.UTC(2026, 9, day)).toISOString()
  );
  await Promise.all(
    dates.map((date, price) =>
      store.putLatest('offer', {
        id: 'sku-1',
        price,
        observedAt: date,
      })
    )
  );
  assert.equal((await store.get('offer', 'sku-1')).observedAt, dates[0]);
  await store.putLatest('offer', {
    id: 'sku-1',
    price: 100,
    observedAt: dates[0],
  });
  assert.equal((await store.get('offer', 'sku-1')).price, 100);
  await assert.rejects(
    store.putLatest('offer', { id: 'sku-1', observedAt: 'not a date' }),
    /valid observedAt/u
  );
});

test('older product reprocessing cannot replace a newer exact selected package identity', async (t) => {
  const store = await setup(t);
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  await app.saveProduct({
    id: 'sku-1',
    sku: 'sku-1',
    netMassG: 2050,
    observedAt: '2026-10-11T00:00:00Z',
  });
  await app.saveProduct({
    id: 'sku-1',
    sku: 'sku-1',
    netMassG: 2040,
    observedAt: '2026-10-10T00:00:00Z',
  });
  assert.equal((await store.get('product', 'sku-1')).netMassG, 2050);
  await app.close();
});

test('undated product imports remain supported without replacing dated package observations', async (t) => {
  const store = await setup(t);
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  const product = {
    id: 'sku-1',
    sku: 'sku-1',
    title: 'Chocolate whey protein',
    category: 'whey',
    url: 'https://www.lazada.vn/products/pdp-i1234.html',
    netMassG: 1000,
  };
  await app.importRecords({ products: [product] });
  assert.equal((await store.get('product', product.id)).netMassG, 1000);
  await app.saveProduct({
    ...product,
    netMassG: 2000,
    observedAt: new Date(Date.UTC(2026, 9, 11)).toISOString(),
  });
  await app.importRecords({ products: [product] });
  assert.equal((await store.get('product', product.id)).netMassG, 2000);
  await app.close();
});
