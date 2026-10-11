import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { performance } from 'node:perf_hooks';
import {
  AssociativeStore,
  LazadaSearch,
  extractPage,
  publishAccountCaptures,
} from '../src/index.js';

const firstTime = Date.parse('2026-10-09T09:00:00Z');
const secondTime = Date.parse('2026-10-10T09:00:00Z');
const html = (sku = '11', price = '250.000', shipping = '51.100') =>
  `<h1>Fixture whey isolate chocolate 500g</h1><div id="myAccountTrigger">Fictional private customer</div><div data-product-price>${price} ₫</div><div data-seller>Fixture seller</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-${sku}</span></div><div class="delivery-v2"><span class="location-v2__address">Khánh Hòa, Phường Nha Trang</span>Phí vận chuyển ${shipping} ₫</div><script>window.sessionToken='fictional-private';</script>`;

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-publication-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const source = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  app.collector.page = () => {
    throw new Error('Publication must not call a browser');
  };
  t.after(() => app.close());
  return { shared, source, app };
}

async function capture(
  source,
  {
    sku = '11',
    price = '250.000',
    shipping = '51.100',
    fetchedAt = firstTime,
  } = {}
) {
  const url = `https://www.lazada.vn/products/fixture-whey-i100-s${sku}.html`;
  const text = html(sku, price, shipping);
  const { document } = parseHTML(text);
  return await source.put('cache', {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    status: 'ok',
    fetchedAt,
    snapshot: extractPage({ document, url }),
    html: await source.putBlob(text),
  });
}

test('unchanged verified original reuses public output without importing or touching prices and source aliases', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  const started = performance.now();
  const initial = await publishAccountCaptures(app, source);
  const fullMs = performance.now() - started;
  assert.equal(initial.published.length, 1);
  assert.equal(initial.reused, 0);
  const [proof] = await shared.list('publication-source');
  assert.equal(proof.sourceHtmlSha256, original.html.sha256);
  assert.match(proof.sourceSnapshotSha256, /^[a-f\d]{64}$/u);
  assert.match(proof.pipelineFingerprint, /^[a-f\d]{64}$/u);
  assert.equal(proof.sku, '100_VNAMZ-11');
  assert.equal(proof.price, 250000);
  assert.equal(proof.observedAt, new Date(firstTime).toISOString());
  assert.doesNotMatch(
    JSON.stringify(proof),
    /Fictional private|fictional-private/u
  );
  assert.equal(await shared.blob(original.html.sha256), undefined);
  const cache = await shared.list('cache');
  const offers = await shared.list('offer');
  app.importCapture = () => {
    throw new Error('Cached publication must not parse or import DOM');
  };
  const replayStarted = performance.now();
  const replay = await publishAccountCaptures(app, source);
  t.diagnostic(
    `Publication fixture full=${fullMs.toFixed(2)}ms cached=${(performance.now() - replayStarted).toFixed(2)}ms; cached DOM imports=0`
  );
  assert.deepEqual(replay.published, initial.published);
  assert.equal(replay.reused, 1);
  assert.deepEqual(replay.rejected, []);
  assert.equal(replay.downloads, 0);
  assert.deepEqual(await shared.list('cache'), cache);
  assert.deepEqual(await shared.list('offer'), offers);
  assert.equal((await shared.list('publication-source')).length, 1);
});

test('changed snapshot and original HTML both invalidate source reuse while retaining original history', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  const first = await publishAccountCaptures(app, source);
  const importCapture = app.importCapture;
  let imports = 0;
  app.importCapture = function (value) {
    imports += 1;
    return importCapture.call(this, value);
  };
  await source.put('cache', {
    ...original,
    snapshot: {
      ...original.snapshot,
      description: 'Declared selling size 500 g',
    },
  });
  const snapshotChanged = await publishAccountCaptures(app, source);
  assert.equal(imports, 1);
  assert.equal(snapshotChanged.reused, 0);
  assert.deepEqual(snapshotChanged.published, first.published);
  await capture(source, { price: '200.000', fetchedAt: secondTime });
  const second = await publishAccountCaptures(app, source);
  assert.equal(imports, 2);
  assert.equal(second.reused, 0);
  assert.equal(second.published[0].price, 200000);
  assert.deepEqual(second.historicalPublished, first.published);
  assert.equal((await shared.list('publication-source')).length, 3);
});

test('a producer fingerprint mismatch reapplies parser corrections even when publication ID already exists', async (t) => {
  const { shared, source, app } = await setup(t);
  await capture(source);
  const initial = await publishAccountCaptures(app, source);
  const [proof] = await shared.list('publication-source');
  await shared.put('publication-source', {
    ...proof,
    pipelineFingerprint: 'previous-parser-redaction',
  });
  const [product] = await shared.list('product');
  await shared.put('product', { ...product, netMassG: 4.5 * 453.59237 });
  const refreshed = await publishAccountCaptures(app, source);
  assert.equal(refreshed.reused, 0);
  assert.deepEqual(refreshed.rejected, []);
  assert.equal(refreshed.published[0].id, initial.published[0].id);
  assert.equal((await shared.get('product', product.id)).netMassG, 500);
  assert.equal(
    (await shared.get('product', product.id)).observedAt,
    product.observedAt
  );
  const fast = await publishAccountCaptures(app, source);
  assert.equal(fast.reused, 1);
});

test('cached publication repairs changed unreviewed facts and retains genuine reviewed manufacturer quantities', async (t) => {
  const { shared, source, app } = await setup(t);
  await capture(source);
  await publishAccountCaptures(app, source);
  const [product] = await shared.list('product');
  await shared.put('product', { ...product, netMassG: 510 });
  const corrected = await publishAccountCaptures(app, source);
  assert.equal(corrected.reused, 0);
  assert.equal((await shared.get('product', product.id)).netMassG, 500);
  await shared.put('product', {
    ...product,
    netMassG: 510,
    reviewedFields: ['netMassG'],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'fixture:factory',
    },
  });
  const reviewed = await publishAccountCaptures(app, source);
  assert.equal(reviewed.reused, 0);
  assert.equal((await shared.get('product', product.id)).netMassG, 510);
  const replay = await publishAccountCaptures(app, source);
  assert.equal(replay.reused, 1);
});

test('rebuilding an older original keeps newer prices, delivery quotes and listing/SKU aliases', async (t) => {
  const { shared, source, app } = await setup(t);
  const old = await capture(source);
  const first = await publishAccountCaptures(app, source);
  await capture(source, {
    price: '200.000',
    shipping: '60.000',
    fetchedAt: secondTime,
  });
  const second = await publishAccountCaptures(app, source);
  const cache = await shared.list('cache');
  const [current] = await shared.list('offer');
  assert.equal(current.price, 200000);
  assert.equal(current.shipping, 60000);
  const oldProof = (await shared.list('publication-source')).find(
    (row) => row.price === 250000
  );
  await shared.put('publication-source', {
    ...oldProof,
    pipelineFingerprint: 'old-producer',
  });
  await source.put('cache', old);
  const oldRebuild = await publishAccountCaptures(app, source);
  assert.equal(oldRebuild.reused, 0);
  assert.deepEqual(oldRebuild.rejected, []);
  assert.deepEqual(oldRebuild.published, first.published);
  assert.deepEqual(oldRebuild.historicalPublished, second.published);
  assert.deepEqual(await shared.list('cache'), cache);
  assert.equal((await shared.get('offer', current.id)).price, 200000);
  assert.equal((await shared.get('offer', current.id)).shipping, 60000);
  assert.equal(
    (await shared.get('offer', current.id)).quoteObservedAt,
    new Date(secondTime).toISOString()
  );
});

test('same listing sibling publication retains the newer base cache during old-code reprocessing', async (t) => {
  const { shared, source, app } = await setup(t);
  await capture(source);
  await publishAccountCaptures(app, source);
  await capture(source, { sku: '12', price: '300.000', fetchedAt: secondTime });
  await publishAccountCaptures(app, source);
  const listingCacheId =
    'lazada:vn:Nha Trang:https://www.lazada.vn/products/pdp-i100.html';
  const newer = await shared.get('cache', listingCacheId);
  assert.equal(newer.snapshot.sku, '100_VNAMZ-12');
  const olderProof = (await shared.list('publication-source')).find(
    (record) => record.sku === '100_VNAMZ-11'
  );
  await shared.put('publication-source', {
    ...olderProof,
    pipelineFingerprint: 'old-producer',
  });
  const replay = await publishAccountCaptures(app, source);
  assert.deepEqual(replay.rejected, []);
  assert.equal(replay.published.length, 2);
  assert.deepEqual(await shared.get('cache', listingCacheId), newer);
  assert.equal((await shared.list('offer')).length, 2);
});

test('fast reuse verifies both private originals and public bytes and refuses private public-output metadata', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  const initial = await publishAccountCaptures(app, source);
  const privateBlob = source.blob.bind(source);
  source.blob = async () => undefined;
  const missingOriginal = await publishAccountCaptures(app, source);
  assert.equal(missingOriginal.published.length, 0);
  assert.match(
    missingOriginal.rejected[0].reason,
    /digest is invalid or missing/u
  );
  source.blob = privateBlob;
  const publicBlob = shared.blob.bind(shared);
  shared.blob = async (hash) =>
    hash === initial.published[0].html.sha256
      ? Buffer.from('corrupt derived output')
      : publicBlob(hash);
  const corruptOutput = await publishAccountCaptures(app, source);
  assert.equal(corruptOutput.reused, 0);
  assert.equal(corruptOutput.published.length, 0);
  assert.match(corruptOutput.rejected[0].reason, /Public output HTML digest/u);
  shared.blob = publicBlob;
  const [proof] = await shared.list('publication-source');
  await shared.put('publication-source', { ...proof, visibility: 'private' });
  const privateReceipt = await publishAccountCaptures(app, source);
  assert.equal(privateReceipt.published.length, 0);
  assert.match(
    privateReceipt.rejected[0].reason,
    /Private publication receipts/u
  );
  assert.equal(
    (await source.get('cache', original.id)).html.sha256,
    original.html.sha256
  );
  assert.equal(privateReceipt.downloads, 0);
  await shared.put('publication-source', proof);
  await shared.put('publication', {
    ...initial.published[0],
    visibility: 'private',
    accountLabel: 'fictional account',
  });
  const privateOutput = await publishAccountCaptures(app, source);
  assert.equal(privateOutput.published.length, 0);
  assert.deepEqual(privateOutput.allPublished, []);
  assert.match(
    privateOutput.rejected[0].reason,
    /Private publication records/u
  );
});

test('newly cached original label images invalidate source reuse and become reusable public evidence', async (t) => {
  const { shared, source, app } = await setup(t);
  const imageUrl = 'https://cdn.example/fixture-original-label.png';
  const original = await capture(source);
  const bytes = `${html()}<img data-product-image src="${imageUrl}">`;
  const { document } = parseHTML(bytes);
  await source.put('cache', {
    ...original,
    html: await source.putBlob(bytes),
    snapshot: extractPage({ document, url: original.url }),
  });
  const first = await publishAccountCaptures(app, source);
  assert.deepEqual(first.rejected, []);
  assert.equal(await shared.get('cache', `image:${imageUrl}`), undefined);
  const label = await source.putBlob('fixture original nutrition label bytes');
  await source.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    blob: label,
    contentType: 'image/png',
    fetchedAt: firstTime,
  });
  const withLabel = await publishAccountCaptures(app, source);
  assert.equal(withLabel.reused, 0);
  assert.deepEqual(withLabel.published, first.published);
  assert.equal(
    (await shared.get('cache', `image:${imageUrl}`)).blob.sha256,
    label.sha256
  );
  assert.equal(
    (await shared.blob(label.sha256)).toString(),
    'fixture original nutrition label bytes'
  );
  const fast = await publishAccountCaptures(app, source);
  assert.equal(fast.reused, 1);
  assert.equal(fast.downloads, 0);
});
