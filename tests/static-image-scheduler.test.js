import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler, EvidenceCache } from '../src/cache.js';
import { serveBrowserImage } from '../src/browser-image-cache.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-static-scheduler-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  return { store, cache: new EvidenceCache({ store, ...options }) };
}

function response(url, location) {
  return {
    url,
    status: location ? 302 : 200,
    headers: new globalThis.Headers({
      'content-type': location ? 'text/plain' : 'image/png',
      ...(location ? { location } : {}),
    }),
    body: [location ? Buffer.from('Original redirect response') : png],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => (resolve = accept));
  return { promise, resolve };
}

function cancelAcquisition() {
  const error = new Error('Capture has ended');
  error.code = 'IMAGE_ACQUISITION_DEFERRED';
  throw error;
}

test('only genuine Lazada static hosts use the optional image scheduler; page pacing and redirect proofs remain intact', async (t) => {
  const calls = [];
  const waits = [];
  const tracked = (name, intervalMs) => {
    const scheduler = new DomainScheduler({
      intervalMs,
      sleep: async (wait) => waits.push({ name, wait }),
    });
    const run = scheduler.run.bind(scheduler);
    scheduler.run = (url, action, options) => {
      calls.push({ name, url });
      return run(url, action, options);
    };
    return scheduler;
  };
  const scheduler = tracked('page', 60000);
  const staticImageScheduler = tracked('static', 1000);
  const { cache, store } = await fixture(t, {
    scheduler,
    staticImageScheduler,
  });
  const page = 'https://www.lazada.vn/products/pdp-i1.html';
  scheduler.last.set('www.lazada.vn', Date.now());
  await cache.get(page, { load: async () => ({ status: 'ok' }) });
  const chain = [
    'https://img.lazcdn.com/start.png',
    'https://factory.example/redirect.png',
    'https://vn-test.slatic.net/label.png',
  ];
  for (const url of chain) {
    const selected = url.includes('factory.example')
      ? scheduler
      : staticImageScheduler;
    selected.last.set(new URL(url).hostname, Date.now());
  }
  const guards = [];
  const image = await cache.image(chain[0], {
    requestGuard: (url) => guards.push(url),
    fetchImage: async (url) => response(url, chain[chain.indexOf(url) + 1]),
  });
  assert.equal(image.finalUrl, chain[2]);
  assert.equal(image.redirects.length, 2);
  assert.equal((await store.list('image-source-hop')).length, 2);
  assert.deepEqual(
    guards,
    chain.flatMap((url) => [url, url, url, url])
  );
  for (const host of [
    'lazcdn.com',
    'slatic.net',
    'evillazcdn.com',
    'img.lazcdn.com.evil.example',
  ]) {
    const url = `https://${host}/label.png`;
    await cache.image(url, { fetchImage: async () => response(url) });
  }
  assert.deepEqual(calls, [
    { name: 'page', url: page },
    { name: 'static', url: chain[0] },
    { name: 'page', url: chain[1] },
    { name: 'static', url: chain[2] },
    { name: 'static', url: 'https://lazcdn.com/label.png' },
    { name: 'static', url: 'https://slatic.net/label.png' },
    { name: 'page', url: 'https://evillazcdn.com/label.png' },
    { name: 'page', url: 'https://img.lazcdn.com.evil.example/label.png' },
  ]);
  assert.ok(
    waits
      .filter((row) => row.name === 'page')
      .every((row) => row.wait > 50000 && row.wait <= 60000)
  );
  assert.equal(waits.filter((row) => row.name === 'page').length, 2);
  assert.equal(waits.filter((row) => row.name === 'static').length, 2);
  assert.ok(
    waits
      .filter((row) => row.name === 'static')
      .every((row) => row.wait > 0 && row.wait <= 1000)
  );
});

test('omitting the optional static scheduler preserves existing host scheduling', async (t) => {
  const calls = [];
  const scheduler = {
    run: (url, action) => {
      calls.push(url);
      return action();
    },
  };
  const { cache } = await fixture(t, { scheduler });
  const url = 'https://img.lazcdn.com/label.png';
  await cache.image(url, { fetchImage: async () => response(url) });
  assert.deepEqual(calls, [url]);
  assert.throws(
    () => new EvidenceCache({ staticImageScheduler: {} }),
    /staticImageScheduler/u
  );
});

test('a queued acquisition cancelled before its paced action makes no request or negative cache entry and can retry', async (t) => {
  const staticImageScheduler = new DomainScheduler({ intervalMs: 0 });
  const { cache, store } = await fixture(t, { staticImageScheduler });
  const url = 'https://img.lazcdn.com/label.png';
  const release = deferred();
  const queued = deferred();
  const first = staticImageScheduler.run(url, () => release.promise);
  let cancelled = false;
  const acquisition = cache.image(url, {
    requestGuard: () => {
      if (cancelled) {
        cancelAcquisition();
      }
      queued.resolve();
    },
    fetchImage: () =>
      assert.fail('Cancelled queue must never request the source'),
  });
  await queued.promise;
  cancelled = true;
  release.resolve();
  await first;
  await assert.rejects(acquisition, { code: 'IMAGE_ACQUISITION_DEFERRED' });
  assert.equal(await store.get('cache', `image:${url}`), undefined);
  assert.equal(cache.pending.size, 0);
  assert.equal(cache.stats.downloads, 0);
  const image = await cache.image(url, {
    fetchImage: async () => response(url),
  });
  assert.equal(image.status, 'captured');
  assert.deepEqual(await store.blob(image.blob.sha256), png);
});

test('cancelled queued host actions skip pacing and an action cancelled during pacing never starts transport', async () => {
  const waits = [];
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: async (wait) => waits.push(wait),
  });
  const url = 'https://img.lazcdn.com/label.png';
  const started = deferred();
  const release = deferred();
  const first = scheduler.run(url, async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  let cancelled = false;
  const results = Promise.allSettled(
    Array.from({ length: 5 }, () =>
      scheduler.run(
        url,
        () => assert.fail('Cancelled queued transport must not start'),
        {
          beforePace: () => {
            if (cancelled) {
              cancelAcquisition();
            }
          },
        }
      )
    )
  );
  cancelled = true;
  release.resolve();
  await first;
  const stopped = await results;
  assert.ok(
    stopped.every(
      (row) =>
        row.status === 'rejected' &&
        row.reason.code === 'IMAGE_ACQUISITION_DEFERRED'
    )
  );
  assert.deepEqual(waits, []);
  cancelled = false;
  scheduler.sleep = async (wait) => {
    waits.push(wait);
    cancelled = true;
  };
  await assert.rejects(
    scheduler.run(
      url,
      () => assert.fail('Transport cancelled during pacing must not start'),
      {
        beforePace: () => {
          if (cancelled) {
            cancelAcquisition();
          }
        },
      }
    ),
    { code: 'IMAGE_ACQUISITION_DEFERRED' }
  );
  assert.equal(waits.length, 1);
});

test('cancelling the next redirect preserves its acquired hop without a negative final source or another request', async (t) => {
  const { cache, store } = await fixture(t, {
    staticImageScheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const initial = 'https://img.lazcdn.com/start.png';
  const final = 'https://img.lazcdn.com/final.png';
  const requests = [];
  await assert.rejects(
    cache.image(initial, {
      requestGuard: (url) => {
        if (url === final) {
          cancelAcquisition();
        }
      },
      fetchImage: async (url) => {
        requests.push(url);
        return response(url, final);
      },
    }),
    { code: 'IMAGE_ACQUISITION_DEFERRED' }
  );
  assert.deepEqual(requests, [initial]);
  assert.equal(await store.get('cache', `image:${initial}`), undefined);
  const [hop] = await store.list('image-source-hop');
  assert.equal(hop.httpStatus, 302);
  assert.equal(hop.url, initial);
  assert.deepEqual(
    await store.blob(hop.blob.sha256),
    Buffer.from('Original redirect response')
  );
});

test('cancellation during beforeDownload is checked immediately before transport without replacing an older usable source', async (t) => {
  const { cache, store } = await fixture(t, {
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const url = 'https://img.lazcdn.com/label.png';
  await cache.image(url, { fetchImage: async () => response(url) });
  const original = await store.get('cache', `image:${url}`);
  let cancelled = false;
  cache.beforeDownload = () => {
    cancelled = true;
  };
  await assert.rejects(
    cache.image(url, {
      refresh: true,
      requestGuard: () => {
        if (cancelled) {
          cancelAcquisition();
        }
      },
      fetchImage: () => assert.fail('Cancelled transport must not start'),
    }),
    { code: 'IMAGE_ACQUISITION_DEFERRED' }
  );
  assert.deepEqual(await store.get('cache', `image:${url}`), original);
});

test('an AbortError request guard leaves the image source uncached', async (t) => {
  const { cache, store } = await fixture(t);
  const url = 'https://img.lazcdn.com/label.png';
  await assert.rejects(
    cache.image(url, {
      requestGuard: () => {
        throw new globalThis.DOMException('Capture ended', 'AbortError');
      },
      fetchImage: () => assert.fail('No cancelled source request'),
    }),
    { name: 'AbortError' }
  );
  assert.equal(await store.get('cache', `image:${url}`), undefined);
});

test('browser capture guard is rechecked after queuing and never bypasses the same-page-host guard', async (t) => {
  const staticImageScheduler = new DomainScheduler({ intervalMs: 0 });
  const { cache, store } = await fixture(t, { staticImageScheduler });
  const url = 'https://img.lazcdn.com/label.png';
  const release = deferred();
  const queued = deferred();
  const first = staticImageScheduler.run(url, () => release.promise);
  const actions = [];
  const route = {
    request: () => ({ url: () => url }),
    abort: async () => actions.push('abort'),
    fetch: () => assert.fail('Cancelled browser route must not request'),
    fulfill: () => assert.fail('Cancelled browser route must not fulfill'),
  };
  let guards = 0;
  let cancelled = false;
  const acquisition = serveBrowserImage({
    route,
    cache,
    activePageUrl: 'https://www.lazada.vn/products/pdp-i1.html',
    requestGuard: () => {
      if (cancelled) {
        cancelAcquisition();
      }
      if (++guards === 2) {
        queued.resolve();
      }
    },
  });
  await queued.promise;
  cancelled = true;
  release.resolve();
  await Promise.all([first, acquisition]);
  assert.deepEqual(actions, ['abort']);
  assert.equal(await store.get('cache', `image:${url}`), undefined);
  actions.length = 0;
  await serveBrowserImage({
    route,
    cache,
    activePageUrl: 'https://img.lazcdn.com/product',
    requestGuard: () => {},
  });
  assert.deepEqual(actions, ['abort']);
  assert.equal(await store.get('cache', `image:${url}`), undefined);
});

test('a static-CDN redirect challenge still stops all later static and page-host requests', async (t) => {
  const { cache, store } = await fixture(t, {
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    staticImageScheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const url = 'https://img.lazcdn.com/label.png';
  const challenge = Buffer.from(
    '<title>Captcha</title><body>Verify you are human</body>'
  );
  await assert.rejects(
    cache.image(url, {
      fetchImage: async () => ({
        ...response(url, 'https://factory.example/label.png'),
        headers: new globalThis.Headers({
          'content-type': 'text/html',
          location: 'https://factory.example/label.png',
        }),
        body: [challenge],
      }),
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  const failed = await store.get('cache', `image:${url}`);
  assert.deepEqual(await store.blob(failed.blob.sha256), challenge);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  for (const next of [
    'https://img.lazcdn.com/next.png',
    'https://factory.example/next.png',
  ]) {
    await assert.rejects(
      cache.image(next, {
        fetchImage: () => assert.fail('No request after challenge'),
      }),
      { code: 'COLLECTION_STOPPED' }
    );
  }
});
