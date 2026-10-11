import { parseHTML } from 'linkedom';
import { EvidenceCache, DomainScheduler } from './cache.js';
import { canonicalUrl, sha256 } from './util.js';

const DAY = 86400000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const PUBLIC_HEADERS = new Set(['accept', 'content-type']);

function hostname(url) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
}

function publicUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Manufacturer research requires credential-free HTTPS');
  }
  if (/lazada|lazcdn/iu.test(parsed.hostname)) {
    throw new Error('Manufacturer research must not request Lazada sources');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Manufacturer research requires a public HTTPS port');
  }
  return canonicalUrl(parsed.href);
}

function publicHeaders(input = {}) {
  const headers = {};
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (!PUBLIC_HEADERS.has(key)) {
      throw new Error(`Unsupported research request header: ${name}`);
    }
    headers[key] = String(value);
  }
  return headers;
}

export function manufacturerRequest(request) {
  const method = (request.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    throw new Error('Manufacturer research supports GET and public POST only');
  }
  const body = String(request.body || '');
  if (method === 'GET' && body) {
    throw new Error('A GET research request must not have a body');
  }
  const url = publicUrl(request.url);
  const headers = publicHeaders(request.headers);
  const fingerprint = sha256(
    JSON.stringify({
      url,
      method,
      bodySha256: sha256(body),
      headers: Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)),
    })
  );
  return { url, method, body, headers, fingerprint };
}

export function manufacturerSourceId(input) {
  return `manufacturer-source:${sha256(
    JSON.stringify({
      requestFingerprint: manufacturerRequest(input).fingerprint,
      brand: input.brand,
      kind: input.kind || 'page',
      parentSourceId: input.parentSourceId || null,
    })
  )}`;
}

function officialEntry(registry, brand, url) {
  const entry = registry.find((candidate) => candidate.brand === brand);
  if (!entry?.domains?.some((domain) => domain === hostname(url))) {
    throw new Error(`Unregistered manufacturer domain for ${brand}`);
  }
  return entry;
}

async function responseBytes(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    throw new Error('Manufacturer source exceeds evidence size limit');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Manufacturer source exceeds evidence size limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function imageUrls(html, baseUrl) {
  const { document } = parseHTML(html);
  const found = new Map();
  for (const element of document.querySelectorAll('img, source')) {
    for (const attribute of ['src', 'data-src', 'data-original', 'srcset']) {
      const raw = element.getAttribute(attribute);
      if (!raw) {
        continue;
      }
      const values = attribute === 'srcset' ? raw.split(',') : [raw];
      for (const value of values) {
        try {
          const url = publicUrl(new URL(value.trim().split(/\s/u)[0], baseUrl));
          found.set(url, {
            url,
            alt: element.getAttribute('alt') || '',
            title: element.getAttribute('title') || '',
            attribute,
          });
        } catch {
          // Data URLs and unsupported image transports are not fetch targets.
        }
      }
    }
  }
  return [...found.values()];
}

function originalProvenance(input, bytes) {
  if (!input.sourceSha256 || sha256(bytes) !== input.sourceSha256) {
    throw new Error('Original artifact SHA-256 mismatch');
  }
  if (
    input.originalSourceSha256 &&
    (!/^[a-f\d]{64}$/u.test(input.originalSourceSha256) ||
      input.redactionApplied !== true)
  ) {
    throw new Error(
      'Redacted evidence requires an original digest and receipt'
    );
  }
  if (
    input.observedAt
      ? !Number.isFinite(Date.parse(input.observedAt))
      : input.captureTimeUnknown !== true
  ) {
    throw new Error(
      'Original evidence requires its actual capture time or an explicit unknown-time receipt'
    );
  }
}

export class ManufacturerSourceCache {
  constructor({
    store,
    registry,
    cache,
    scheduler = cache?.scheduler || new DomainScheduler(),
    fetchSource = fetch,
    offline = false,
    now = Date.now,
    maxBytes = 25 * 1024 ** 2,
    failureTtlMs = DAY,
  }) {
    this.store = store;
    this.registry = registry;
    this.scheduler = scheduler;
    this.fetchSource = fetchSource;
    this.now = now;
    this.maxBytes = maxBytes;
    this.failureTtlMs = failureTtlMs;
    this.cache = cache || new EvidenceCache({ store, scheduler, offline, now });
  }

  async publication(parentSourceId, url, brand) {
    const parent = await this.store.get('manufacturer-source', parentSourceId);
    if (
      parent?.status !== 'captured' ||
      parent.brand !== brand ||
      parent.authority !== 'manufacturer'
    ) {
      throw new Error('A label requires a captured official parent source');
    }
    const bytes = await this.store.blob(parent.blob.sha256);
    if (!bytes || sha256(bytes) !== parent.blob.sha256) {
      throw new Error('Official parent source bytes are missing or corrupt');
    }
    if (
      !imageUrls(bytes.toString('utf8'), parent.finalUrl).some(
        (i) => i.url === url
      )
    ) {
      throw new Error('Label URL was not published by the official parent');
    }
    const entry = officialEntry(this.registry, brand, parent.finalUrl);
    const hosts = [...entry.domains, ...(entry.assetDomains || [])];
    if (!hosts.includes(hostname(url))) {
      throw new Error(
        'Published label host requires an explicit source registry entry'
      );
    }
    return parent;
  }

  async context(input) {
    const request = manufacturerRequest(input);
    const kind = input.kind || 'page';
    if (!['page', 'label'].includes(kind)) {
      throw new Error('Manufacturer source kind must be page or label');
    }
    let parent;
    if (kind === 'label') {
      if (request.method !== 'GET') {
        throw new Error('Label evidence requires a GET request');
      }
      parent = await this.publication(
        input.parentSourceId,
        request.url,
        input.brand
      );
    } else {
      officialEntry(this.registry, input.brand, request.url);
    }
    return { request, kind, brand: input.brand, parent };
  }

  async capture(input) {
    const context = await this.context(input);
    const { request } = context;
    const cached = await this.cache.get(request.url, {
      namespace: `manufacturer-request-${request.fingerprint}`,
      ttlMs: Number.MAX_SAFE_INTEGER,
      refresh: input.refresh === true,
      acceptCached: (record) =>
        record.status !== 'failed' || this.now() < record.retryAfter,
      load: () => this.download(context),
    });
    return await this.recordSource(context, cached);
  }

  async recordSource(context, cached) {
    const source = {
      ...cached,
      id: manufacturerSourceId({
        ...context.request,
        brand: context.brand,
        kind: context.kind,
        parentSourceId: context.parent?.id,
      }),
      requestFingerprint: context.request.fingerprint,
      requestMethod: context.request.method,
      requestBodySha256: sha256(context.request.body),
      brand: context.brand,
      kind: context.kind,
      authority: 'manufacturer',
      parentSourceId: context.parent?.id || null,
      parentSourceSha256: context.parent?.blob.sha256 || null,
      identityVerified: false,
    };
    if (cached.blob) {
      const bytes = await this.store.blob(cached.blob.sha256);
      if (!bytes || sha256(bytes) !== cached.blob.sha256) {
        throw new Error(
          'Cached manufacturer source bytes are missing or corrupt'
        );
      }
    }
    const saved = await this.store.put('manufacturer-source', source);
    return { ...saved, cacheHit: cached.cacheHit };
  }

  allowedRedirect(context, url) {
    if (context.kind === 'page') {
      officialEntry(this.registry, context.brand, url);
      return;
    }
    const entry = this.registry.find(
      (candidate) => candidate.brand === context.brand
    );
    if (
      ![...entry.domains, ...(entry.assetDomains || [])].includes(hostname(url))
    ) {
      throw new Error('Label redirect left the registered asset domains');
    }
  }

  async requestFollowingRedirects(context) {
    let { url, method, body } = context.request;
    const { headers } = context.request;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const action = () =>
        this.fetchSource(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
          credentials: 'omit',
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
        });
      const response =
        redirects === 0
          ? await action()
          : await this.scheduler.run(url, action);
      if (!REDIRECTS.has(response.status)) {
        return { response, finalUrl: url };
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) {
        throw new Error(
          'Manufacturer redirect chain was incomplete or too long'
        );
      }
      url = publicUrl(new URL(location, url).href);
      this.allowedRedirect(context, url);
      if (
        response.status === 303 ||
        ([301, 302].includes(response.status) && method === 'POST')
      ) {
        method = 'GET';
        body = '';
      }
    }
    throw new Error('Manufacturer redirect limit exceeded');
  }

  async download(context) {
    try {
      const { response, finalUrl } =
        await this.requestFollowingRedirects(context);
      const contentType = response.headers.get('content-type') || '';
      const bytes = await responseBytes(response, this.maxBytes);
      const blob = await this.store.putBlob(bytes);
      const captured =
        response.ok &&
        (context.kind !== 'label' || /^image\//iu.test(contentType));
      return {
        status: captured ? 'captured' : 'failed',
        httpStatus: response.status,
        finalUrl,
        contentType,
        blob,
        sourceSha256: blob.sha256,
        observedAt: new Date(this.now()).toISOString(),
        retryAfter: captured ? null : this.now() + this.failureTtlMs,
        error: captured
          ? null
          : `Source HTTP ${response.status} or unsupported label content type`,
      };
    } catch (error) {
      return {
        status: 'failed',
        finalUrl: context.request.url,
        error: String(error.message).slice(0, 300),
        observedAt: new Date(this.now()).toISOString(),
        retryAfter: this.now() + this.failureTtlMs,
      };
    }
  }

  async importOriginal(input, bytes) {
    const context = await this.context(input);
    originalProvenance(input, bytes);
    this.allowedRedirect(context, input.finalUrl || context.request.url);
    const blob = await this.store.putBlob(bytes);
    const { request } = context;
    const cached = await this.store.put('cache', {
      id: `manufacturer-request-${request.fingerprint}:${request.url}`,
      url: request.url,
      finalUrl: input.finalUrl || request.url,
      status: input.status || 'captured',
      contentType: input.contentType,
      blob,
      sourceSha256: blob.sha256,
      ...(input.originalSourceSha256
        ? {
            originalSourceSha256: input.originalSourceSha256,
            redactionApplied: true,
          }
        : {}),
      observedAt: input.observedAt || null,
      captureTimeUnknown: !input.observedAt,
      fetchedAt: input.observedAt ? Date.parse(input.observedAt) : null,
      checkedAt: this.now(),
      retryAfter: input.retryAfter || null,
      originalArtifact: input.originalArtifact || null,
    });
    return await this.recordSource(context, { ...cached, cacheHit: true });
  }

  async images(sourceId) {
    const source = await this.store.get('manufacturer-source', sourceId);
    if (source?.status !== 'captured' || source.kind !== 'page') {
      return [];
    }
    const bytes = await this.store.blob(source.blob.sha256);
    return imageUrls(bytes.toString('utf8'), source.finalUrl).map((image) => ({
      ...image,
      parentSourceId: sourceId,
      parentSourceSha256: source.blob.sha256,
      identityVerified: false,
    }));
  }
}
