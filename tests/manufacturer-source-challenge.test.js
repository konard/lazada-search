import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler, EvidenceCache } from '../src/cache.js';
import {
  ManufacturerSourceCache,
  manufacturerRequest,
  manufacturerSourceId,
} from '../src/manufacturer-source-cache.js';
import {
  COLLECTION_STOP_ID,
  CollectionStoppedError,
  stopForChallenge,
} from '../src/page-challenge.js';
import { sha256 } from '../src/util.js';

const request = {
  brand: 'Optimum Nutrition',
  url: 'https://www.optimumnutrition.com/en-us/products/gold-standard-whey-naturally-flavored-protein-powder',
};
const registry = [{ brand: request.brand, domains: ['optimumnutrition.com'] }];
const observedAt = '2026-10-11T10:04:26.000Z';
const now = Date.parse(observedAt);
const fixture = gunzipSync(
  await readFile(
    new URL(
      '../docs/acceptance/source-integrity/natural-chocolate-manufacturer/official-natural-whey.http403.public.html.gz',
      import.meta.url
    )
  )
);
assert.equal(
  sha256(fixture),
  'ab14413463ecb558111983f153daf482fb786edf964ed02efe10c5bfc990b490'
);

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manufacturer-challenge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

function sources(store, options = {}) {
  return new ManufacturerSourceCache({
    store,
    registry,
    now: () => now,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    ...options,
  });
}

const cacheId = (input = request) =>
  `manufacturer-request-${manufacturerRequest(input).fingerprint}:${input.url}`;

async function importBytes(cache, input, bytes) {
  return await cache.importOriginal(
    {
      ...input,
      observedAt,
      sourceSha256: sha256(bytes),
      contentType: 'text/html',
      originalArtifact: 'preserved-public-original.html',
    },
    bytes
  );
}

test('a real saved403 challenge preserves failed original cache and source before globally stopping', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const cache = sources(store, {
    fetchSource: async () => {
      calls++;
      return new globalThis.Response(fixture, {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const put = store.put.bind(store);
  store.put = async (kind, record) => {
    if (kind === 'collection-stop') {
      const originalCache = await store.get('cache', cacheId());
      const originalSource = await store.get(
        'manufacturer-source',
        manufacturerSourceId(request)
      );
      assert.equal(originalCache.status, 'failed');
      assert.equal(originalSource.status, 'failed');
      assert.equal(originalCache.blob.sha256, sha256(fixture));
      assert.deepEqual(await store.blob(originalSource.blob.sha256), fixture);
    }
    return await put(kind, record);
  };
  await assert.rejects(cache.capture(request), (error) => {
    assert.ok(error instanceof CollectionStoppedError);
    assert.equal(error.challenge.sourceId, manufacturerSourceId(request));
    assert.equal(error.challenge.sourceSha256, sha256(fixture));
    return true;
  });
  assert.equal(calls, 1);
  const saved = await store.get(
    'manufacturer-source',
    manufacturerSourceId(request)
  );
  assert.equal(saved.httpStatus, 403);
  assert.equal(saved.identityVerified, false);
  assert.equal(saved.observedAt, observedAt);
  assert.equal(saved.retryAfter, null);
  assert.deepEqual(saved.challenge.signals, [
    'visible-cloudflare-interstitial',
  ]);
  const stop = await store.get('collection-stop', COLLECTION_STOP_ID);
  assert.equal(stop.active, true);
  assert.equal(stop.origin, 'https://www.optimumnutrition.com');
  assert.equal(cache.cache.stats.downloads, 1);
});

test('a queued same-host manufacturer request cannot start after the challenge response', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const cache = sources(store, {
    fetchSource: async () => {
      calls++;
      return new globalThis.Response(fixture, {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const results = await Promise.allSettled([
    cache.capture(request),
    cache.capture({
      ...request,
      url: 'https://www.optimumnutrition.com/other-product',
    }),
  ]);
  assert.equal(calls, 1);
  assert.ok(
    results.every(
      (row) =>
        row.status === 'rejected' && row.reason.code === 'COLLECTION_STOPPED'
    )
  );
  assert.equal((await store.list('manufacturer-source')).length, 1);
});

test('persistent global stop blocks uncached and refreshed sources across restarts, retaining safe cached replay', async (t) => {
  const store = await temporary(t);
  const safe = {
    ...request,
    url: 'https://www.optimumnutrition.com/saved-safe',
  };
  const bytes = Buffer.from(
    '<html><head><title>Chocolate whey</title></head><body>Net864g</body></html>'
  );
  const original = await importBytes(sources(store), safe, bytes);
  let calls = 0;
  const live = sources(store, {
    fetchSource: async () => {
      calls++;
      return new globalThis.Response(fixture, { status: 403 });
    },
  });
  await assert.rejects(live.capture(request), { code: 'COLLECTION_STOPPED' });
  const restartedStore = new AssociativeStore({ directory: store.directory });
  const restarted = sources(restartedStore, {
    now: () => now + 10 * 86400000,
    fetchSource: () => {
      calls++;
      throw new Error('No download while stopped');
    },
  });
  await assert.rejects(
    restarted.capture({
      ...request,
      url: 'https://www.optimumnutrition.com/new',
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  await assert.rejects(restarted.capture({ ...safe, refresh: true }), {
    code: 'COLLECTION_STOPPED',
  });
  await assert.rejects(restarted.capture(request), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(calls, 1);
  const replay = await restarted.capture(safe);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.observedAt, observedAt);
  assert.equal(replay.blob.sha256, original.blob.sha256);
  const offline = sources(restartedStore, {
    offline: true,
    fetchSource: restarted.fetchSource,
  });
  assert.equal((await offline.capture(safe)).cacheHit, true);
  assert.equal(
    (
      await offline.importOriginal(
        { ...safe, sourceSha256: sha256(bytes), observedAt },
        bytes
      )
    ).blob.sha256,
    original.blob.sha256
  );
  assert.equal(calls, 1);
});

test('explicit manual resume still needs explicit refresh before a challenged URL is fetched again', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const cache = sources(store, {
    fetchSource: async () => {
      calls++;
      return calls === 1
        ? new globalThis.Response(fixture, { status: 403 })
        : new globalThis.Response(
            '<html><head><title>Chocolate whey</title></head><body>Net864g</body></html>'
          );
    },
  });
  await assert.rejects(cache.capture(request), { code: 'COLLECTION_STOPPED' });
  const stopped = await store.get('collection-stop', COLLECTION_STOP_ID);
  await store.put('collection-stop', {
    ...stopped,
    active: false,
    resumedAt: observedAt,
  });
  await assert.rejects(cache.capture(request), { code: 'COLLECTION_STOPPED' });
  assert.equal(calls, 1);
  await store.put('collection-stop', {
    ...stopped,
    active: false,
    resumedAt: observedAt,
  });
  const refreshed = await cache.capture({ ...request, refresh: true });
  assert.equal(refreshed.status, 'captured');
  assert.equal(refreshed.challenge, undefined);
  assert.equal(calls, 2);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    false
  );
});

test('imported challenge originals preserve exact provenance and failed cache before throwing', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, { offline: true });
  await assert.rejects(
    cache.importOriginal(
      {
        ...request,
        sourceSha256: sha256(fixture),
        originalSourceSha256:
          '6d1159bbf0a7c406347df39d249026dc5775dea5322bd9131c802279714218f5',
        redactionApplied: true,
        observedAt,
        originalArtifact:
          'docs/acceptance/source-integrity/natural-chocolate-manufacturer/official-natural-whey.http403.public.html.gz',
        httpStatus: 403,
        contentType: 'text/html',
      },
      fixture
    ),
    { code: 'COLLECTION_STOPPED' }
  );
  const source = await store.get(
    'manufacturer-source',
    manufacturerSourceId(request)
  );
  assert.equal(source.status, 'failed');
  assert.equal(source.httpStatus, 403);
  assert.equal(
    source.originalSourceSha256,
    '6d1159bbf0a7c406347df39d249026dc5775dea5322bd9131c802279714218f5'
  );
  assert.equal(source.redactionApplied, true);
  assert.equal(source.observedAt, observedAt);
  assert.deepEqual(await store.blob(source.blob.sha256), fixture);
  assert.equal((await store.get('cache', cacheId())).status, 'failed');
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('cached interstitials marked captured are quarantined offline without downloading', async (t) => {
  const store = await temporary(t);
  const blob = await store.putBlob(fixture);
  await store.put('cache', {
    id: cacheId(),
    url: request.url,
    finalUrl: request.url,
    blob,
    status: 'captured',
    contentType: 'text/html',
    observedAt,
    checkedAt: now,
  });
  const cache = sources(store, {
    offline: true,
    fetchSource: () => assert.fail('No network'),
  });
  await assert.rejects(cache.capture(request), { code: 'COLLECTION_STOPPED' });
  assert.equal((await store.get('cache', cacheId())).status, 'failed');
  assert.equal(
    (await store.get('manufacturer-source', manufacturerSourceId(request))).blob
      .sha256,
    blob.sha256
  );
  assert.equal(cache.cache.stats.downloads, 0);
});

test('same-host registered redirects preserve pacing and complete without nesting their own queue', async (t) => {
  const store = await temporary(t);
  const calls = [];
  const waits = [];
  const cache = sources(store, {
    scheduler: new DomainScheduler({
      intervalMs: 60000,
      sleep: async (wait) => {
        waits.push(wait);
      },
    }),
    fetchSource: (url) => {
      calls.push(url);
      return calls.length === 1
        ? new globalThis.Response(null, {
            status: 302,
            headers: { location: '/clear-product' },
          })
        : new globalThis.Response(
            '<html><body>Chocolate whey864g</body></html>'
          );
    },
  });
  const source = await cache.capture(request);
  assert.equal(source.status, 'captured');
  assert.equal(
    source.finalUrl,
    'https://www.optimumnutrition.com/clear-product'
  );
  assert.deepEqual(calls, [request.url, source.finalUrl]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 60000);
});

test('HTML fragments and plain HTML-mime text remain importable and fragment challenges stop', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, { offline: true });
  for (const [index, text] of [
    'Protein24g per serving',
    '<img alt="Chocolate whey label" src="https://www.optimumnutrition.com/label.png">',
  ].entries()) {
    const source = await importBytes(
      cache,
      { ...request, url: `https://www.optimumnutrition.com/fragment-${index}` },
      Buffer.from(text)
    );
    assert.equal(source.status, 'captured');
    assert.equal(source.challenge, undefined);
  }
  const fragment = Buffer.from(
    '<title>Just a moment...</title><main id="challenge-stage">Enable JavaScript and cookies to continue</main>'
  );
  await assert.rejects(importBytes(cache, request, fragment), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(
    (await store.get('manufacturer-source', manufacturerSourceId(request)))
      .status,
    'failed'
  );
});

test('successful-status and mislabeled image HTML challenges also halt without nutrition approval', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, {
    fetchSource: () =>
      new globalThis.Response(fixture, {
        headers: { 'content-type': 'image/png' },
      }),
  });
  const parent = await importBytes(
    cache,
    request,
    '<html><body><img src="https://www.optimumnutrition.com/label.png"></body></html>'
  );
  const label = {
    ...request,
    url: 'https://www.optimumnutrition.com/label.png',
    kind: 'label',
    parentSourceId: parent.id,
  };
  await assert.rejects(cache.capture(label), { code: 'COLLECTION_STOPPED' });
  const source = await store.get(
    'manufacturer-source',
    manufacturerSourceId(label)
  );
  assert.equal(source.status, 'failed');
  assert.equal(source.httpStatus, 200);
  assert.equal(source.identityVerified, false);
  assert.equal(source.parentSourceId, parent.id);
  assert.equal(source.blob.sha256, sha256(fixture));
});

test('ordinary403 and hidden Cloudflare scripts do not create a global challenge stop', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const bodies = [
    '<html><head><title>Access denied</title></head><body>Forbidden: authorization required.</body></html>',
    '<html><head><title>Just a moment...</title></head><body><div hidden id="challenge-error-text">Enable JavaScript and cookies to continue</div><script>window._cf_chl_opt={};</script>Chocolate whey</body></html>',
  ];
  const cache = sources(store, {
    fetchSource: () =>
      new globalThis.Response(bodies[calls++], { status: 403 }),
  });
  const first = await cache.capture(request);
  const second = await cache.capture({
    ...request,
    url: 'https://www.optimumnutrition.com/ordinary-product',
  });
  assert.equal(first.status, 'failed');
  assert.equal(second.status, 'failed');
  assert.equal(calls, 2);
  assert.equal(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    undefined
  );
  const imported = await importBytes(
    cache,
    { ...request, url: 'https://www.optimumnutrition.com/hidden-template' },
    bodies[1]
  );
  assert.equal(imported.status, 'captured');
  assert.equal(imported.challenge, undefined);
});

test('a global challenge detected while a redirect waits is not swallowed as failed transport', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: () =>
      stopForChallenge(store, {
        url: request.url,
        signals: ['visible-challenge-widget'],
      }),
  });
  const cache = sources(store, {
    scheduler,
    fetchSource: () => {
      calls++;
      return new globalThis.Response(null, {
        status: 302,
        headers: { location: '/redirected' },
      });
    },
  });
  await assert.rejects(cache.capture(request), { code: 'COLLECTION_STOPPED' });
  assert.equal(calls, 1);
  assert.equal((await store.list('cache')).length, 0);
  assert.equal((await store.list('manufacturer-source')).length, 0);
  const otherCache = new EvidenceCache({ store });
  await assert.rejects(
    otherCache.get('https://another-manufacturer.example/new', {
      load: () =>
        assert.fail('Global stop must apply outside manufacturer research too'),
    }),
    { code: 'COLLECTION_STOPPED' }
  );
});

const crossHostRegistry = [
  {
    brand: 'Factory',
    domains: ['a.factory.example', 'b.factory.example'],
  },
];
const crossHostRequest = (host, path = '/start') => ({
  brand: 'Factory',
  url: `https://${host}.factory.example${path}`,
});

function virtualScheduler(t) {
  const clock = { value: now };
  const waits = [];
  t.mock.method(Date, 'now', () => clock.value);
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      clock.value += milliseconds;
    },
  });
  return { scheduler, clock, waits };
}

function reciprocalFetch(calls) {
  let firstHops = 0;
  let release;
  const bothStarted = new Promise((resolve) => {
    release = resolve;
  });
  return async (url, options) => {
    calls.push({ url, options, at: Date.now() });
    const parsed = new URL(url);
    if (parsed.pathname === '/start') {
      firstHops++;
      if (firstHops === 2) {
        release();
      }
      await bothStarted;
      const other = parsed.hostname.startsWith('a.') ? 'b' : 'a';
      return new globalThis.Response(
        `Original redirect from ${parsed.hostname}`,
        {
          status: 302,
          headers: { location: `https://${other}.factory.example/final` },
        }
      );
    }
    return new globalThis.Response(
      `<html><body>Exact final evidence from ${parsed.hostname}</body></html>`
    );
  };
}

function assertHostPacing(calls) {
  const last = new Map();
  for (const call of calls) {
    const host = new URL(call.url).hostname;
    if (last.has(host)) {
      assert.ok(call.at - last.get(host) >= 60000, host);
    }
    last.set(host, call.at);
  }
}

test('reciprocal concurrent cross-host redirects finish with independent paced hops and preserved originals', async (t) => {
  const store = await temporary(t);
  const { scheduler, clock } = virtualScheduler(t);
  const calls = [];
  const cache = sources(store, {
    registry: crossHostRegistry,
    scheduler,
    now: () => clock.value,
    fetchSource: reciprocalFetch(calls),
  });
  const inputs = [crossHostRequest('a'), crossHostRequest('b')];
  const completed = await Promise.all(
    inputs.map((input) => cache.capture(input))
  );
  assert.equal(calls.length, 4);
  assert.equal(
    new Set(calls.slice(0, 2).map((call) => new URL(call.url).hostname)).size,
    2
  );
  assertHostPacing(calls);
  for (const [index, source] of completed.entries()) {
    assert.equal(source.status, 'captured');
    assert.equal(source.id, manufacturerSourceId(inputs[index]));
    assert.equal(source.identityVerified, false);
    assert.equal(source.redirects.length, 1);
    const redirect = source.redirects[0];
    assert.equal(redirect.url, inputs[index].url);
    assert.equal(redirect.httpStatus, 302);
    assert.equal(redirect.nextUrl, source.finalUrl);
    assert.equal(
      sha256(await store.blob(redirect.blob.sha256)),
      redirect.sourceSha256
    );
    assert.equal(
      (await store.blob(redirect.blob.sha256)).toString(),
      `Original redirect from ${new URL(inputs[index].url).hostname}`
    );
    assert.equal(
      (await store.blob(source.blob.sha256)).toString(),
      `<html><body>Exact final evidence from ${new URL(source.finalUrl).hostname}</body></html>`
    );
    assert.equal((await cache.capture(inputs[index])).cacheHit, true);
  }
  assert.equal(calls.length, 4);
  assert.equal(cache.cache.stats.downloads, 2);
});

test('separate manufacturer collectors sharing a cache preserve its scheduler, hooks and duplicate suppression', async (t) => {
  const store = await temporary(t);
  const { scheduler, clock } = virtualScheduler(t);
  const shared = new EvidenceCache({
    store,
    scheduler,
    now: () => clock.value,
  });
  let beforeDownloads = 0;
  shared.beforeDownload = () => {
    beforeDownloads++;
  };
  const calls = [];
  const fetchSource = reciprocalFetch(calls);
  const options = {
    store,
    registry: crossHostRegistry,
    cache: shared,
    fetchSource,
    now: () => clock.value,
  };
  const one = new ManufacturerSourceCache(options);
  const two = new ManufacturerSourceCache(options);
  const [first, second, duplicate] = await Promise.all([
    one.capture(crossHostRequest('a')),
    two.capture(crossHostRequest('b')),
    two.capture(crossHostRequest('a')),
  ]);
  assert.equal(calls.length, 4);
  assert.equal(beforeDownloads, 2);
  assert.equal(shared.scheduler, scheduler);
  assert.equal(one.cache, shared);
  assert.equal(two.cache, shared);
  assert.equal(shared.pending.size, 0);
  assert.equal(shared.stats.downloads, 2);
  assert.equal(first.blob.sha256, duplicate.blob.sha256);
  assert.equal(second.status, 'captured');
  assertHostPacing(calls);
  shared.beforeDownload = () =>
    stopForChallenge(store, {
      url: 'https://a.factory.example/security-check',
      signals: ['visible-challenge-widget'],
    });
  await assert.rejects(two.capture(crossHostRequest('a', '/new')), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(calls.length, 4);
});

test('a redirected challenge holds its host queue until originals and global stop are saved', async (t) => {
  const store = await temporary(t);
  let entered;
  let release;
  const redirected = new Promise((resolve) => {
    entered = resolve;
  });
  const continueResponse = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const cache = sources(store, {
    registry: crossHostRegistry,
    fetchSource: async (url) => {
      calls.push(url);
      if (new URL(url).hostname === 'a.factory.example') {
        return new globalThis.Response('Original moved response', {
          status: 302,
          headers: { location: 'https://b.factory.example/challenge' },
        });
      }
      entered();
      await continueResponse;
      return new globalThis.Response(fixture, {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const input = crossHostRequest('a');
  const first = cache.capture(input);
  const firstRejected = assert.rejects(first, { code: 'COLLECTION_STOPPED' });
  await redirected;
  const next = cache.capture(crossHostRequest('b', '/queued'));
  const nextRejected = assert.rejects(next, { code: 'COLLECTION_STOPPED' });
  release();
  await Promise.all([firstRejected, nextRejected]);
  assert.deepEqual(calls, [input.url, 'https://b.factory.example/challenge']);
  const saved = await store.get(
    'manufacturer-source',
    manufacturerSourceId(input)
  );
  assert.equal(saved.status, 'failed');
  assert.equal(saved.finalUrl, 'https://b.factory.example/challenge');
  assert.equal(saved.blob.sha256, sha256(fixture));
  assert.equal(saved.redirects.length, 1);
  assert.equal(
    (await store.blob(saved.redirects[0].blob.sha256)).toString(),
    'Original moved response'
  );
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).origin,
    'https://b.factory.example'
  );
});

test('redirect limits remain bounded and retain every original response without repeating failed requests', async (t) => {
  const store = await temporary(t);
  const { scheduler, clock } = virtualScheduler(t);
  const calls = [];
  const cache = sources(store, {
    registry: crossHostRegistry,
    scheduler,
    now: () => clock.value,
    fetchSource: (url) => {
      calls.push({ url, at: Date.now() });
      const other = new URL(url).hostname.startsWith('a.') ? 'b' : 'a';
      return new globalThis.Response(`Original redirect ${calls.length}`, {
        status: 302,
        headers: {
          location: `https://${other}.factory.example/step-${calls.length}`,
        },
      });
    },
  });
  const input = crossHostRequest('a');
  const failed = await cache.capture(input);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /redirect chain was incomplete or too long/u);
  assert.equal(calls.length, 6);
  assert.equal(failed.redirects.length, 6);
  assertHostPacing(calls);
  for (const [index, receipt] of failed.redirects.entries()) {
    assert.equal(
      (await store.blob(receipt.blob.sha256)).toString(),
      `Original redirect ${index + 1}`
    );
    assert.equal(
      sha256(await store.blob(receipt.blob.sha256)),
      receipt.sourceSha256
    );
  }
  assert.equal((await cache.capture(input)).cacheHit, true);
  assert.equal(calls.length, 6);
});

test('public POST redirect semantics keep307 bodies and change303 to credential-free GET', async (t) => {
  const store = await temporary(t);
  const calls = [];
  const cache = sources(store, {
    registry: crossHostRegistry,
    fetchSource: (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return new globalThis.Response('Original307', {
          status: 307,
          headers: { location: 'https://b.factory.example/second' },
        });
      }
      if (calls.length === 2) {
        return new globalThis.Response('Original303', {
          status: 303,
          headers: { location: 'https://a.factory.example/final' },
        });
      }
      return new globalThis.Response(
        '<html><body>Exact selected primary label</body></html>'
      );
    },
  });
  const input = {
    ...crossHostRequest('a'),
    method: 'POST',
    body: 'sku=chocolate&size=864g',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  };
  const source = await cache.capture(input);
  assert.equal(source.status, 'captured');
  assert.deepEqual(
    calls.map((row) => row.options.method),
    ['POST', 'POST', 'GET']
  );
  assert.deepEqual(
    calls.map((row) => row.options.body),
    [input.body, input.body, undefined]
  );
  assert.ok(
    calls.every(
      (row) =>
        row.options.credentials === 'omit' && row.options.redirect === 'manual'
    )
  );
  assert.equal(source.requestBodySha256, sha256(input.body));
  assert.deepEqual(
    source.redirects.map((row) => row.httpStatus),
    [307, 303]
  );
});
