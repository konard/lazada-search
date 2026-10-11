import { canonicalUrl, sha256 } from './util.js';
import { assertCollectionRunning } from './page-challenge.js';
import { isHtmlSource, sourceChallenge } from './source-challenge.js';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function unverifiedResponse(response, url) {
  return (
    response.redirected === true ||
    (response.url && canonicalUrl(response.url) !== canonicalUrl(url))
  );
}

async function boundedResponse(response, maxBytes) {
  const chunks = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of response.body || []) {
    const bytes = Buffer.from(chunk);
    const remaining = maxBytes - total;
    chunks.push(bytes.subarray(0, remaining));
    total += Math.min(bytes.length, remaining);
    if (bytes.length > remaining) {
      truncated = true;
      break;
    }
  }
  return {
    bytes: Buffer.concat(chunks),
    responseBodyComplete: !truncated,
    sizeLimitExceeded:
      truncated || Number(response.headers.get('content-length')) > maxBytes,
  };
}

async function responseSource(cache, response, url, options, redirects) {
  const { bytes, ...limits } = await boundedResponse(
    response,
    options.maxBytes
  );
  const blob = await cache.store.putBlob(bytes);
  const contentType = response.headers.get('content-type') || '';
  const challenge = sourceChallenge(bytes, contentType, response.url || url);
  const unverified = unverifiedResponse(response, url);
  const record = {
    ...limits,
    status: unverified ? 'failed' : 'captured',
    error: unverified
      ? 'Image transport followed an uninspected redirect'
      : null,
    retryAfter: unverified ? cache.now() + options.failureTtlMs : null,
    url,
    finalUrl: response.url || url,
    httpStatus: response.status,
    contentType,
    blob,
    sourceSha256: blob.sha256,
    observedAt: new Date(cache.now()).toISOString(),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    ...(isHtmlSource(bytes, contentType) ? { responseFormat: 'html' } : {}),
    ...(unverified ? { redirectChainUnverified: true } : {}),
    ...(redirects.length ? { redirects: [...redirects] } : {}),
    ...(challenge ? { challenge } : {}),
  };
  if (challenge || !REDIRECTS.has(record.httpStatus) || unverified) {
    return await cache.inspectImage(
      { ...record, id: `image:${options.initialUrl}`, url: options.initialUrl },
      options
    );
  }
  return record;
}

function redirectChainProblem(record) {
  const redirects = record.redirects || [];
  if (!redirects.length) {
    return record.finalUrl &&
      canonicalUrl(record.finalUrl) !== canonicalUrl(record.url)
      ? 'Cached image redirect intermediates were not inspected'
      : null;
  }
  if (redirects.length > 5) {
    return 'Cached image redirect chain exceeds the accepted limit';
  }
  let expected = canonicalUrl(record.url);
  const visited = new Set();
  for (const hop of redirects) {
    if (
      !hop.url ||
      !hop.nextUrl ||
      !hop.blob ||
      !REDIRECTS.has(hop.httpStatus)
    ) {
      return 'Cached image redirect source proof is incomplete';
    }
    const url = canonicalUrl(hop.url);
    if (url !== expected || visited.has(url)) {
      return 'Cached image redirect source chain is inconsistent';
    }
    visited.add(url);
    expected = canonicalUrl(hop.nextUrl);
  }
  return expected === canonicalUrl(record.finalUrl || record.url)
    ? null
    : 'Cached image final source differs from its redirect proof';
}

export async function inspectImageRedirects(cache, record, options) {
  for (const hop of record.redirects || []) {
    if (!hop.blob) {
      continue;
    }
    const bytes = await cache.store.blob(hop.blob.sha256);
    if (
      !bytes ||
      sha256(bytes) !== hop.blob.sha256 ||
      (hop.blob.bytes !== undefined && bytes.length !== hop.blob.bytes)
    ) {
      throw new Error(
        'Cached image redirect source bytes are missing or corrupt'
      );
    }
    const challenge = sourceChallenge(
      bytes,
      hop.contentType,
      hop.finalUrl || hop.url
    );
    const inspected = await cache.imageSourceRecord(hop, challenge);
    if (challenge || hop.challenge?.detected) {
      const failed = await cache.saveImageRecord({
        ...record,
        ...inspected,
        id: record.id,
        url: record.url,
        redirects: record.redirects,
        status: 'failed',
        challenge: challenge || hop.challenge,
        error: 'Image redirect source contains a CAPTCHA or security challenge',
        retryAfter: null,
      });
      await cache.stopImage(failed);
    }
  }
  const problem =
    record.status === 'failed' ? null : redirectChainProblem(record);
  if (problem) {
    return await cache.saveImageRecord({
      ...record,
      status: 'failed',
      redirectChainUnverified: true,
      error: problem,
      retryAfter: cache.now() + options.failureTtlMs,
    });
  }
  return record;
}

async function notModified(cache, cached, options) {
  if (!cached?.blob || cached.status === 'failed' || cached.invalidatedAt) {
    throw new Error('304 response without usable cached image evidence');
  }
  const inspected = await cache.inspectImage(cached, options);
  if (inspected.status === 'failed') {
    throw new Error('304 response without usable cached image evidence');
  }
  return { notModified: true };
}

async function requestHop(cache, url, cached, options, redirects) {
  await options.requestGuard?.(url);
  return await cache.scheduler.run(url, async () => {
    await assertCollectionRunning(cache.store);
    await cache.beforeDownload?.();
    await assertCollectionRunning(cache.store);
    const response = await options.fetchImage(url, {
      headers: redirects.length ? {} : options.headers,
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 304) {
      if (redirects.length) {
        throw new Error('304 after an unconditional image redirect request');
      }
      return { source: await notModified(cache, cached, options) };
    }
    const source = await responseSource(
      cache,
      response,
      url,
      options,
      redirects
    );
    const location = response.headers.get('location');
    if (REDIRECTS.has(source.httpStatus) && !source.redirectChainUnverified) {
      const hop = {
        ...source,
        id: `image-hop:${sha256(`${options.initialUrl}:${url}:${source.observedAt}:${source.httpStatus}:${source.blob.sha256}:${redirects.length}`)}`,
        initialUrl: options.initialUrl,
        status: 'redirect',
        locationSha256: sha256(location || ''),
      };
      delete hop.redirects;
      await cache.store.put('image-source-hop', hop);
      return { source: hop, location };
    }
    return { source };
  });
}

export async function requestImageSource(cache, initialUrl, cached, options) {
  const redirects = [];
  const visited = new Set();
  let url = initialUrl;
  try {
    for (let count = 0; count <= 5; count++) {
      if (visited.has(url)) {
        throw new Error('Image redirect cycle detected');
      }
      visited.add(url);
      const { source, location } = await requestHop(
        cache,
        url,
        cached,
        { ...options, initialUrl },
        redirects
      );
      if (source.notModified || !REDIRECTS.has(source.httpStatus)) {
        return source;
      }
      if (source.redirectChainUnverified) {
        return source;
      }
      redirects.push(source);
      if (!location || count === 5 || source.sizeLimitExceeded) {
        throw new Error('Image redirect chain was incomplete or too long');
      }
      const nextUrl = canonicalUrl(new URL(location, url).href);
      if (
        new URL(url).protocol === 'https:' &&
        new URL(nextUrl).protocol !== 'https:'
      ) {
        throw new Error('Image redirect downgraded HTTPS');
      }
      redirects[redirects.length - 1].nextUrl = nextUrl;
      url = nextUrl;
    }
    throw new Error('Image redirect limit exceeded');
  } catch (error) {
    error.imageRedirects = redirects;
    throw error;
  }
}
