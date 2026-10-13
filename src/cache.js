import { setTimeout as delay } from 'node:timers/promises';
import { canonicalUrl, positive, sha256 } from './util.js';
import {
  assertCollectionRunning,
  CollectionStoppedError,
  stopForChallenge,
} from './page-challenge.js';
import { isHtmlSource, sourceChallenge } from './source-challenge.js';
import {
  requestImageSource,
  inspectImageRedirects,
} from './image-source-request.js';

const DAY = 86400000;

function imageFailure(record, bytes) {
  if (record.challenge?.detected) {
    return 'Image source contains a CAPTCHA or security challenge';
  }
  if (record.sizeLimitExceeded) {
    return 'Image exceeds evidence size limit';
  }
  if (
    record.httpStatus !== undefined &&
    (record.httpStatus < 200 || record.httpStatus >= 300)
  ) {
    return `Image HTTP ${record.httpStatus}`;
  }
  if (
    !/^image\//iu.test(record.contentType || '') ||
    isHtmlSource(bytes, record.contentType)
  ) {
    return 'Image URL returned non-image data';
  }
  if (!bytes.length) {
    return 'Image URL returned an empty image';
  }
  return record.status === 'failed'
    ? record.error || 'Image source failed'
    : null;
}

function failedImageError(record) {
  const error = new Error(record.error || 'Image source failed');
  error.code = 'IMAGE_SOURCE_FAILED';
  error.source = record;
  return error;
}

function validImageBlob(record, bytes) {
  return (
    bytes &&
    sha256(bytes) === record.blob.sha256 &&
    (record.blob.bytes === undefined || bytes.length === record.blob.bytes)
  );
}

function imageRequestHeaders(cached) {
  const headers = {};
  if (cached?.status !== 'failed' && !cached?.invalidatedAt) {
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }
    if (cached?.lastModified) {
      headers['If-Modified-Since'] = cached.lastModified;
    }
  }
  return headers;
}

function imageFailureRecord(record, challenge, error, retryAfter) {
  return {
    ...record,
    status: 'failed',
    sourceSha256: record.sourceSha256 || record.blob.sha256,
    error,
    retryAfter: challenge ? null : (record.retryAfter ?? retryAfter),
    ...(challenge ? { challenge } : {}),
  };
}

function changedImageFailure(record, failed) {
  return (
    record.status !== 'failed' ||
    failed.challenge?.detected ||
    record.responseFormat !== failed.responseFormat
  );
}

export class DomainScheduler {
  constructor({ intervalMs = 60000, sleep = delay } = {}) {
    positive(intervalMs, 'intervalMs', { zero: true });
    this.intervalMs = intervalMs;
    this.sleep = sleep;
    this.tails = new Map();
    this.last = new Map();
  }

  run(url, action, { beforePace } = {}) {
    const host = new URL(url).hostname;
    const previous = this.tails.get(host) || Promise.resolve();
    const execute = async () => {
      await beforePace?.();
      await this.pace(url);
      await beforePace?.();
      return action();
    };
    const operation = previous.then(execute, execute);
    this.tails.set(
      host,
      operation.catch(() => {})
    );
    return operation;
  }

  async pace(url) {
    const host = new URL(url).hostname;
    const wait =
      (this.last.get(host) ?? -Infinity) + this.intervalMs - Date.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.last.set(host, Date.now());
  }
}

export class EvidenceCache {
  constructor({
    store,
    scheduler = new DomainScheduler(),
    staticImageScheduler,
    now = Date.now,
    offline = false,
  } = {}) {
    if (
      staticImageScheduler !== undefined &&
      typeof staticImageScheduler?.run !== 'function'
    ) {
      throw new Error('staticImageScheduler must provide run(url, action)');
    }
    this.store = store;
    this.scheduler = scheduler;
    this.staticImageScheduler = staticImageScheduler;
    this.now = now;
    this.offline = offline;
    this.pending = new Map();
    this.browserImages = new Map();
    this.stats = { hits: 0, misses: 0, downloads: 0, revalidated: 0 };
  }

  async get(
    url,
    {
      namespace = 'page',
      ttlMs = 21600000,
      refresh = false,
      acceptCached = () => true,
      load,
    } = {}
  ) {
    const canonical = canonicalUrl(url);
    positive(ttlMs, 'ttlMs', { zero: true });
    const id = `${namespace}:${canonical}`;
    if (this.pending.has(id)) {
      return this.pending.get(id);
    }
    const operation = this.obtain(id, canonical, {
      ttlMs,
      refresh,
      acceptCached,
      load,
    });
    this.pending.set(id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(id);
    }
  }

  async obtain(id, url, { ttlMs, refresh, acceptCached, load }) {
    if (this.offline && refresh) {
      throw new Error(`Cannot refresh a source offline: ${url}`);
    }
    const cached = await this.store.get('cache', id);
    if (this.accepts(cached, { ttlMs, refresh, acceptCached })) {
      this.stats.hits += 1;
      return {
        ...cached,
        cacheHit: true,
        stale: this.now() - cached.checkedAt > ttlMs,
      };
    }
    if (this.offline) {
      throw new Error(
        `${cached?.invalidatedAt ? 'Invalidated source needs an online reload' : 'Offline cache miss'}: ${url}`
      );
    }
    this.stats.misses += 1;
    await assertCollectionRunning(this.store);
    const loaded = await this.scheduler.run(url, async () => {
      await assertCollectionRunning(this.store);
      await this.beforeDownload?.();
      await assertCollectionRunning(this.store);
      return load(cached);
    });
    if (loaded.notModified && !cached) {
      throw new Error('304 response without cached evidence');
    }
    const record = {
      ...(loaded.notModified ? cached : loaded),
      id,
      url,
      fetchedAt: loaded.notModified ? cached.fetchedAt : this.now(),
      checkedAt: this.now(),
    };
    delete record.notModified;
    delete record.invalidatedAt;
    delete record.invalidationReason;
    // A working store backed by a committed case retains sources until refresh.
    if (this.store.archive) {
      record.repositoryReusable = true;
    }
    if (loaded.notModified) {
      this.stats.revalidated += 1;
    } else {
      this.stats.downloads += 1;
    }
    const saved = await this.store.put('cache', record);
    return { ...saved, cacheHit: false, stale: false };
  }

  reusable(cached, { ttlMs, refresh }) {
    return (
      this.offline ||
      (!refresh &&
        (cached.repositoryReusable || this.now() - cached.checkedAt <= ttlMs))
    );
  }

  accepts(cached, { ttlMs, refresh, acceptCached }) {
    return (
      cached &&
      !cached.invalidatedAt &&
      acceptCached(cached) &&
      this.reusable(cached, { ttlMs, refresh })
    );
  }

  async invalidate(url, { reason, namespace } = {}) {
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new Error('Invalidation requires a reason');
    }
    const canonical = canonicalUrl(url);
    const records = (await this.store.list('cache')).filter(
      (record) =>
        record.url === canonical &&
        (!namespace || record.id === `${namespace}:${canonical}`)
    );
    for (const record of records) {
      await this.store.put('cache', {
        ...record,
        invalidatedAt: new Date(this.now()).toISOString(),
        invalidationReason: reason,
      });
    }
    await this.store.put('invalidation', {
      id: canonical,
      url: canonical,
      cacheIds: records.map((record) => record.id),
      reason,
      invalidatedAt: new Date(this.now()).toISOString(),
    });
    return { url: canonical, invalidated: records.length, reason };
  }

  async image(
    url,
    {
      refresh = false,
      fetchImage = fetch,
      maxBytes = 25 * 1024 ** 2,
      failureTtlMs = DAY,
      requestGuard,
    } = {}
  ) {
    positive(maxBytes, 'maxBytes', { integer: true });
    positive(failureTtlMs, 'failureTtlMs', { zero: true });
    if (failureTtlMs > 7 * DAY) {
      throw new Error('Image failure TTL must not exceed seven days');
    }
    const canonical = canonicalUrl(url);
    // Inspect older cache entries before retry decisions, including offline
    // replay. A missed challenge must not become an automatic retry.
    if (!refresh) {
      const cached = await this.store.get('cache', `image:${canonical}`);
      if (cached?.blob || cached?.challenge?.detected) {
        await this.inspectImage(cached, { maxBytes, failureTtlMs });
      }
    }
    // A logical image source may span hosts. Only individual response hops
    // acquire host queues, never the entire redirect chain.
    const requestCache = Object.create(this);
    requestCache.scheduler = { run: (_url, action) => action() };
    requestCache.beforeDownload = undefined;
    const saved = await requestCache.get(canonical, {
      namespace: 'image',
      ttlMs: Number.MAX_SAFE_INTEGER,
      refresh,
      acceptCached: (record) =>
        this.offline ||
        record.challenge?.detected ||
        record.status !== 'failed' ||
        this.now() < record.retryAfter,
      load: (cached) =>
        this.loadImage(canonical, cached, {
          fetchImage,
          maxBytes,
          failureTtlMs,
          requestGuard,
        }),
    });
    const inspected = await this.inspectImage(saved, {
      maxBytes,
      failureTtlMs,
    });
    if (inspected.status === 'failed') {
      throw failedImageError(inspected);
    }
    return inspected;
  }

  async inspectImage(record, { maxBytes, failureTtlMs }) {
    record = await inspectImageRedirects(this, record, {
      maxBytes,
      failureTtlMs,
    });
    if (!record.blob) {
      if (record.challenge?.detected) {
        await this.stopImage(record);
      }
      if (record.status !== 'failed') {
        throw new Error('Cached image source has no preserved image bytes');
      }
      return record;
    }
    const bytes = await this.store.blob(record.blob.sha256);
    if (!validImageBlob(record, bytes)) {
      throw new Error('Cached image source bytes are missing or corrupt');
    }
    if (bytes.length > maxBytes) {
      throw new Error('Image exceeds evidence size limit');
    }
    const challenge = sourceChallenge(
      bytes,
      record.contentType,
      record.finalUrl || record.url
    );
    record = await this.imageSourceRecord(record, challenge);
    const error = imageFailure(
      { ...record, ...(challenge ? { challenge } : {}) },
      bytes
    );
    if (!error) {
      return record;
    }
    const failed = imageFailureRecord(
      {
        ...record,
        ...(isHtmlSource(bytes, record.contentType)
          ? { responseFormat: 'html' }
          : {}),
      },
      challenge,
      error,
      this.now() + failureTtlMs
    );
    if (changedImageFailure(record, failed)) {
      await this.saveImageRecord(failed);
    }
    if (challenge || record.challenge?.detected) {
      await this.stopImage(failed);
    }
    return failed;
  }

  async saveImageRecord(record) {
    const clean = { ...record };
    delete clean.cacheHit;
    delete clean.stale;
    return await this.store.put('cache', clean);
  }

  async verifyImageSourceDigest(record) {
    if (!record.sourceSha256 || record.sourceSha256 === record.blob.sha256) {
      return;
    }
    const manifest = await this.store.archive?.manifest();
    if (
      !manifest?.sourceRewrites?.some(
        (rewrite) =>
          rewrite.originalSha256 === record.sourceSha256 &&
          rewrite.archivedSha256 === record.blob.sha256
      )
    ) {
      throw new Error('Cached image source bytes are missing or corrupt');
    }
  }

  async imageSourceRecord(record, challenge) {
    try {
      await this.verifyImageSourceDigest(record);
      return record;
    } catch (error) {
      if (!challenge) {
        throw error;
      }
      // Corroborated challenge bytes still stop collection. An unproven claimed
      // original digest is retained as a conflict, never treated as provenance.
      return {
        ...record,
        claimedSourceSha256: record.sourceSha256,
        sourceSha256: record.blob.sha256,
        sourceDigestMismatch: true,
      };
    }
  }

  async stopImage(record) {
    const challenge = {
      ...record.challenge,
      url: record.finalUrl || record.url,
      sourceId: record.id,
      sourceSha256: record.sourceSha256 || record.blob?.sha256,
      sourceBlobSha256: record.blob?.sha256 || null,
    };
    await stopForChallenge(this.store, challenge);
    throw new CollectionStoppedError(challenge);
  }

  async loadImage(url, cached, options) {
    let loaded;
    try {
      const browserImage = this.browserImages.get(url);
      if (browserImage) {
        this.browserImages.delete(url);
        loaded = browserImage;
      } else {
        loaded = await this.requestImage(url, cached, options);
      }
    } catch (error) {
      if (
        error.code === 'IMAGE_ACQUISITION_DEFERRED' ||
        error.code === 'ABORT_ERR' ||
        error.name === 'AbortError'
      ) {
        throw error;
      }
      if (error.code === 'COLLECTION_STOPPED') {
        if (error.challenge?.sourceSha256) {
          this.stats.downloads += 1;
        }
        throw error;
      }
      return {
        status: 'failed',
        finalUrl: url,
        error: String(error.message).slice(0, 300),
        observedAt: new Date(this.now()).toISOString(),
        retryAfter: this.now() + options.failureTtlMs,
        ...(error.imageRedirects?.length
          ? { redirects: error.imageRedirects }
          : {}),
      };
    }
    if (loaded.notModified) {
      return loaded;
    }
    const record = {
      ...loaded,
      id: `image:${url}`,
      url,
      fetchedAt: this.now(),
      checkedAt: this.now(),
      ...(this.store.archive ? { repositoryReusable: true } : {}),
    };
    // Each downloaded response was inspected while holding its actual host
    // slot. Recheck retained browser originals before exposing image evidence.
    try {
      return await this.inspectImage(record, options);
    } catch (error) {
      if (error.code === 'COLLECTION_STOPPED') {
        this.stats.downloads += 1;
      }
      throw error;
    }
  }

  async requestImage(url, cached, options) {
    return await requestImageSource(this, url, cached, {
      ...options,
      headers: imageRequestHeaders(cached),
    });
  }
}

export const evidenceId = (url, bytes) =>
  `evidence:${sha256(`${url}:${sha256(bytes)}`)}`;
