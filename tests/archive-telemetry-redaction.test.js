import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RepositoryArchive,
  exportRepositoryArchive,
  sanitizePublicData,
  sanitizePublicHtml,
} from '../src/archive.js';
import { AssociativeStore } from '../src/store.js';

const pixel = Buffer.from(
  '47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b',
  'hex'
);

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-telemetry-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'working') });
  const target = join(directory, 'public');
  return { directory, store, target };
}

test('public privacy filtering removes telemetry identities recursively while preserving exact product queries', () => {
  const url =
    'https://www.lazada.vn/products/pdp-i42.html?skuId=420&cna=synthetic-browser-id&ckx=synthetic-page-id&ASID=synthetic-session-id';
  const nested = `https://redirect.example/visit?url=${encodeURIComponent(url)}`;
  const result = sanitizePublicData({
    url,
    nested,
    html: `<a href="${url.replaceAll('&', '&amp;')}">Whey500g</a>`,
    cna: 'synthetic-browser-id',
    facts: {
      CKX: 'synthetic-page-id',
      asid: 'synthetic-session-id',
      netMassG: 500,
    },
  });
  assert.equal(
    result.url,
    'https://www.lazada.vn/products/pdp-i42.html?skuId=420'
  );
  assert.equal(new URL(result.nested).searchParams.get('url'), result.url);
  assert.match(result.html, /skuId=420/u);
  assert.deepEqual(result.facts, { netMassG: 500 });
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-|(?:amp;)?cna=|ckx=|ASID=/u
  );
  assert.deepEqual(sanitizePublicData(result), result);

  const event = `https://sg.mmstat.com/event?cna=synthetic-browser-id&gokey=${encodeURIComponent(
    'skuId=420&ckx=synthetic-page-id&asid=synthetic-session-id'
  )}#synthetic-fragment-id`;
  assert.equal(sanitizePublicData(event), 'https://sg.mmstat.com/event');
  assert.equal(
    sanitizePublicData(
      `https://redirect.example/visit?url=${encodeURIComponent(event)}`
    ),
    `https://redirect.example/visit?url=${encodeURIComponent(
      'https://sg.mmstat.com/event'
    )}`
  );
  assert.equal(
    sanitizePublicData(
      'https://sg.mmstat.com.evil.example/product?skuId=420&cna=synthetic-browser-id'
    ),
    'https://sg.mmstat.com.evil.example/product?skuId=420'
  );
});

test('HTML publication retains product facts and SKU data while removing telemetry identities from retained links', () => {
  const original =
    '<h1>Chocolate whey500g</h1><span data-product-price>200.000 ₫</span><a href="https://www.lazada.vn/products/pdp-i42.html?skuId=420&amp;cna=synthetic-browser-id">Exact option</a><img src="https://img.lazcdn.com/label.png?skuId=420&amp;ckx=synthetic-page-id"><script type="application/ld+json">{"name":"Chocolate whey","sku":"420","netMassG":500,"cna":"synthetic-browser-id"}</script>';
  const published = sanitizePublicHtml(original);
  assert.match(published, /Chocolate whey500g|200\.000/u);
  assert.match(published, /skuId=420/u);
  assert.match(published, /"netMassG":500/u);
  assert.doesNotMatch(published, /synthetic-|cna|ckx/u);
});

test('nonempty known telemetry pixels are excluded without losing legitimate cache references or product and manufacturer images', async (t) => {
  const { store, target } = await setup(t);
  assert.equal(pixel.length, 43);
  const blob = await store.putBlob(pixel);
  for (const host of ['sg.mmstat.com', 'gm.mmstat.com']) {
    const url = `https://${
      host
    }/event?cna=synthetic-browser-id&gokey=ckx%3Dsynthetic-page-id`;
    await store.put('cache', {
      id: `image:${url}`,
      url,
      blob,
      contentType: 'image/gif',
    });
  }
  const productUrl =
    'https://www.lazada.vn/products/pdp-i42.html?skuId=420&cna=synthetic-browser-id';
  const sourceId = `page:${productUrl}`;
  const html = await store.putBlob(
    '<h1>Chocolate whey500g</h1><span data-product-price>200.000 ₫</span>'
  );
  await store.put('cache', {
    id: sourceId,
    url: productUrl,
    html,
    status: 'ok',
    snapshot: { url: productUrl, title: 'Chocolate whey500g' },
  });
  for (const url of [
    'https://img.lazcdn.com/product-label.gif',
    'https://sg.mmstat.com.evil.example/product-label.gif',
  ]) {
    await store.put('cache', {
      id: `image:${url}`,
      url,
      blob,
      contentType: 'image/gif',
    });
  }
  const label = await store.putBlob(
    '<svg><text>Protein25g; net weight500g</text></svg>'
  );
  await store.put('manufacturer-source', {
    id: 'manufacturer-label',
    url: 'https://factory.example/label.svg',
    contentType: 'image/svg+xml',
    blob: label,
  });
  await store.put('product', {
    id: 'p42',
    title: 'Chocolate whey500g',
    netMassG: 500,
    sourceCacheId: sourceId,
  });
  const result = await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  assert.equal(result.records, 5);
  assert.equal(
    (await archive.manifest()).excluded.nonProductTelemetryResponses,
    2
  );
  const caches = await archive.list('cache');
  assert.equal(caches.length, 3);
  assert.ok(
    caches.every(
      (row) =>
        !['sg.mmstat.com', 'gm.mmstat.com'].includes(new URL(row.url).hostname)
    )
  );
  const product = await archive.get('product', 'p42');
  assert.equal(product.netMassG, 500);
  assert.equal(
    product.sourceCacheId,
    'page:https://www.lazada.vn/products/pdp-i42.html?skuId=420'
  );
  assert.ok(await archive.get('cache', product.sourceCacheId));
  assert.deepEqual(await archive.blob(blob.sha256), pixel);
  assert.deepEqual(
    await archive.blob(label.sha256),
    await store.blob(label.sha256)
  );
  assert.ok(
    (await archive.graph('product', 'p42')).names.has('record:product:p42')
  );
  assert.deepEqual(await archive.verify(), {
    valid: true,
    records: 5,
    blobs: 3,
    downloads: 0,
  });
});

test('unreferenced telemetry bodies disappear and exclusion counts survive idempotent and archive-only re-export', async (t) => {
  const { directory, store, target } = await setup(t);
  const blob = await store.putBlob(pixel);
  await store.put('cache', {
    id: 'image:https://sg.mmstat.com/event?cna=synthetic-browser-id',
    url: 'https://sg.mmstat.com/event?cna=synthetic-browser-id',
    blob,
    contentType: 'image/gif',
  });
  await store.put('product', {
    id: 'p42',
    title: 'Chocolate whey',
    netMassG: 500,
  });
  const first = await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  assert.equal(first.records, 1);
  assert.equal(first.blobs, 0);
  assert.equal(await archive.blob(blob.sha256), undefined);
  assert.deepEqual(await archive.list('cache'), []);
  assert.equal((await archive.verify()).valid, true);
  const second = await exportRepositoryArchive({ store, directory: target });
  assert.equal(second.rebuilt, 0);
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  const replayTarget = join(directory, 'replay');
  await exportRepositoryArchive({ store: fresh, directory: replayTarget });
  const replay = new RepositoryArchive({ directory: replayTarget });
  assert.equal(
    (await replay.manifest()).excluded.nonProductTelemetryResponses,
    1
  );
  assert.deepEqual(
    await replay.get('product', 'p42'),
    await archive.get('product', 'p42')
  );
  assert.equal((await replay.verify()).valid, true);
});

test('telemetry origin filtering never discards failed or challenged outcomes or clears a collection stop', async (t) => {
  const { store, target } = await setup(t);
  const body = await store.putBlob('<h1>Verify you are human</h1>');
  for (const status of ['failed', 'challenge']) {
    const url = `https://sg.mmstat.com/${status}?cna=synthetic-browser-id`;
    await store.put('cache', {
      id: `page:${url}`,
      url,
      blob: body,
      status,
      contentType: 'text/html',
      challenge: { detected: status === 'challenge' },
    });
  }
  await store.put('cache', {
    id: 'page:https://sg.mmstat.com/empty-challenge',
    url: 'https://sg.mmstat.com/empty-challenge',
    blob: await store.putBlob(Buffer.alloc(0)),
    status: 'challenge',
    httpStatus: 403,
    challenge: { detected: true },
  });
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
    origin: 'https://sg.mmstat.com',
  });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  assert.equal(
    (await archive.manifest()).excluded.nonProductTelemetryResponses,
    0
  );
  assert.equal((await archive.manifest()).excluded.emptyTrackingResponses, 0);
  assert.deepEqual(
    (await archive.list('cache')).map((row) => row.status).sort(),
    ['challenge', 'challenge', 'failed']
  );
  assert.equal(
    (await archive.get('collection-stop', 'browser-collection')).active,
    true
  );
  assert.equal((await archive.verify()).valid, true);
});

test('plain-source telemetry URL redaction retains original SHA provenance across archive-only replay', async (t) => {
  const { directory, store, target } = await setup(t);
  const original = await store.putBlob(
    'Chocolate whey500g; Protein25g. Product https://factory.example/product?skuId=420&cna=synthetic-browser-id. Event https://sg.mmstat.com/event?gokey=ckx%3Dsynthetic-page-id'
  );
  await store.put('manufacturer-source', {
    id: 'plain-specs',
    url: 'https://factory.example/product?skuId=420',
    contentType: 'text/plain',
    blob: original,
    originalSourceSha256: original.sha256,
  });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const saved = await archive.get('manufacturer-source', 'plain-specs');
  const bytes = await archive.blob(saved.blob.sha256);
  assert.match(bytes.toString(), /Chocolate whey500g; Protein25g/u);
  assert.match(bytes.toString(), /skuId=420/u);
  assert.doesNotMatch(bytes.toString(), /synthetic-|cna=|ckx%3D/u);
  assert.notEqual(saved.blob.sha256, original.sha256);
  assert.equal(saved.originalSourceSha256, original.sha256);
  const rewrite = (await archive.manifest()).sourceRewrites.find(
    (row) => row.originalSha256 === original.sha256
  );
  assert.equal(rewrite.archivedSha256, saved.blob.sha256);
  assert.equal((await archive.verify()).valid, true);
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  const replayTarget = join(directory, 'replay');
  await exportRepositoryArchive({ store: fresh, directory: replayTarget });
  const replay = new RepositoryArchive({ directory: replayTarget });
  assert.deepEqual(await replay.blob(saved.blob.sha256), bytes);
  assert.deepEqual(
    (await replay.manifest()).sourceRewrites,
    (await archive.manifest()).sourceRewrites
  );
  assert.equal((await replay.verify()).valid, true);
});
