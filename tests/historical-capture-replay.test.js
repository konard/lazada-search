import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  AssociativeStore,
  LazadaSearch,
  replayHistoricalCaptures,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

const t1 = '2026-10-09T09:00:00.000Z';
const t2 = '2026-10-10T09:00:00.000Z';
const listingUrl = 'https://www.lazada.vn/products/pdp-i100.html';
const html = ({ sku = '11', price = '250.000', mass = '2.04' } = {}) =>
  `<h1>Fixture whey isolate chocolate 4.5lb</h1><div data-product-price>${price} ₫</div><div data-seller>Fixture seller</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-${sku}</span></div><div class="pdp-product-desc">Đóng gói: Hộp ${mass}kg</div>`;

async function setup(t, visibility = 'public') {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-historical-replay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, visibility });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(() => app.close());
  return { app, store };
}

function prohibitNavigation(app) {
  app.collector.page = () => {
    throw new Error('Offline replay must not consult the browser collector');
  };
  app.cache.image = () => {
    throw new Error('Offline replay must not request an image');
  };
}

async function captured(app, values = {}, observedAt = t1) {
  return await app.importCapture({
    url: listingUrl,
    html: html(values),
    observedAt,
  });
}

test('historical exact sibling SKU replays from attached originals when the one listing alias belongs to its newer sibling', async (t) => {
  const { app, store } = await setup(t);
  const older = await captured(app);
  const newer = await captured(app, { sku: '12', price: '260.000' }, t2);
  const source = await store.get('evidence', older.offer.evidenceId);
  const originalBytes = await store.blob(source.html.sha256);
  const cache = await store.list('cache');
  const inventory = await store.list('sku-inventory');
  assert.equal(cache[0].snapshot.sku, newer.offer.sku);
  // An older parser used the rounded headline; the selected original corrects it.
  await store.put('product', {
    ...older.product,
    netMassG: 4.5 * 453.59237,
  });
  const stop = await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
  });
  const exclusion = await store.put('scope-decision', {
    id: 'scope:fixture',
    decision: 'excluded',
    reasons: ['Fixture previous nonmatching decision'],
  });
  prohibitNavigation(app);
  const report = await replayHistoricalCaptures(app);
  assert.equal(report.errors, 0);
  assert.equal(report.reprocessed, 2);
  assert.equal(report.downloads, 0);
  const receipt = report.results.find(
    (record) =>
      record.status === 'reprocessed' && record.sku === older.offer.sku
  );
  assert.equal(receipt.sourceSha256, source.html.sha256);
  assert.equal(receipt.observedAt, t1);
  assert.equal(receipt.price, 250000);
  assert.equal(receipt.netMassG, 2040);
  assert.ok(receipt.sourceRecords.some((row) => row.evidenceId === source.id));
  assert.equal((await store.get('product', older.product.id)).netMassG, 2040);
  assert.equal((await store.get('offer', newer.offer.id)).price, 260000);
  assert.deepEqual(await store.list('cache'), cache);
  assert.deepEqual(await store.list('sku-inventory'), inventory);
  assert.deepEqual(await store.blob(source.html.sha256), originalBytes);
  assert.deepEqual(await store.get('evidence', source.id), source);
  assert.deepEqual(await store.get('collection-stop', stop.id), stop);
  assert.deepEqual(await store.get('scope-decision', exclusion.id), exclusion);
  assert.equal(app.cache.stats.downloads, 0);
});

test('old source replay retains newer SKU price and package while preserving both original price histories', async (t) => {
  const { app, store } = await setup(t);
  const older = await captured(app);
  const newer = await captured(app, { price: '300.000', mass: '2.05' }, t2);
  await store.put('sku-inventory', {
    id: listingUrl,
    url: listingUrl,
    skus: [{ sku: older.offer.sku }, { sku: '100_VNAMZ-99' }],
    observedAt: '2026-10-11T09:00:00.000Z',
  });
  const inventory = await store.list('sku-inventory');
  const cache = await store.list('cache');
  prohibitNavigation(app);
  const report = await replayHistoricalCaptures(app, {
    includeLatestCache: false,
  });
  assert.equal(report.errors, 0);
  assert.equal(report.reprocessed, 2);
  assert.deepEqual(
    report.results.map((record) => record.observedAt),
    [t1, t2]
  );
  const current = await store.get('offer', newer.offer.id);
  assert.equal(current.price, 300000);
  assert.equal(current.observedAt, t2);
  assert.equal((await store.get('product', newer.product.id)).netMassG, 2050);
  assert.equal(report.results[0].price, 250000);
  assert.equal(report.results[0].currentOffer.price, 300000);
  const history = await store.list('offer-history');
  assert.ok(
    history.some(
      (record) => record.price === 250000 && record.observedAt === t1
    )
  );
  assert.ok(
    history.some(
      (record) => record.price === 300000 && record.observedAt === t2
    )
  );
  assert.deepEqual(await store.list('cache'), cache);
  assert.deepEqual(await store.list('sku-inventory'), inventory);
});

test('publication-only exact historical SKU is recovered without making a new cache alias', async (t) => {
  const { app, store } = await setup(t);
  const original = Buffer.from(html({ sku: '13', price: '280.000' }));
  const source = await store.put('publication', {
    id: 'publication:fixture-historical',
    sourceUrl: `${listingUrl}?skuId=13`,
    sku: '100_VNAMZ-13',
    observedAt: t1,
    priceContext: 'private-profile-browser-observation',
    html: await store.putBlob(original),
  });
  prohibitNavigation(app);
  const report = await replayHistoricalCaptures(app);
  assert.equal(report.errors, 0);
  assert.equal(report.reprocessed, 1);
  assert.equal(report.results[0].sku, source.sku);
  assert.equal(report.results[0].sourceSha256, sha256(original));
  assert.equal(report.results[0].observedAt, t1);
  assert.equal((await store.list('offer'))[0].price, 280000);
  assert.equal(
    (await store.list('offer'))[0].priceContext,
    'private-profile-browser-observation'
  );
  assert.deepEqual(await store.list('cache'), []);
  assert.deepEqual(await store.get('publication', source.id), source);
});

test('replay rejects wrong-SKU attachments, corrupt bytes and missing original blobs without substituting latest aliases', async (t) => {
  const { app, store } = await setup(t);
  const source = await store.put('publication', {
    id: 'publication:wrong-sibling-attachment',
    sourceUrl: listingUrl,
    sku: '100_VNAMZ-99',
    observedAt: t1,
    html: await store.putBlob(html()),
  });
  prohibitNavigation(app);
  let report = await replayHistoricalCaptures(app, {
    includeLatestCache: false,
  });
  assert.ok(
    report.results.some((row) => row.error?.includes('attached exact SKU'))
  );
  assert.deepEqual(await store.list('offer'), []);
  await store.put('publication', { ...source, sku: '100_VNAMZ-11' });
  const originalBlob = store.blob.bind(store);
  store.blob = async (hash) =>
    hash === source.html.sha256
      ? Buffer.from('different original bytes')
      : originalBlob(hash);
  report = await replayHistoricalCaptures(app, { includeLatestCache: false });
  assert.equal(report.reprocessed, 0);
  assert.ok(report.results.every((row) => /digest mismatch/u.test(row.error)));
  store.blob = async () => undefined;
  report = await replayHistoricalCaptures(app, { includeLatestCache: false });
  assert.equal(report.reprocessed, 0);
  assert.ok(report.results.every((row) => /blob is missing/u.test(row.error)));
  assert.equal(report.downloads, 0);
});

test('public replay rejects private or invalidated originals and does not clear stop or reload evidence', async (t) => {
  const { app, store } = await setup(t);
  const capture = await captured(app);
  const source = await store.get('evidence', capture.offer.evidenceId);
  await store.put('evidence', { ...source, visibility: 'private' });
  prohibitNavigation(app);
  let report = await replayHistoricalCaptures(app, {
    includeLatestCache: false,
  });
  assert.equal(report.reprocessed, 0);
  assert.ok(report.results.every((row) => /Private source/u.test(row.error)));
  await store.put('evidence', { ...source, invalidatedAt: t2 });
  report = await replayHistoricalCaptures(app, { includeLatestCache: false });
  assert.equal(report.reprocessed, 0);
  assert.ok(report.results.every((row) => /online reload/u.test(row.error)));
  assert.equal(report.downloads, 0);
});

test('exact original Hydropure evidence replays 2040g even with no remaining URL cache', async (t) => {
  const { app, store } = await setup(t);
  const bytes = await readFile(
    new URL(
      '../docs/acceptance/bonus-hydropure-evidence/3095127497-14849213302-public.html',
      import.meta.url
    )
  );
  const hash =
    '55616c2c7fce2641eb592a39517f29d3371ed5dd48585c1c1a0f7100331ec852';
  assert.equal(sha256(bytes), hash);
  await store.put('publication', {
    id: 'publication:exact-Hydropure-original',
    sourceUrl:
      'https://www.lazada.vn/products/pdp-i3095127497.html?skuId=14849213302',
    sku: '3095127497_VNAMZ-14849213302',
    observedAt: '2026-10-10T15:35:24.245Z',
    html: await store.putBlob(bytes),
  });
  prohibitNavigation(app);
  const report = await replayHistoricalCaptures(app);
  assert.equal(report.errors, 0);
  assert.equal(report.reprocessed, 1);
  const [product] = await store.list('product');
  const [offer] = await store.list('offer');
  assert.equal(product.netMassG, 2040);
  assert.equal(product.proteinPer100g, undefined);
  assert.equal(product.manufacturerVerification, undefined);
  assert.equal(offer.sku, '3095127497_VNAMZ-14849213302');
  assert.equal(offer.price, 999997);
  assert.equal(offer.observedAt, '2026-10-10T15:35:24.245Z');
  assert.equal(report.results[0].sourceSha256, hash);
  assert.deepEqual(await store.list('cache'), []);
});

test('historical replay requires offline mode and chronological writes', async (t) => {
  const { app } = await setup(t);
  app.cache.offline = false;
  await assert.rejects(replayHistoricalCaptures(app), /offline application/u);
  app.cache.offline = true;
  app.store.putLatest = undefined;
  await assert.rejects(
    replayHistoricalCaptures(app),
    /chronological store writes/u
  );
});

test('same-observation replay retains reviewed factory quantities and seller counterclaims', async (t) => {
  const { app, store } = await setup(t);
  const capture = await captured(app);
  const reviewed = {
    ...capture.product,
    netMassG: 2050,
    proteinPer100g: 80,
    reviewedFields: ['netMassG', 'proteinPer100g'],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'manufacturer:fixture-review',
    },
  };
  await store.put('product', reviewed);
  prohibitNavigation(app);
  const report = await replayHistoricalCaptures(app);
  assert.equal(report.errors, 0);
  const result = await store.get('product', capture.product.id);
  assert.equal(result.netMassG, 2050);
  assert.equal(result.proteinPer100g, 80);
  assert.deepEqual(
    result.manufacturerVerification,
    reviewed.manufacturerVerification
  );
  assert.ok(
    result.claims.some(
      (claim) => claim.field === 'netMassG' && claim.value === 2040
    )
  );
});

test('private replay uses shared original evidence but never writes its source store or copies account observations into public data', async (t) => {
  const { app, store: shared } = await setup(t);
  const publicCapture = await captured(app);
  const sourceKinds = await shared.kinds();
  const before = await Promise.all(
    sourceKinds.map((kind) => shared.list(kind))
  );
  const privateStore = new AssociativeStore({
    directory: join(shared.directory, 'account'),
    visibility: 'private',
    fallback: shared,
  });
  const privateApp = new LazadaSearch({
    store: privateStore,
    offline: true,
    ocr: false,
  });
  t.after(() => privateApp.close());
  await captured(privateApp, { sku: '12', price: '200.000' }, t2);
  const cache = await privateStore.list('cache');
  prohibitNavigation(privateApp);
  const report = await replayHistoricalCaptures(privateApp);
  assert.equal(report.errors, 0);
  assert.equal(report.visibility, 'private');
  assert.equal(report.downloads, 0);
  assert.ok(report.results.some((row) => row.sku === publicCapture.offer.sku));
  assert.ok(report.results.some((row) => row.sku === '100_VNAMZ-12'));
  assert.deepEqual(await privateStore.list('cache'), cache);
  assert.deepEqual(
    await Promise.all(sourceKinds.map((kind) => shared.list(kind))),
    before
  );
  assert.equal((await shared.list('offer')).length, 1);
  assert.equal((await privateStore.list('offer')).length, 2);
});

test('real offline replay script covers historical and latest SKU sources in an isolated repository directory', async (t) => {
  const { app, store } = await setup(t);
  const old = await captured(app);
  await captured(app, { sku: '12', price: '300.000' }, t2);
  await store.put('product', { ...old.product, netMassG: 4.5 * 453.59237 });
  const cache = await store.list('cache');
  await mkdir(join(store.directory, 'docs', 'acceptance'), { recursive: true });
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(
        new URL('../scripts/reprocess-public-captures.mjs', import.meta.url)
      ),
      '--offline',
      '--no-ocr',
      '--no-archive',
      '--data-dir',
      store.directory,
    ],
    { cwd: store.directory, timeout: 30000 }
  );
  const summary = JSON.parse(stdout);
  assert.equal(summary.errors, 0);
  assert.equal(summary.reprocessed, 2);
  assert.equal(summary.downloads, 0);
  const receipt = JSON.parse(
    await readFile(
      join(store.directory, 'docs', 'acceptance', 'offline-reprocessing.json')
    )
  );
  const historical = receipt.results.find((row) => row.sku === old.offer.sku);
  assert.equal(historical.observedAt, t1);
  assert.equal(historical.netMassG, 2040);
  assert.equal(historical.price, 250000);
  assert.equal((await store.get('product', old.product.id)).netMassG, 2040);
  assert.deepEqual(await store.list('cache'), cache);
});
