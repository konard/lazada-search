import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { EvidenceCache } from '../src/cache.js';
import {
  serveBrowserImage,
  retainBrowserImage,
} from '../src/browser-image-cache.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-browser-image-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({ store, now: () => 100 });
  return { store, cache };
}

function routeFor(url) {
  const actions = [];
  return {
    actions,
    request: () => ({ url: () => url }),
    continue: async () => actions.push('network'),
    abort: async () => actions.push('abort'),
    fulfill: async (value) => actions.push(value),
    fetch: async (options) => {
      assert.equal(options.maxRedirects, 0);
      actions.push('network');
      return {
        url: () => url,
        status: () => 200,
        headers: () => ({ 'content-type': 'image/png' }),
        body: async () => Buffer.from([137, 80, 78, 71, 1, 2]),
      };
    },
  };
}

for (const withBody of [false, true]) {
  test(`browser image routes preserve negative cache without fulfilling failure bytes (${withBody ? 'body' : 'no body'})`, async (t) => {
    const { store, cache } = await setup(t);
    const url = 'https://img.lazcdn.com/missing.jpg';
    await store.put('cache', {
      id: `image:${url}`,
      url,
      status: 'failed',
      retryAfter: 200,
      contentType: 'image/jpeg',
      httpStatus: 404,
      ...(withBody ? { blob: await store.putBlob('missing') } : {}),
    });
    const route = routeFor(url);
    await serveBrowserImage({ route, cache });
    assert.deepEqual(route.actions, ['abort']);
    const refreshed = routeFor(url);
    await serveBrowserImage({ route: refreshed, cache, refresh: true });
    assert.deepEqual(refreshed.actions, [
      'network',
      {
        body: Buffer.from([137, 80, 78, 71, 1, 2]),
        contentType: 'image/png',
        status: 200,
      },
    ]);
    assert.equal(cache.stats.downloads, 1);
  });
}

test('browser response security challenges retain original bytes and abort later image misses', async (t) => {
  const { store, cache } = await setup(t);
  const url = 'https://img.lazcdn.com/label.jpg';
  const bytes = Buffer.from(
    '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div></body></html>'
  );
  const response = {
    url: () => url,
    status: () => 403,
    headers: () => ({ 'content-type': 'image/jpeg' }),
  };
  await assert.rejects(retainBrowserImage({ response, bytes, cache }), {
    code: 'COLLECTION_STOPPED',
  });
  const record = await store.get('cache', `image:${url}`);
  assert.equal(record.status, 'failed');
  assert.deepEqual(await store.blob(record.blob.sha256), bytes);
  assert.equal(cache.browserImages.size, 0);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  const route = routeFor('https://img.lazcdn.com/next.jpg');
  await assert.rejects(serveBrowserImage({ route, cache }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.deepEqual(route.actions, ['abort']);
});

test('safe browser images retain exact bytes and remain reusable during a stop', async (t) => {
  const { store, cache } = await setup(t);
  const url = 'https://img.lazcdn.com/label.png';
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2]);
  const response = {
    url: () => url,
    status: () => 200,
    headers: () => ({ 'content-type': 'image/png', etag: 'label-v1' }),
  };
  await retainBrowserImage({ response, bytes, cache });
  await store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    url: 'https://example.org/challenge',
  });
  const route = routeFor(url);
  await serveBrowserImage({ route, cache });
  assert.deepEqual(route.actions, [{ body: bytes, contentType: 'image/png' }]);
  assert.equal((await store.get('cache', `image:${url}`)).etag, 'label-v1');
  assert.equal(cache.browserImages.size, 1);
  assert.equal(cache.stats.downloads, 0);
});
