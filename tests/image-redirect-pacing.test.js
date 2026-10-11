import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler, EvidenceCache } from '../src/cache.js';
import { BrowserCollector } from '../src/browser.js';
import {
  serveBrowserImage,
  retainBrowserImage,
} from '../src/browser-image-cache.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';
import {
  exportRepositoryArchive,
  RepositoryArchive,
  sanitizePublicHtml,
} from '../src/archive.js';
import { sha256 } from '../src/util.js';

const now = Date.parse('2026-10-11T15:00:00.000Z');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const redirectHtml = Buffer.from(
  '<html><head><title>Label moved</title></head><body><a href="https://cdn.example/label.png?__cf_chl_tk=private-redirect-token&size=large">New label</a><script>window.sessionToken="private-redirect-token"</script></body></html>'
);
const challengeHtml = Buffer.from(
  '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div></body></html>'
);

async function temporary(
  t,
  scheduler = new DomainScheduler({ intervalMs: 0 })
) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-image-redirect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'store') });
  const cache = new EvidenceCache({ store, scheduler, now: () => now });
  return { store, cache, directory };
}

function response(
  url,
  bytes,
  { status = 200, type = 'image/png', location, redirected = false, etag } = {}
) {
  return {
    url,
    status,
    redirected,
    headers: new globalThis.Headers({
      'content-type': type,
      ...(location ? { location } : {}),
      ...(etag ? { etag } : {}),
    }),
    body: [bytes],
  };
}

async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redirect queue did not finish')),
          3000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('each same-host redirect is independently paced and preserved before its next request without nested queue locks', async (t) => {
  const waits = [];
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: async (wait) => waits.push(wait),
  });
  const { cache, store } = await temporary(t, scheduler);
  const initial = 'https://cdn.example/original.png';
  const final = 'https://cdn.example/label.png';
  const calls = [];
  let downloads = 0;
  cache.beforeDownload = async () => {
    downloads++;
  };
  const fetchImage = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    calls.push(url);
    if (url === initial) {
      return response(url, redirectHtml, {
        status: 302,
        type: 'text/html',
        location: '/label.png',
      });
    }
    const [hop] = await store.list('image-source-hop');
    assert.equal(hop.status, 'redirect');
    assert.equal(hop.responseFormat, 'html');
    assert.equal(hop.sourceSha256, sha256(redirectHtml));
    assert.deepEqual(await store.blob(hop.blob.sha256), redirectHtml);
    return response(url, png, { etag: 'exact-label' });
  };
  const image = await bounded(cache.image(initial, { fetchImage }));
  assert.deepEqual(calls, [initial, final]);
  assert.equal(downloads, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 60000);
  assert.equal(image.finalUrl, final);
  assert.equal(image.blob.sha256, sha256(png));
  assert.equal(image.redirects[0].nextUrl, final);
  assert.equal((await cache.image(initial, { fetchImage })).cacheHit, true);
  assert.equal(calls.length, 2);
  assert.equal(cache.stats.downloads, 1);
});

test('opposing cross-host chains release each initial host before requesting the other host', async (t) => {
  const { cache, store } = await temporary(t);
  const a = 'https://a.example/start.png';
  const b = 'https://b.example/start.png';
  const calls = [];
  let first = 0;
  let release;
  const bothStarted = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImage = async (url) => {
    calls.push(url);
    if (url === a || url === b) {
      first++;
      if (first === 2) {
        release();
      }
      await bothStarted;
      const target =
        url === a
          ? 'https://b.example/a-label.png'
          : 'https://a.example/b-label.png';
      return response(url, Buffer.from('moved'), {
        status: 307,
        type: 'text/plain',
        location: target,
      });
    }
    assert.equal((await store.list('image-source-hop')).length, 2);
    return response(url, png);
  };
  const results = await bounded(
    Promise.all([
      cache.image(a, { fetchImage }),
      cache.image(b, { fetchImage }),
    ])
  );
  assert.deepEqual(
    new Set(calls),
    new Set([
      a,
      b,
      'https://b.example/a-label.png',
      'https://a.example/b-label.png',
    ])
  );
  assert.ok(results.every((row) => row.blob.sha256 === sha256(png)));
  assert.equal(cache.stats.downloads, 2);
});

test('a redirect response challenge is preserved before the durable stop and no target or queued source is requested', async (t) => {
  const { cache, store } = await temporary(t);
  const initial = 'https://cdn.example/start.png';
  const calls = [];
  let started;
  let release;
  const firstStarted = new Promise((resolve) => {
    started = resolve;
  });
  const responseReleased = new Promise((resolve) => {
    release = resolve;
  });
  const put = store.put.bind(store);
  store.put = async (kind, record) => {
    if (kind === 'collection-stop') {
      const original = await store.get('cache', `image:${initial}`);
      assert.equal(original.httpStatus, 302);
      assert.equal(original.status, 'failed');
      assert.equal(original.blob.sha256, sha256(challengeHtml));
      assert.deepEqual(await store.blob(original.blob.sha256), challengeHtml);
    }
    return await put(kind, record);
  };
  const fetchImage = async (url) => {
    calls.push(url);
    started();
    await responseReleased;
    return response(url, challengeHtml, {
      status: 302,
      type: 'image/png',
      location: 'https://other.example/must-not-follow.png',
    });
  };
  const first = cache.image(initial, { fetchImage });
  await firstStarted;
  const second = cache.image('https://cdn.example/queued.png', { fetchImage });
  release();
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(calls, [initial]);
  assert.ok(
    results.every(
      (result) =>
        result.status === 'rejected' &&
        result.reason.code === 'COLLECTION_STOPPED'
    )
  );
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.equal(cache.stats.downloads, 1);
});

for (const cycle of [true, false]) {
  test(`redirect ${cycle ? 'cross-host cycle' : 'hop limit'} fails with bounded preserved originals and negative-cache replay`, async (t) => {
    const { cache, store } = await temporary(t);
    const initial = 'https://a.example/0.png';
    const calls = [];
    const fetchImage = async (url) => {
      calls.push(url);
      const next = cycle
        ? url === initial
          ? 'https://b.example/next.png'
          : initial
        : `https://a.example/${calls.length}.png`;
      return response(url, Buffer.from(`redirect${calls.length}`), {
        status: 308,
        type: 'text/plain',
        location: next,
      });
    };
    await assert.rejects(bounded(cache.image(initial, { fetchImage })), {
      code: 'IMAGE_SOURCE_FAILED',
      message: cycle ? /cycle/u : /too long/u,
    });
    assert.equal(calls.length, cycle ? 2 : 6);
    const saved = await store.get('cache', `image:${initial}`);
    assert.equal(saved.redirects.length, calls.length);
    assert.equal((await store.list('image-source-hop')).length, calls.length);
    assert.equal(saved.blob, undefined);
    const restarted = new EvidenceCache({
      store: new AssociativeStore({ directory: store.directory }),
      offline: true,
    });
    await assert.rejects(restarted.image(initial, { fetchImage }), {
      code: 'IMAGE_SOURCE_FAILED',
    });
    assert.equal(calls.length, cycle ? 2 : 6);
  });
}

test('a transport ignoring manual redirects is rejected, while its actual challenge body still stops acquisition', async (t) => {
  for (const challenge of [false, true]) {
    const { cache, store } = await temporary(t);
    const url = 'https://a.example/label.png';
    await assert.rejects(
      cache.image(url, {
        fetchImage: async () =>
          response(
            'https://b.example/uninspected.png',
            challenge ? challengeHtml : png,
            { redirected: true }
          ),
      }),
      { code: challenge ? 'COLLECTION_STOPPED' : 'IMAGE_SOURCE_FAILED' }
    );
    const record = await store.get('cache', `image:${url}`);
    assert.equal(record.redirectChainUnverified, true);
    assert.equal(record.status, 'failed');
    assert.equal(record.sourceSha256, sha256(challenge ? challengeHtml : png));
  }
});

test('ordinary intermediate HTML and nested redirect receipts archive safe derivatives with original digest relations, leaving final image exact', async (t) => {
  const { cache, store, directory } = await temporary(t);
  const initial = 'https://a.example/label.png';
  const captured = await cache.image(initial, {
    fetchImage: async (url) =>
      url === initial
        ? response(url, redirectHtml, {
            status: 301,
            type: 'text/html',
            location: 'https://cdn.example/label.png',
          })
        : response(url, png),
  });
  await exportRepositoryArchive({
    store,
    directory: join(directory, 'archive'),
  });
  const archive = new RepositoryArchive({
    directory: join(directory, 'archive'),
  });
  const image = await archive.get('cache', `image:${initial}`);
  const [hop] = await archive.list('image-source-hop');
  const sanitized = Buffer.from(sanitizePublicHtml(redirectHtml.toString()));
  assert.equal(hop.sourceSha256, sha256(redirectHtml));
  assert.equal(hop.blob.sha256, sha256(sanitized));
  assert.equal(image.redirects[0].blob.sha256, hop.blob.sha256);
  assert.equal(image.redirects[0].sourceSha256, sha256(redirectHtml));
  assert.doesNotMatch(
    (await archive.blob(hop.blob.sha256)).toString(),
    /private-redirect-token|__cf_chl_tk|<script/u
  );
  assert.deepEqual(await store.blob(sha256(redirectHtml)), redirectHtml);
  assert.equal(image.blob.sha256, captured.blob.sha256);
  assert.deepEqual(await archive.blob(image.blob.sha256), png);
  assert.ok(
    (await archive.manifest()).sourceRewrites.some(
      (entry) =>
        entry.originalSha256 === sha256(redirectHtml) &&
        entry.archivedSha256 === sha256(sanitized)
    )
  );
  assert.equal((await archive.verify()).valid, true);
});

function browserRoute(url, fetchImage, { frameUrl } = {}) {
  const actions = [];
  return {
    actions,
    request: () => ({
      url: () => url,
      ...(frameUrl ? { frame: () => ({ url: () => frameUrl }) } : {}),
    }),
    continue: async () => {
      actions.push('uninspected-continue');
    },
    abort: async () => {
      actions.push('abort');
    },
    fulfill: async (value) => {
      actions.push(value);
    },
    fetch: async (options) => {
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.maxRetries, 0);
      assert.equal(options.method, 'GET');
      const source = await fetchImage(options.url);
      return {
        status: () => source.status,
        url: () => source.url,
        headers: () => Object.fromEntries(source.headers),
        body: async () => Buffer.concat(source.body),
        dispose: async () => {},
      };
    },
  };
}

test('browser route acquires manual hops and fulfilled synthetic response cannot erase actual redirect/date/etag proofs', async (t) => {
  const { cache, store } = await temporary(t);
  const initial = 'https://cdn.example/start.png';
  const final = 'https://images.example/label.png';
  const calls = [];
  const route = browserRoute(initial, async (url) => {
    calls.push(url);
    return url === initial
      ? response(url, redirectHtml, {
          status: 302,
          type: 'text/html',
          location: final,
        })
      : response(url, png, { etag: 'original-etag' });
  });
  await serveBrowserImage({ route, cache });
  assert.deepEqual(calls, [initial, final]);
  assert.deepEqual(route.actions, [
    { body: png, contentType: 'image/png', status: 200 },
  ]);
  const original = await store.get('cache', `image:${initial}`);
  cache.now = () => now + 5000;
  await retainBrowserImage({
    cache,
    bytes: png,
    response: {
      url: () => initial,
      status: () => 200,
      headers: () => ({ 'content-type': 'image/png', etag: 'synthetic-etag' }),
      request: () => ({ redirectedFrom: () => null }),
    },
  });
  assert.deepEqual(await store.get('cache', `image:${initial}`), original);
  assert.equal(original.finalUrl, final);
  assert.equal(original.etag, 'original-etag');
  assert.equal(
    cache.browserImages.get(initial).observedAt,
    new Date(now).toISOString()
  );
});

test('browser intermediate challenge aborts before following its target and missing manual-hop support never continues natively', async (t) => {
  const { cache, store } = await temporary(t);
  const url = 'https://cdn.example/start.png';
  const calls = [];
  const route = browserRoute(url, async (target) => {
    calls.push(target);
    return response(target, challengeHtml, {
      status: 302,
      type: 'text/html',
      location: 'https://next.example/label.png',
    });
  });
  await assert.rejects(serveBrowserImage({ route, cache }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.deepEqual(calls, [url]);
  assert.deepEqual(route.actions, ['abort']);
  assert.equal(
    (await store.get('cache', `image:${url}`)).sourceSha256,
    sha256(challengeHtml)
  );
  const separate = await temporary(t);
  const unsupported = browserRoute(url, () => assert.fail('No request'));
  delete unsupported.fetch;
  await serveBrowserImage({ route: unsupported, cache: separate.cache });
  assert.deepEqual(unsupported.actions, ['abort']);
});

test('same active page-host image is deferred before any host lock, remains uncached, and can be acquired safely after capture', async (t) => {
  const { cache, store } = await temporary(t);
  const url = 'https://cdn.example/label.png';
  const route = browserRoute(
    url,
    () => assert.fail('No nested page-host request'),
    { frameUrl: 'https://cdn.example/product' }
  );
  await bounded(serveBrowserImage({ route, cache }));
  assert.deepEqual(route.actions, ['abort']);
  assert.equal(await store.get('cache', `image:${url}`), undefined);
  assert.equal((await store.list('image-source-hop')).length, 0);
  assert.equal(
    (await cache.image(url, { fetchImage: async () => response(url, png) }))
      .blob.sha256,
    sha256(png)
  );
});

test('unproven native browser redirects cannot supply images, but their visible challenge body is preserved and stops first', async (t) => {
  for (const challenge of [false, true]) {
    const { cache, store } = await temporary(t);
    const url = 'https://cdn.example/final.png';
    const original = {
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'image/png' }),
      request: () => ({
        redirectedFrom: () => ({
          url: () => 'https://first.example/start.png',
        }),
      }),
    };
    const operation = retainBrowserImage({
      response: original,
      cache,
      bytes: challenge ? challengeHtml : png,
    });
    if (challenge) {
      await assert.rejects(operation, { code: 'COLLECTION_STOPPED' });
    } else {
      await operation;
    }
    const saved = await store.get('cache', `image:${url}`);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.redirectChainUnverified, true);
    assert.equal(cache.browserImages.size, 0);
    assert.deepEqual(
      await store.blob(saved.blob.sha256),
      challenge ? challengeHtml : png
    );
  }
});

test('offline cached redirect originals stop on intermediate challenges before safe final bytes are reused', async (t) => {
  for (const failed of [false, true]) {
    const { cache, store } = await temporary(t);
    cache.offline = true;
    const url = 'https://cdn.example/start.png';
    const finalUrl = 'https://other.example/label.png';
    const challenge = await store.putBlob(challengeHtml);
    await store.put('cache', {
      id: `image:${url}`,
      url,
      finalUrl,
      blob: await store.putBlob(png),
      sourceSha256: sha256(png),
      contentType: 'image/png',
      checkedAt: now,
      status: failed ? 'failed' : 'captured',
      ...(failed
        ? { error: 'Earlier transport failure', retryAfter: now + 86400000 }
        : {}),
      redirects: [
        {
          url,
          nextUrl: finalUrl,
          httpStatus: 302,
          contentType: 'image/png',
          blob: challenge,
          sourceSha256: challenge.sha256,
        },
      ],
    });
    await assert.rejects(
      cache.image(url, { fetchImage: () => assert.fail('No offline request') }),
      { code: 'COLLECTION_STOPPED' }
    );
    const saved = await store.get('cache', `image:${url}`);
    assert.equal(saved.blob.sha256, challenge.sha256);
    assert.equal(saved.sourceSha256, challenge.sha256);
    assert.equal(saved.retryAfter, null);
    assert.equal(
      (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
      true
    );
    assert.equal(cache.stats.downloads, 0);
  }
});

test('cached redirected final bytes without inspected intermediates remain preserved artifacts and require refresh', async (t) => {
  const { cache, store } = await temporary(t);
  const url = 'https://cdn.example/start.png';
  const finalUrl = 'https://other.example/label.png';
  await store.put('cache', {
    id: `image:${url}`,
    url,
    finalUrl,
    blob: await store.putBlob(png),
    contentType: 'image/png',
    status: 'captured',
    checkedAt: now,
  });
  cache.offline = true;
  await assert.rejects(cache.image(url), {
    code: 'IMAGE_SOURCE_FAILED',
    message: /intermediates were not inspected/u,
  });
  assert.deepEqual(
    await store.blob((await store.get('cache', `image:${url}`)).blob.sha256),
    png
  );
  assert.equal(cache.stats.downloads, 0);
  cache.offline = false;
  const fresh = await cache.image(url, {
    refresh: true,
    fetchImage: async (target) =>
      target === url
        ? response(target, redirectHtml, {
            status: 302,
            type: 'text/html',
            location: finalUrl,
          })
        : response(target, png),
  });
  assert.equal(fresh.status, 'captured');
  assert.equal(fresh.redirectChainUnverified, undefined);
  assert.equal(fresh.redirects.length, 1);
});

test('cached intermediary corruption prevents safe final image reuse', async (t) => {
  const { cache, store } = await temporary(t);
  const url = 'https://cdn.example/start.png';
  const finalUrl = 'https://other.example/label.png';
  const hop = await store.putBlob(redirectHtml);
  await store.put('cache', {
    id: `image:${url}`,
    url,
    finalUrl,
    blob: await store.putBlob(png),
    contentType: 'image/png',
    status: 'captured',
    checkedAt: now,
    redirects: [
      {
        url,
        nextUrl: finalUrl,
        httpStatus: 302,
        contentType: 'text/html',
        blob: { ...hop, bytes: hop.bytes + 1 },
        sourceSha256: hop.sha256,
      },
    ],
  });
  cache.offline = true;
  await assert.rejects(
    cache.image(url),
    /redirect source bytes are missing or corrupt/u
  );
  assert.equal(cache.stats.downloads, 0);
});

test('a redirected page capture exposes and clears its initial held host; image redirects defer without nesting that page queue', async (t) => {
  const { cache, store } = await temporary(t);
  const initialPage = 'https://initial.example/product';
  const currentFrame = 'https://final.example/product';
  const image = 'https://cdn.example/start.png';
  const collector = new BrowserCollector({ store, cache });
  t.after(() => collector.close());
  const calls = [];
  const route = browserRoute(
    image,
    async (url) => {
      calls.push(url);
      return response(url, redirectHtml, {
        status: 302,
        type: 'text/html',
        location: 'https://initial.example/label.png',
      });
    },
    { frameUrl: currentFrame }
  );
  collector.capture = async () => {
    assert.equal(collector.activeImagePageUrl, initialPage);
    await serveBrowserImage({
      route,
      cache,
      activePageUrl: collector.activeImagePageUrl,
    });
    return { status: 'ok' };
  };
  const result = await bounded(
    cache.scheduler.run(initialPage, () =>
      collector.captureWithBudget(initialPage)
    )
  );
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, [image]);
  assert.deepEqual(route.actions, ['abort']);
  assert.equal(collector.activeImagePageUrl, undefined);
  assert.equal(await store.get('cache', `image:${image}`), undefined);
  assert.equal((await store.list('image-source-hop')).length, 1);
  const safe = 'https://initial.example/safe.png';
  await store.put('cache', {
    id: `image:${safe}`,
    url: safe,
    blob: await store.putBlob(png),
    contentType: 'image/png',
    checkedAt: now,
  });
  const safeRoute = browserRoute(
    safe,
    () => assert.fail('No cached image request'),
    { frameUrl: currentFrame }
  );
  await cache.scheduler.run(initialPage, () =>
    serveBrowserImage({ route: safeRoute, cache, activePageUrl: initialPage })
  );
  assert.deepEqual(safeRoute.actions, [
    { body: png, contentType: 'image/png' },
  ]);
  collector.capture = async () => {
    throw new Error('Capture failed');
  };
  await assert.rejects(
    collector.captureWithBudget(initialPage),
    /Capture failed/u
  );
  assert.equal(collector.activeImagePageUrl, undefined);
});

test('browser hop requests preserve source user-agent and public negotiation headers without forwarding supplied credentials', async (t) => {
  const { cache } = await temporary(t);
  const url = 'https://cdn.example/start.png';
  const final = 'https://other.example/label.png';
  const route = browserRoute(url, async (target) =>
    target === url
      ? response(target, redirectHtml, {
          status: 302,
          type: 'text/html',
          location: final,
        })
      : response(target, png)
  );
  const fetch = route.fetch;
  let requests = 0;
  route.request = () => ({
    url: () => url,
    headers: () => ({
      'user-agent': 'Original Chrome fixture',
      accept: 'image/avif,image/webp,*/*',
      'accept-language': 'vi,en;q=0.9',
      cookie: 'private-cookie',
      authorization: 'Bearer private-secret',
      referer: 'https://account.example/private',
    }),
  });
  route.fetch = async (options) => {
    requests++;
    assert.deepEqual(options.headers, {
      'user-agent': 'Original Chrome fixture',
      accept: 'image/avif,image/webp,*/*',
      'accept-language': 'vi,en;q=0.9',
    });
    return await fetch(options);
  };
  await serveBrowserImage({ route, cache });
  assert.equal(requests, 2);
  assert.deepEqual(route.actions[0].body, png);
});
