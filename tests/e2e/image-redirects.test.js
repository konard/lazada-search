import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
  COLLECTION_STOP_ID,
} from '../../src/index.js';
import { sha256 } from '../../src/util.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const moved = Buffer.from(
  '<html><head><title>Image moved</title></head><body>Use the original label at the new URL.</body></html>'
);
const challenge = Buffer.from(
  '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div></body></html>'
);

async function fixture(t, { challenged = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-image-redirect-e2e-'));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      path: request.url,
      headers: request.headers,
      at: Date.now(),
    });
    if (request.url === '/product') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        `<!doctype html><html><head><title>Local chocolate whey</title></head><body><h1>Fixture chocolate whey 500g</h1><div data-product-price>80.000 ₫</div><div data-loading="true">Loading original label</div><div data-description>Net weight: 500g. Ingredients: whey protein isolate, cocoa.</div><img id="label" data-product-image width="20" height="20" alt="Original chocolate label" src="${origin}/start.png"><script>const img=document.querySelector('#label');const complete=()=>document.querySelector('[data-loading]')?.remove();img.addEventListener('load',complete);img.addEventListener('error',complete);if(img.complete)complete();</script></body></html>`
      );
    } else if (request.url === '/start.png') {
      response.writeHead(302, {
        'content-type': challenged ? 'image/png' : 'text/html',
        location: '/final.png',
      });
      response.end(challenged ? challenge : moved);
    } else if (request.url === '/final.png') {
      response.writeHead(200, {
        'content-type': 'image/png',
        etag: 'original-local-label-v1',
      });
      response.end(png);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  const store = new AssociativeStore({ directory });
  let observedAt = Date.parse('2026-10-11T16:00:00.000Z');
  const cache = new EvidenceCache({
    store,
    now: () => observedAt,
    scheduler: new DomainScheduler({ intervalMs: 50 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 0,
    maxScrolls: 0,
    captureTimeoutMs: 20000,
    browserOptions: {
      launch: 'engine',
      headless: true,
      persistentWindow: false,
      persistent: false,
      ...(process.env.LAZADA_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.LAZADA_TEST_BROWSER_EXECUTABLE }
        : {}),
    },
  });
  t.after(async () => {
    await collector.close();
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    collector,
    cache,
    store,
    requests,
    imageUrl: `${origin}/start.png`,
    finalUrl: `${origin}/final.png`,
    pageUrl: `http://localhost:${server.address().port}/product`,
    advanceObservation: () => {
      observedAt += 5000;
    },
  };
}

test('real Browser Commander image routes manually fetch, pace and retain exact redirects; cached browser fulfillment preserves original source identity', async (t) => {
  const {
    collector,
    cache,
    store,
    requests,
    imageUrl,
    finalUrl,
    pageUrl,
    advanceObservation,
  } = await fixture(t);
  const capture = await collector.page(pageUrl);
  assert.equal(capture.status, 'ok');
  assert.ok(capture.snapshot.productImages.includes(imageUrl));
  const page = collector.runtime.page;
  await page.waitForFunction(() => {
    const image = globalThis.document.querySelector('#label');
    return image.complete && image.naturalWidth === 1;
  });
  await Promise.all([...collector.imageTasks]);
  const original = await store.get('cache', `image:${imageUrl}`);
  assert.equal(original.finalUrl, finalUrl);
  assert.equal(original.etag, 'original-local-label-v1');
  assert.equal(original.observedAt, '2026-10-11T16:00:00.000Z');
  assert.equal(original.blob.sha256, sha256(png));
  assert.deepEqual(await store.blob(original.blob.sha256), png);
  assert.equal(original.redirects.length, 1);
  const [hop] = await store.list('image-source-hop');
  assert.equal(hop.responseFormat, 'html');
  assert.equal(hop.httpStatus, 302);
  assert.equal(hop.sourceSha256, sha256(moved));
  assert.deepEqual(await store.blob(hop.blob.sha256), moved);
  const imageRequests = requests.filter((request) =>
    request.path.endsWith('.png')
  );
  assert.deepEqual(
    imageRequests.map((request) => request.path),
    ['/start.png', '/final.png']
  );
  assert.ok(imageRequests[1].at - imageRequests[0].at >= 35);
  const userAgent = await page.evaluate(() => globalThis.navigator.userAgent);
  for (const request of imageRequests) {
    assert.equal(request.headers['user-agent'], userAgent);
    assert.match(request.headers.accept, /image/u);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.referer, undefined);
  }
  advanceObservation();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => globalThis.document.querySelector('#label').naturalWidth === 1
  );
  await Promise.all([...collector.imageTasks]);
  assert.deepEqual(await store.get('cache', `image:${imageUrl}`), original);
  assert.deepEqual(
    requests
      .filter((request) => request.path.endsWith('.png'))
      .map((request) => request.path),
    ['/start.png', '/final.png']
  );
  assert.equal(cache.stats.downloads, 2);
  assert.equal(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    undefined
  );
});

test('real Browser Commander rejects an intermediate redirect challenge before requesting the final image and persists its exact original', async (t) => {
  const { collector, cache, store, requests, imageUrl, pageUrl } =
    await fixture(t, { challenged: true });
  await assert.rejects(collector.page(pageUrl), { code: 'COLLECTION_STOPPED' });
  assert.deepEqual(
    requests
      .filter((request) => request.path.endsWith('.png'))
      .map((request) => request.path),
    ['/start.png']
  );
  const failed = await store.get('cache', `image:${imageUrl}`);
  assert.equal(failed.httpStatus, 302);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.sourceSha256, sha256(challenge));
  assert.equal(failed.blob.sha256, sha256(challenge));
  assert.deepEqual(await store.blob(failed.blob.sha256), challenge);
  assert.equal(failed.retryAfter, null);
  assert.equal(cache.browserImages.size, 0);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  await assert.rejects(cache.image(imageUrl), { code: 'COLLECTION_STOPPED' });
  assert.equal(
    requests.filter((request) => request.path.endsWith('.png')).length,
    1
  );
});
