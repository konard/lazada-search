import { canonicalUrl, sha256 } from './util.js';
import { assertCollectionRunning } from './page-challenge.js';

const MAX_BYTES = 25 * 1024 ** 2;
const IMAGE_OPTIONS = { maxBytes: MAX_BYTES, failureTtlMs: 86400000 };

function reusableFailure(record, cache, refresh) {
  return (
    record.status === 'failed' &&
    !refresh &&
    (cache.offline || cache.now() < record.retryAfter)
  );
}

function browserImageRequest(route) {
  return async (url, { headers }) => {
    if (typeof route.fetch !== 'function') {
      throw new Error('Browser image transport cannot inspect redirect hops');
    }
    const sourceHeaders = route.request().headers?.() || {};
    const publicHeaders = Object.fromEntries(
      Object.entries(sourceHeaders).filter(([name]) =>
        ['accept', 'accept-language', 'user-agent'].includes(name.toLowerCase())
      )
    );
    const response = await route.fetch({
      url,
      method: 'GET',
      headers: { ...publicHeaders, ...headers },
      maxRedirects: 0,
      maxRetries: 0,
      timeout: 30000,
    });
    try {
      return {
        status: response.status(),
        url: response.url(),
        headers: new globalThis.Headers(response.headers()),
        body: [await response.body()],
      };
    } finally {
      await response.dispose?.();
    }
  };
}

function pageHostGuard(route, activePageUrl) {
  const hosts = new Set();
  if (activePageUrl) {
    hosts.add(new URL(activePageUrl).hostname);
  }
  try {
    let frame = route.request().frame();
    while (frame) {
      hosts.add(new URL(frame.url()).hostname);
      frame = frame.parentFrame?.();
    }
  } catch {
    // Service worker requests can have no frame or an initial blank page.
  }
  return (url) => {
    if (hosts.has(new URL(url).hostname)) {
      const error = new Error(
        'Same-host browser image requires acquisition after the active page capture'
      );
      error.code = 'IMAGE_ACQUISITION_DEFERRED';
      throw error;
    }
  };
}

function cachedBrowserBody(cached, bytes, unverifiedRedirect) {
  return (
    !unverifiedRedirect &&
    cached?.blob?.sha256 === sha256(bytes) &&
    !cached.invalidatedAt &&
    cached.status !== 'failed'
  );
}

function rememberImage(cache, url, inspected) {
  cache.browserImages.set(url, inspected);
  if (cache.browserImages.size > 100) {
    cache.browserImages.delete(cache.browserImages.keys().next().value);
  }
}

export async function serveBrowserImage({
  route,
  cache,
  refresh = false,
  activePageUrl,
}) {
  let url;
  try {
    url = canonicalUrl(route.request().url());
  } catch {
    await route.abort();
    return;
  }
  try {
    const cached = await cache.store.get('cache', `image:${url}`);
    if (
      (cached?.blob || cached?.status === 'failed') &&
      !cached.invalidatedAt
    ) {
      const inspected = await cache.inspectImage(cached, IMAGE_OPTIONS);
      if (reusableFailure(inspected, cache, refresh)) {
        await route.abort();
        return;
      }
      if (inspected.status !== 'failed' && !refresh) {
        await route.fulfill({
          body: await cache.store.blob(inspected.blob.sha256),
          contentType: inspected.contentType,
        });
        return;
      }
    }
    await assertCollectionRunning(cache.store);
    const image = await cache.image(url, {
      ...IMAGE_OPTIONS,
      refresh,
      fetchImage: browserImageRequest(route),
      requestGuard: pageHostGuard(route, activePageUrl),
    });
    await route.fulfill({
      body: await cache.store.blob(image.blob.sha256),
      contentType: image.contentType,
      status: 200,
    });
  } catch (error) {
    await route.abort();
    if (error.code === 'COLLECTION_STOPPED') {
      throw error;
    }
  }
}

export async function retainBrowserImage({ response, bytes, cache }) {
  if (!bytes || bytes.length > MAX_BYTES) {
    return;
  }
  const headers = response.headers();
  const url = canonicalUrl(response.url());
  const unverifiedRedirect = Boolean(response.request?.().redirectedFrom?.());
  const cached = await cache.store.get('cache', `image:${url}`);
  if (cachedBrowserBody(cached, bytes, unverifiedRedirect)) {
    // Fulfilling a route emits a response at its initial browser URL. Preserve
    // the actual acquired final URL, redirect proofs and observation time.
    const inspected = await cache.inspectImage(cached, IMAGE_OPTIONS);
    if (inspected.status !== 'failed') {
      rememberImage(cache, url, inspected);
    }
    return;
  }
  const blob = await cache.store.putBlob(bytes);
  const record = {
    id: `image:${url}`,
    url,
    finalUrl: url,
    blob,
    sourceSha256: blob.sha256,
    httpStatus: response.status(),
    contentType: headers['content-type'] || '',
    etag: headers.etag || null,
    lastModified: headers['last-modified'] || null,
    observedAt: new Date(cache.now()).toISOString(),
    fetchedAt: cache.now(),
    checkedAt: cache.now(),
    ...(unverifiedRedirect
      ? {
          status: 'failed',
          redirectChainUnverified: true,
          error: 'Browser image redirect intermediates were not inspected',
          retryAfter: cache.now() + IMAGE_OPTIONS.failureTtlMs,
        }
      : {}),
  };
  const inspected = await cache.inspectImage(record, IMAGE_OPTIONS);
  await cache.saveImageRecord(inspected);
  if (inspected.status === 'failed') {
    return;
  }
  rememberImage(cache, url, inspected);
}
