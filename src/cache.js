import { setTimeout as delay } from 'node:timers/promises';
import { canonicalUrl, positive, sha256 } from './util.js';

export class DomainScheduler {
  constructor({ intervalMs = 3000, sleep = delay } = {}) {
    positive(intervalMs, 'intervalMs', { zero: true });
    this.intervalMs = intervalMs;
    this.sleep = sleep;
    this.tails = new Map();
    this.last = new Map();
  }

  run(url, action) {
    const host = new URL(url).hostname;
    const previous = this.tails.get(host) || Promise.resolve();
    const execute = async () => {
      const wait =
        (this.last.get(host) ?? -Infinity) + this.intervalMs - Date.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.last.set(host, Date.now());
      return action();
    };
    const operation = previous.then(execute, execute);
    this.tails.set(
      host,
      operation.catch(() => {})
    );
    return operation;
  }
}

export class EvidenceCache {
  constructor({
    store,
    scheduler = new DomainScheduler(),
    now = Date.now,
    offline = false,
  } = {}) {
    this.store = store;
    this.scheduler = scheduler;
    this.now = now;
    this.offline = offline;
    this.pending = new Map();
    this.browserImages = new Map();
    this.stats = { hits: 0, misses: 0, downloads: 0, revalidated: 0 };
  }

  async get(
    url,
    { namespace = 'page', ttlMs = 21600000, refresh = false, load } = {}
  ) {
    const canonical = canonicalUrl(url);
    positive(ttlMs, 'ttlMs', { zero: true });
    const id = `${namespace}:${canonical}`;
    if (this.pending.has(id)) {
      return this.pending.get(id);
    }
    const operation = this.obtain(id, canonical, { ttlMs, refresh, load });
    this.pending.set(id, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(id);
    }
  }

  async obtain(id, url, { ttlMs, refresh, load }) {
    const cached = await this.store.get('cache', id);
    if (
      cached &&
      (this.offline || (!refresh && this.now() - cached.checkedAt <= ttlMs))
    ) {
      this.stats.hits += 1;
      return {
        ...cached,
        cacheHit: true,
        stale: this.now() - cached.checkedAt > ttlMs,
      };
    }
    if (this.offline) {
      throw new Error(`Offline cache miss: ${url}`);
    }
    this.stats.misses += 1;
    const loaded = await this.scheduler.run(url, () => load(cached));
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
    if (loaded.notModified) {
      this.stats.revalidated += 1;
    } else {
      this.stats.downloads += 1;
    }
    await this.store.put('cache', record);
    return { ...record, cacheHit: false, stale: false };
  }

  async image(
    url,
    { refresh = false, fetchImage = fetch, maxBytes = 25 * 1024 ** 2 } = {}
  ) {
    return await this.get(url, {
      namespace: 'image',
      ttlMs: Number.MAX_SAFE_INTEGER,
      refresh,
      load: async (cached) => {
        const browserImage = this.browserImages.get(canonicalUrl(url));
        if (browserImage) {
          this.browserImages.delete(canonicalUrl(url));
          return browserImage;
        }
        const headers = {};
        if (cached?.etag) {
          headers['If-None-Match'] = cached.etag;
        }
        if (cached?.lastModified) {
          headers['If-Modified-Since'] = cached.lastModified;
        }
        const response = await fetchImage(url, {
          headers,
          signal: AbortSignal.timeout(30000),
        });
        if (response.status === 304) {
          return { notModified: true };
        }
        if (!response.ok) {
          throw new Error(`Image HTTP ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (!/^image\//iu.test(contentType)) {
          throw new Error('Image URL returned non-image data');
        }
        if (Number(response.headers.get('content-length')) > maxBytes) {
          throw new Error('Image exceeds evidence size limit');
        }
        const chunks = [];
        let total = 0;
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > maxBytes) {
            throw new Error('Image exceeds evidence size limit');
          }
          chunks.push(chunk);
        }
        const blob = await this.store.putBlob(Buffer.concat(chunks));
        return {
          blob,
          contentType,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        };
      },
    });
  }
}

export const evidenceId = (url, bytes) =>
  `evidence:${sha256(`${url}:${sha256(bytes)}`)}`;
