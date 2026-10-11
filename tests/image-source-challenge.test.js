import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler, EvidenceCache } from '../src/cache.js';
import { LazadaSearch } from '../src/application.js';
import { serveBrowserImage } from '../src/browser-image-cache.js';
import { exportRepositoryArchive, RepositoryArchive } from '../src/archive.js';
import {
  COLLECTION_STOP_ID,
  CollectionStoppedError,
  stopForChallenge,
} from '../src/page-challenge.js';
import { sha256 } from '../src/util.js';

const imageUrl = 'https://img.lazcdn.com/example/label.jpg';
const now = Date.parse('2026-10-11T10:04:26.000Z');
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
// A complete one-pixel PNG, not synthetic OCR/image bytes.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'image-challenge-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

function images(store, options = {}) {
  return new EvidenceCache({
    store,
    now: () => now,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    ...options,
  });
}

function response(
  bytes,
  { status = 200, type = 'image/png', headers = {} } = {}
) {
  return new globalThis.Response(bytes, {
    status,
    headers: { 'content-type': type, ...headers },
  });
}

async function savedImage(store, url, bytes, fields = {}) {
  return await store.put('cache', {
    id: `image:${url}`,
    url,
    blob: await store.putBlob(bytes),
    contentType: 'image/png',
    fetchedAt: now,
    checkedAt: now,
    ...fields,
  });
}

for (const [status, type] of [
  [403, 'text/html'],
  [200, 'text/html'],
  [200, 'image/jpeg'],
]) {
  test(`image HTTP${status}/${type} challenge preserves original cache before stopping`, async (t) => {
    const store = await temporary(t);
    const cache = images(store);
    let calls = 0;
    const put = store.put.bind(store);
    store.put = async (kind, record) => {
      if (kind === 'collection-stop') {
        const original = await store.get('cache', `image:${imageUrl}`);
        assert.equal(original.status, 'failed');
        assert.equal(original.httpStatus, status);
        assert.equal(original.blob.sha256, sha256(fixture));
        assert.deepEqual(await store.blob(original.blob.sha256), fixture);
      }
      return await put(kind, record);
    };
    await assert.rejects(
      cache.image(imageUrl, {
        fetchImage: async () => {
          calls++;
          return response(fixture, { status, type });
        },
      }),
      (error) => {
        assert.ok(error instanceof CollectionStoppedError);
        assert.equal(error.challenge.sourceId, `image:${imageUrl}`);
        assert.equal(error.challenge.sourceSha256, sha256(fixture));
        return true;
      }
    );
    const saved = await store.get('cache', `image:${imageUrl}`);
    assert.equal(saved.observedAt, new Date(now).toISOString());
    assert.equal(saved.retryAfter, null);
    assert.equal(saved.responseBodyComplete, true);
    assert.deepEqual(saved.challenge.signals, [
      'visible-cloudflare-interstitial',
    ]);
    assert.equal(
      (await store.get('collection-stop', COLLECTION_STOP_ID)).origin,
      'https://img.lazcdn.com'
    );
    assert.equal(cache.stats.downloads, 1);
    assert.equal(calls, 1);
  });
}

test('a queued image request cannot begin before persistent challenge stop is saved', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return response(fixture, { status: 403, type: 'text/html' });
  };
  const results = await Promise.allSettled([
    cache.image(imageUrl, { fetchImage }),
    cache.image('https://img.lazcdn.com/example/next.jpg', { fetchImage }),
  ]);
  assert.equal(calls, 1);
  assert.ok(
    results.every(
      (row) =>
        row.status === 'rejected' && row.reason.code === 'COLLECTION_STOPPED'
    )
  );
  assert.equal((await store.list('cache')).length, 1);
});

test('image stop persists across restart and safe cached images remain usable offline and online', async (t) => {
  const store = await temporary(t);
  const safeUrl = 'https://img.lazcdn.com/example/safe.png';
  const original = await savedImage(store, safeUrl, png);
  await assert.rejects(
    images(store).image(imageUrl, {
      fetchImage: async () =>
        response(fixture, { status: 403, type: 'text/html' }),
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  const restartedStore = new AssociativeStore({ directory: store.directory });
  let calls = 0;
  const fetchImage = () => {
    calls++;
    throw new Error('No network while stopped');
  };
  for (const offline of [false, true]) {
    const cache = images(restartedStore, { offline });
    assert.equal(
      (await cache.image(safeUrl, { fetchImage })).blob.sha256,
      original.blob.sha256
    );
    await assert.rejects(cache.image(imageUrl, { fetchImage }), {
      code: 'COLLECTION_STOPPED',
    });
  }
  const cache = images(restartedStore);
  await assert.rejects(
    cache.image('https://other.example/new.png', { fetchImage }),
    { code: 'COLLECTION_STOPPED' }
  );
  await assert.rejects(cache.image(safeUrl, { refresh: true, fetchImage }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(calls, 0);
});

test('old cached HTML image bytes are reinspected offline without a fetch and stop globally', async (t) => {
  const store = await temporary(t);
  await savedImage(store, imageUrl, fixture, {
    contentType: 'image/jpeg',
    status: 'captured',
    repositoryReusable: true,
  });
  const cache = images(store, { offline: true });
  await assert.rejects(
    cache.image(imageUrl, {
      fetchImage: () => {
        throw new Error('Offline inspection must not fetch');
      },
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  const saved = await store.get('cache', `image:${imageUrl}`);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.sourceSha256, sha256(fixture));
  assert.equal(saved.retryAfter, null);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('manual resume requires explicit refresh to replace a challenged image', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return calls === 1
      ? response(fixture, { status: 403, type: 'text/html' })
      : response(png);
  };
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'COLLECTION_STOPPED',
  });
  const stop = await store.get('collection-stop', COLLECTION_STOP_ID);
  await store.put('collection-stop', { ...stop, active: false });
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(calls, 1);
  await store.put('collection-stop', { ...stop, active: false });
  const fresh = await cache.image(imageUrl, { refresh: true, fetchImage });
  assert.equal(fresh.blob.sha256, sha256(png));
  assert.equal(fresh.challenge, undefined);
  assert.equal(fresh.cacheHit, false);
  assert.equal(calls, 2);
});

test('ordinary403 image response and exact empty body are negative cached across restart without a security stop', async (t) => {
  const store = await temporary(t);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return response('', { status: 403, type: 'text/html' });
  };
  await assert.rejects(images(store).image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
    message: 'Image HTTP 403',
  });
  const record = await store.get('cache', `image:${imageUrl}`);
  assert.deepEqual(await store.blob(record.blob.sha256), Buffer.alloc(0));
  assert.equal(record.retryAfter, now + 86400000);
  assert.equal(record.challenge, undefined);
  const restarted = new AssociativeStore({ directory: store.directory });
  await assert.rejects(images(restarted).image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  await assert.rejects(
    images(restarted, { offline: true, now: () => now + 999999999 }).image(
      imageUrl,
      { fetchImage }
    ),
    { code: 'IMAGE_SOURCE_FAILED' }
  );
  assert.equal(calls, 1);
  assert.equal(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    undefined
  );
});

test('non-image200 and ordinary403 visible product content preserve failures without hidden-template false positives', async (t) => {
  const store = await temporary(t);
  const bytes = Buffer.from(
    '<html><head><title>Chocolate label</title><script>verify you are human</script></head><body><div hidden data-captcha>slide to verify</div><div style="display:none" id="challenge-error-text">Enable JavaScript</div>Product image unavailable</body></html>'
  );
  for (const status of [200, 403]) {
    const url = `https://img.lazcdn.com/failure${status}.png`;
    let calls = 0;
    const fetchImage = async () => {
      calls++;
      return response(bytes, { status, type: 'text/html' });
    };
    const cache = images(store);
    await assert.rejects(cache.image(url, { fetchImage }), {
      code: 'IMAGE_SOURCE_FAILED',
    });
    await assert.rejects(cache.image(url, { fetchImage }), {
      code: 'IMAGE_SOURCE_FAILED',
    });
    const saved = await store.get('cache', `image:${url}`);
    assert.equal(saved.sourceSha256, sha256(bytes));
    assert.equal(saved.challenge, undefined);
    assert.equal(saved.responseFormat, 'html');
    assert.equal(calls, 1);
  }
  assert.equal(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    undefined
  );
});

test('negative image cache expires even with repositoryReusable and refresh/invalidation explicitly reload', async (t) => {
  const store = await temporary(t);
  let clock = now;
  let calls = 0;
  const cache = images(store, { now: () => clock });
  const fetchImage = async () => {
    calls++;
    return response('missing', { status: 404, type: 'text/plain' });
  };
  await assert.rejects(
    cache.image(imageUrl, { fetchImage, failureTtlMs: 100 }),
    { code: 'IMAGE_SOURCE_FAILED' }
  );
  const first = await store.get('cache', `image:${imageUrl}`);
  await store.put('cache', { ...first, repositoryReusable: true });
  clock += 99;
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  assert.equal(calls, 1);
  clock++;
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  assert.equal(calls, 2);
  await assert.rejects(cache.image(imageUrl, { fetchImage, refresh: true }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  assert.equal(calls, 3);
  await cache.invalidate(imageUrl, {
    namespace: 'image',
    reason: 'Original endpoint repaired',
  });
  const fresh = await cache.image(imageUrl, {
    fetchImage: async (_url, { headers }) => {
      calls++;
      assert.deepEqual(headers, {});
      return response(png);
    },
  });
  assert.equal(fresh.invalidatedAt, undefined);
  assert.equal(fresh.status, 'captured');
  assert.equal(calls, 4);
});

test('ordinary transport failure is negative cached without invented body or OCR image evidence', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    throw new Error('Connection reset');
  };
  for (let index = 0; index < 2; index++) {
    await assert.rejects(cache.image(imageUrl, { fetchImage }), {
      code: 'IMAGE_SOURCE_FAILED',
      message: 'Connection reset',
    });
  }
  const failed = await store.get('cache', `image:${imageUrl}`);
  assert.equal(failed.blob, undefined);
  assert.equal(failed.sourceSha256, undefined);
  assert.equal(calls, 1);
  assert.equal(cache.stats.downloads, 1);
});

test('successful image revalidation preserves ETag, last-modified, download statistics and original time', async (t) => {
  const store = await temporary(t);
  let clock = now;
  const cache = images(store, { now: () => clock });
  let calls = 0;
  const fetchImage = async (_url, { headers }) => {
    calls++;
    if (calls === 1) {
      assert.deepEqual(headers, {});
      return response(png, {
        headers: {
          etag: '"label-v1"',
          'last-modified': 'Wed, 01 Oct 2025 00:00:00 GMT',
        },
      });
    }
    assert.deepEqual(headers, {
      'If-None-Match': '"label-v1"',
      'If-Modified-Since': 'Wed, 01 Oct 2025 00:00:00 GMT',
    });
    return response(null, { status: 304 });
  };
  const first = await cache.image(imageUrl, { fetchImage });
  clock += 100;
  const second = await cache.image(imageUrl, { fetchImage, refresh: true });
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(second.checkedAt, clock);
  assert.equal(second.blob.sha256, first.blob.sha256);
  await cache.image(imageUrl, { fetchImage });
  assert.deepEqual(cache.stats, {
    hits: 1,
    misses: 2,
    downloads: 1,
    revalidated: 1,
  });
  assert.equal(calls, 2);
});

test('304 without usable cached image is a cached failure, not a fabricated image', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return response(null, { status: 304 });
  };
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
    message: /304 response without usable/u,
  });
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  assert.equal((await store.get('cache', `image:${imageUrl}`)).blob, undefined);
  assert.equal(calls, 1);
});

test('oversized images preserve bounded original prefix but never return it as image evidence', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  const bytes = Buffer.concat([png, Buffer.alloc(100)]);
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return response(bytes);
  };
  await assert.rejects(cache.image(imageUrl, { fetchImage, maxBytes: 50 }), {
    code: 'IMAGE_SOURCE_FAILED',
    message: 'Image exceeds evidence size limit',
  });
  const saved = await store.get('cache', `image:${imageUrl}`);
  assert.equal(saved.responseBodyComplete, false);
  assert.equal(saved.sizeLimitExceeded, true);
  assert.equal(saved.blob.bytes, 50);
  assert.deepEqual(await store.blob(saved.blob.sha256), bytes.subarray(0, 50));
  await assert.rejects(cache.image(imageUrl, { fetchImage, maxBytes: 50 }), {
    code: 'IMAGE_SOURCE_FAILED',
  });
  assert.equal(calls, 1);
});

test('advertised oversized response retains its available bytes and stops if those bytes show a challenge', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  await assert.rejects(
    cache.image(imageUrl, {
      maxBytes: fixture.length + 1,
      fetchImage: async () =>
        response(fixture, {
          status: 403,
          type: 'text/html',
          headers: { 'content-length': '999999999' },
        }),
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  const failed = await store.get('cache', `image:${imageUrl}`);
  assert.deepEqual(await store.blob(failed.blob.sha256), fixture);
  assert.equal(failed.responseBodyComplete, true);
  assert.equal(failed.sizeLimitExceeded, true);
});

test('browser-captured challenge bytes are checked while host slot held and avoid a second download', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  cache.browserImages.set(imageUrl, {
    blob: await store.putBlob(fixture),
    contentType: 'image/jpeg',
  });
  await assert.rejects(
    cache.image(imageUrl, {
      fetchImage: () => {
        throw new Error('Reuse actual browser response');
      },
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  assert.equal(cache.browserImages.has(imageUrl), false);
  assert.equal(
    (await store.get('cache', `image:${imageUrl}`)).blob.sha256,
    sha256(fixture)
  );
  assert.equal(cache.stats.downloads, 1);
});

test('download hook can stop collection before either image fetch or later queued fetch executes', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  cache.beforeDownload = () =>
    stopForChallenge(store, { url: imageUrl, signals: ['operator-stop'] });
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return response(png);
  };
  await assert.rejects(cache.image(imageUrl, { fetchImage }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(calls, 0);
  assert.equal((await store.list('cache')).length, 0);
});

test('image original digest mismatch prevents OCR or network reuse', async (t) => {
  const store = await temporary(t);
  await savedImage(store, imageUrl, png, {
    sourceSha256: sha256('different original'),
  });
  await assert.rejects(
    images(store).image(imageUrl, {
      fetchImage: () => {
        throw new Error('Do not overwrite corrupt provenance');
      },
    }),
    /missing or corrupt/u
  );
});

test('corroborated cached challenge stops even if its claimed original digest is unproven', async (t) => {
  const store = await temporary(t);
  const claimed = sha256('unproven original');
  await savedImage(store, imageUrl, fixture, { sourceSha256: claimed });
  await assert.rejects(
    images(store, { offline: true }).image(imageUrl),
    (error) => {
      assert.equal(error.code, 'COLLECTION_STOPPED');
      assert.equal(error.challenge.sourceSha256, sha256(fixture));
      return true;
    }
  );
  const saved = await store.get('cache', `image:${imageUrl}`);
  assert.equal(saved.claimedSourceSha256, claimed);
  assert.equal(saved.sourceDigestMismatch, true);
  assert.equal(saved.sourceSha256, sha256(fixture));
});

test('sanitized archive challenge replay verifies its exact digest rewrite and retains original digest', async (t) => {
  const store = await temporary(t);
  const original = Buffer.from(
    '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div><script>window.token="private"</script></body></html>'
  );
  const saved = await savedImage(store, imageUrl, original, {
    sourceSha256: sha256(original),
    status: 'failed',
    challenge: {
      detected: true,
      url: imageUrl,
      signals: ['visible-cloudflare-interstitial'],
    },
  });
  const directory = await mkdtemp(join(tmpdir(), 'image-challenge-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await exportRepositoryArchive({ store, directory });
  const archive = new RepositoryArchive({ directory });
  const replayStore = new AssociativeStore({
    directory: join(store.directory, 'fresh'),
    archive,
  });
  const archived = await archive.get('cache', saved.id);
  assert.notEqual(archived.blob.sha256, sha256(original));
  await assert.rejects(
    images(replayStore, { offline: true }).image(imageUrl),
    (error) => {
      assert.equal(error.code, 'COLLECTION_STOPPED');
      assert.equal(error.challenge.sourceSha256, sha256(original));
      assert.equal(error.challenge.sourceBlobSha256, archived.blob.sha256);
      return true;
    }
  );
  assert.equal(
    (await replayStore.get('cache', saved.id)).sourceSha256,
    sha256(original)
  );
  assert.equal(
    (await replayStore.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('browser route aborts a cached transport failure with no fabricated body or request', async (t) => {
  const store = await temporary(t);
  await store.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    status: 'failed',
    error: 'Connection reset',
    retryAfter: now + 86400000,
  });
  let aborted = 0;
  let continued = 0;
  await serveBrowserImage({
    cache: images(store),
    route: {
      request: () => ({ url: () => imageUrl }),
      abort: async () => {
        aborted++;
      },
      continue: async () => {
        continued++;
      },
      fulfill: async () => {
        throw new Error('Failed response must not be fulfilled as an image');
      },
    },
  });
  assert.equal(aborted, 1);
  assert.equal(continued, 0);
});

test('cached known challenge without remaining body still persists and propagates the security stop', async (t) => {
  const store = await temporary(t);
  await store.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    status: 'failed',
    challenge: {
      detected: true,
      url: imageUrl,
      signals: ['preserved-challenge'],
    },
    sourceSha256: sha256(fixture),
  });
  await assert.rejects(images(store, { offline: true }).image(imageUrl), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('actual image-endpoint challenge propagates through OCR workflow before later images or screenshots', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  const image = cache.image.bind(cache);
  let requests = 0;
  cache.image = (url, options) =>
    image(url, {
      ...options,
      fetchImage: async () => {
        requests++;
        return response(fixture, { status: 403, type: 'text/html' });
      },
    });
  let passes = 0;
  const app = new LazadaSearch({
    store,
    cache,
    ocr: {
      recognize: async () => {
        passes++;
        throw new Error('Challenge is not OCR evidence');
      },
    },
  });
  t.after(() => app.close());
  const product = {
    id: 'image-stop',
    ingredients: [],
    claims: [],
    evidenceIds: [],
    warnings: [],
  };
  await assert.rejects(
    app.collectOcr(product, {
      snapshot: {
        url: 'https://www.lazada.vn/products/pdp-i123.html',
        productImages: [imageUrl, 'https://img.lazcdn.com/second.jpg'],
      },
      screenshot: await store.putBlob(png),
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  assert.equal(requests, 1);
  assert.equal(passes, 0);
  assert.equal(product.ocrCoverage.failed, 0);
  assert.deepEqual(product.evidenceIds, []);
});

test('image failure retry and response bounds reject unsafe configuration before any requests', async (t) => {
  const store = await temporary(t);
  const cache = images(store);
  for (const options of [
    { maxBytes: 0 },
    { maxBytes: 1.5 },
    { failureTtlMs: -1 },
    { failureTtlMs: 8 * 86400000 },
  ]) {
    await assert.rejects(
      cache.image(imageUrl, {
        ...options,
        fetchImage: () => {
          throw new Error('No invalid-option request');
        },
      })
    );
  }
  assert.equal((await store.list('cache')).length, 0);
});
