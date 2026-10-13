import { DomainScheduler } from './cache.js';
import {
  assertCollectionRunning,
  stopForChallenge,
  CollectionStoppedError,
} from './page-challenge.js';
import { sourceChallenge } from './source-challenge.js';
import { sha256 } from './util.js';

const schedulers = new WeakMap();
const CONFIG_KEYS = new Set([
  'id',
  'version',
  'origin',
  'endpoint',
  'cacheOnly',
  'method',
  'tokenEnv',
  'tokenHeader',
  'tokenPrefix',
  'rowsPath',
  'urlPath',
  'titlePath',
  'queriesField',
  'domainsField',
  'limitField',
  'timeoutMs',
  'maxBodyBytes',
  'maxResponseBytes',
  'maxResults',
  'intervalMs',
]);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function bounded(value, name, fallback, min, max) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function publicEndpoint(raw) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.port && url.port !== '443') ||
    /^(?:localhost|.*\.localhost|.*\.local|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|\[)/u.test(
      host
    )
  ) {
    throw new Error(
      'Search provider endpoint must be public credential-free HTTPS without query credentials'
    );
  }
  return url;
}

function pointer(path, name, fallback) {
  path ??= fallback;
  if (
    typeof path !== 'string' ||
    path.length > 256 ||
    (path && !path.startsWith('/')) ||
    path.split('/').length > 13 ||
    path
      .split('/')
      .some((part) =>
        unsafeKeys.has(part.replaceAll('~1', '/').replaceAll('~0', '~'))
      )
  ) {
    throw new Error(`${name} must be a bounded safe JSON pointer`);
  }
  return path;
}

function atPointer(value, path) {
  return path
    ? path
        .slice(1)
        .split('/')
        .reduce(
          (current, part) =>
            current?.[part.replaceAll('~1', '/').replaceAll('~0', '~')],
          value
        )
    : value;
}

function field(value, fallback) {
  value ??= fallback;
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(value) ||
    unsafeKeys.has(value)
  ) {
    throw new Error('Search request field names must be bounded identifiers');
  }
  return value;
}

function normalizeConfiguration(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !CONFIG_KEYS.has(key))
  ) {
    throw new Error(
      'Unsupported search provider configuration; plaintext tokens and registry overrides are prohibited'
    );
  }
  const endpoint = publicEndpoint(input.endpoint || input.origin);
  const origin = publicEndpoint(input.origin || endpoint.origin).origin;
  if (endpoint.origin !== origin || (input.method && input.method !== 'POST')) {
    throw new Error(
      'Search provider requires a same-origin JSON POST endpoint'
    );
  }
  if (
    input.tokenEnv !== undefined &&
    (typeof input.tokenEnv !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,127}$/u.test(input.tokenEnv) ||
      ['HOME', 'PATH', 'SHELL', 'USER', 'LOGNAME', 'CODEX_HOME'].includes(
        input.tokenEnv
      ))
  ) {
    throw new Error(
      'Search authentication requires an explicit token environment variable name'
    );
  }
  const tokenHeader = input.tokenHeader || 'Authorization';
  const tokenPrefix = input.tokenPrefix ?? 'Bearer ';
  if (
    !/^(?:Authorization|(?:X-)?API-Key|X-Goog-API-Key|X-Search-API-Key)$/iu.test(
      tokenHeader
    ) ||
    typeof tokenPrefix !== 'string' ||
    tokenPrefix.length > 32 ||
    /[\r\n\0]/u.test(tokenPrefix)
  ) {
    throw new Error('Unsupported search authentication header or prefix');
  }
  const config = {
    id: input.id || `http-json-search:${sha256(endpoint.href)}`,
    version: input.version || '1',
    origin,
    endpoint: endpoint.href,
    method: 'POST',
    cacheOnly: input.cacheOnly === true,
    tokenEnv: input.tokenEnv || null,
    tokenHeader,
    tokenPrefix,
    rowsPath: pointer(input.rowsPath, 'rowsPath', '/results'),
    urlPath: pointer(input.urlPath, 'urlPath', '/url'),
    titlePath: pointer(input.titlePath, 'titlePath', '/title'),
    queriesField: field(input.queriesField, 'queries'),
    domainsField: field(input.domainsField, 'domains'),
    limitField: field(input.limitField, 'maxResults'),
    timeoutMs: bounded(input.timeoutMs, 'timeoutMs', 30000, 1000, 60000),
    maxBodyBytes: bounded(
      input.maxBodyBytes,
      'maxBodyBytes',
      32768,
      256,
      131072
    ),
    maxResponseBytes: bounded(
      input.maxResponseBytes,
      'maxResponseBytes',
      2097152,
      1024,
      8388608
    ),
    maxResults: bounded(input.maxResults, 'maxResults', 100, 1, 500),
    intervalMs: bounded(input.intervalMs, 'intervalMs', 60000, 60000, 3600000),
  };
  if (
    typeof config.id !== 'string' ||
    !config.id.trim() ||
    config.id.length > 200 ||
    typeof config.version !== 'string' ||
    !config.version.trim() ||
    config.version.length > 100 ||
    new Set([config.queriesField, config.domainsField, config.limitField])
      .size !== 3
  ) {
    throw new Error(
      'Search provider identity/version and distinct request fields are required'
    );
  }
  return Object.freeze(config);
}

function providerScheduler(application, config) {
  let byOrigin = schedulers.get(application.store);
  if (!byOrigin) {
    byOrigin = new Map();
    schedulers.set(application.store, byOrigin);
  }
  if (!byOrigin.has(config.origin)) {
    byOrigin.set(
      config.origin,
      new DomainScheduler({ intervalMs: config.intervalMs })
    );
  }
  const scheduler = byOrigin.get(config.origin);
  scheduler.intervalMs = Math.max(scheduler.intervalMs, config.intervalMs);
  return scheduler;
}

function requestBody(config, request) {
  if (
    !Array.isArray(request.queries) ||
    !request.queries.length ||
    request.queries.length > 20 ||
    request.queries.some(
      (query) =>
        typeof query !== 'string' || !query.trim() || query.length > 1024
    ) ||
    !Array.isArray(request.domains) ||
    !request.domains.length ||
    request.domains.length > 100 ||
    request.domains.some(
      (domain) => typeof domain !== 'string' || !/^[a-z\d.-]+$/iu.test(domain)
    )
  ) {
    throw new Error(
      'Search requires bounded explicit queries and trusted domain restrictions'
    );
  }
  const payload = {
    [config.queriesField]: request.queries,
    [config.domainsField]: request.domains,
    [config.limitField]: Math.min(
      bounded(
        request.maxResults,
        'request maxResults',
        config.maxResults,
        1,
        500
      ),
      config.maxResults
    ),
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > config.maxBodyBytes) {
    throw new Error('Search JSON request exceeds its configured byte limit');
  }
  return body;
}

async function responseBytes(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    throw new Error('Search response exceeds its configured byte limit');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > maximum) {
      throw new Error('Search response exceeds its configured byte limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sanitizedResults(config, json, maximum, token) {
  const rows = atPointer(json, config.rowsPath);
  if (!Array.isArray(rows) || rows.length > 5000) {
    throw new Error('Search response rows must be a bounded JSON array');
  }
  return rows.slice(0, maximum).flatMap((row) => {
    const url = atPointer(row, config.urlPath);
    const title = atPointer(row, config.titlePath);
    if (
      typeof url !== 'string' ||
      url.length > 4096 ||
      (token && (url.includes(token) || String(title || '').includes(token)))
    ) {
      return [];
    }
    return [
      {
        url,
        ...(typeof title === 'string' ? { title: title.slice(0, 1000) } : {}),
      },
    ];
  });
}

async function requestSearch(application, config, request, scheduler) {
  if (config.cacheOnly || application.cache.offline) {
    const error = new Error(
      'Cached-only search provider: no reusable response for this exact query'
    );
    error.code = 'MANUFACTURER_SEARCH_CACHE_MISS';
    throw error;
  }
  const body = requestBody(config, request);
  request.signal?.throwIfAborted();
  await assertCollectionRunning(application.store);
  return scheduler.run(config.endpoint, async () => {
    request.signal?.throwIfAborted();
    await assertCollectionRunning(application.store);
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    const token = config.tokenEnv ? process.env[config.tokenEnv] : null;
    if (config.tokenEnv && (!token || /[\r\n\0]/u.test(token))) {
      throw new Error(
        'Configured search token environment variable is missing or invalid'
      );
    }
    if (token) {
      headers[config.tokenHeader] = `${config.tokenPrefix}${token}`;
    }
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);
    let response;
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        body,
        headers,
        signal,
        credentials: 'omit',
        redirect: 'manual',
      });
    } catch {
      throw new Error('Search provider request failed or timed out');
    }
    const bytes = await responseBytes(response, config.maxResponseBytes);
    const type = response.headers.get('content-type') || '';
    const challenge = sourceChallenge(bytes, type, config.endpoint);
    if (challenge) {
      await stopForChallenge(application.store, challenge);
      throw new CollectionStoppedError(challenge);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Search provider redirects are prohibited');
    }
    if (!response.ok || !/application\/(?:[a-z.-]+\+)?json/iu.test(type)) {
      throw new Error(
        `Search provider returned HTTP ${response.status} or non-JSON content`
      );
    }
    let json;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('Search provider returned invalid JSON');
    }
    await assertCollectionRunning(application.store);
    return sanitizedResults(
      config,
      json,
      Math.min(request.maxResults || config.maxResults, config.maxResults),
      token
    );
  });
}

export function createManufacturerSearchProvider(application, configuration) {
  const config = normalizeConfiguration(configuration);
  const scheduler = providerScheduler(application, config);
  return {
    origin: config.origin,
    id: config.id,
    version: config.version,
    cacheOnly: config.cacheOnly,
    // cacheOnly controls requests, not the identity of already collected data.
    configurationSha256: sha256(
      JSON.stringify({ ...config, cacheOnly: undefined })
    ),
    search: (request) => requestSearch(application, config, request, scheduler),
  };
}
