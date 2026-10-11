import { parseHTML } from 'linkedom';
import { classifyPage, extractPage } from './browser.js';
import { inspectPageChallenge } from './page-challenge.js';
import { parseProduct } from './products.js';
import { canonicalUrl, sha256 } from './util.js';

function addCandidate(candidates, record, source, expectedSku, strict = true) {
  const observedAt = record.observedAt ?? record.fetchedAt;
  const observed =
    typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
  const key = `${record.html?.sha256}:${observed}:${expectedSku || ''}`;
  const candidate = candidates.get(key) || {
    record,
    observed,
    expectedSku,
    strict,
    priceContext: record.priceContext,
    sources: [],
  };
  candidate.priceContext ||= record.priceContext;
  candidate.sources.push(source);
  candidates.set(key, candidate);
}

async function attachedCandidates(store, candidates) {
  const evidence = new Map(
    (await store.list('evidence')).map((record) => [record.id, record])
  );
  const owners = [
    ...(await store.list('product')).map((record) => ['product', record]),
    ...(await store.list('offer')).map((record) => ['offer', record]),
    ...(await store.list('offer-history')).map((record) => [
      'offer-history',
      record,
    ]),
  ];
  for (const [kind, owner] of owners) {
    for (const id of new Set(
      owner.evidenceId ? [owner.evidenceId] : owner.evidenceIds || []
    )) {
      const record = evidence.get(id);
      if (record && record.role !== 'listing') {
        continue;
      }
      addCandidate(
        candidates,
        record || { id, url: owner.url, observedAt: owner.observedAt },
        { kind, id: owner.id, evidenceId: id, visibility: owner.visibility },
        owner.sku
      );
    }
  }
}

async function replayCandidates(application, includeLatestCache) {
  const candidates = new Map();
  await attachedCandidates(application.store, candidates);
  for (const record of await application.store.list('publication')) {
    addCandidate(
      candidates,
      record,
      { kind: 'publication', id: record.id, visibility: record.visibility },
      record.sku
    );
  }
  const cache = await application.store.list('cache');
  if (includeLatestCache) {
    for (const record of cache) {
      if (
        record.id.startsWith(
          `lazada:${application.market}:${application.deliveryArea}:`
        ) &&
        record.status === 'ok' &&
        record.html &&
        /\/products\//u.test(record.url || '')
      ) {
        addCandidate(
          candidates,
          record,
          { kind: 'cache', id: record.id, visibility: record.visibility },
          record.snapshot?.sku,
          false
        );
      }
    }
  }
  return {
    candidates: [...candidates.values()].sort(
      (left, right) =>
        left.observed - right.observed ||
        String(left.record.id).localeCompare(String(right.record.id))
    ),
    invalidatedHashes: new Set(
      cache
        .filter((record) => record.invalidatedAt && record.html)
        .map((record) => record.html.sha256)
    ),
  };
}

function assertSourceAccess(application, candidate, invalidatedHashes) {
  const { record } = candidate;
  if (
    application.store.visibility === 'public' &&
    (record.visibility === 'private' ||
      candidate.sources.some((source) => source.visibility === 'private'))
  ) {
    throw new Error(
      'Private source evidence cannot be replayed into public data'
    );
  }
  if (record.invalidatedAt || invalidatedHashes.has(record.html?.sha256)) {
    throw new Error('Invalidated source needs an online reload');
  }
  if (!Number.isFinite(candidate.observed)) {
    throw new Error('Original source requires a valid observation timestamp');
  }
  if (!record.html?.sha256) {
    throw new Error('Attached original source HTML is missing');
  }
}

async function originalBytes(store, record) {
  const bytes = await store.blob(record.html.sha256);
  if (!bytes?.length) {
    throw new Error('Attached original source HTML blob is missing');
  }
  if (sha256(bytes) !== record.html.sha256) {
    throw new Error('Original source HTML digest mismatch');
  }
  if (record.html.bytes !== undefined && record.html.bytes !== bytes.length) {
    throw new Error('Original source HTML length mismatch');
  }
  if (bytes.includes('[Truncated]')) {
    throw new Error('Original source HTML is incomplete');
  }
  return bytes;
}

function assertOriginalSku(candidate, snapshot, parsed) {
  if (
    !parsed.offer.variantConfirmed ||
    !(parsed.offer.price > 0) ||
    !snapshot.sku ||
    (candidate.strict &&
      candidate.expectedSku &&
      parsed.offer.sku !== candidate.expectedSku)
  ) {
    throw new Error(
      'Original HTML does not confirm the attached exact SKU price'
    );
  }
}

async function readOriginal(application, candidate, invalidatedHashes) {
  assertSourceAccess(application, candidate, invalidatedHashes);
  const { record } = candidate;
  const bytes = await originalBytes(application.store, record);
  const url = canonicalUrl(record.sourceUrl || record.finalUrl || record.url);
  application.assertMarket(url);
  const { document } = parseHTML(bytes.toString('utf8'));
  const snapshot = extractPage({ document, url });
  snapshot.challenge = inspectPageChallenge({ document, url });
  const status = classifyPage(snapshot);
  if (status !== 'ok') {
    throw new Error(`Original source extraction stopped: ${status}`);
  }
  const parsed = parseProduct(snapshot);
  assertOriginalSku(candidate, snapshot, parsed);
  return { url, snapshot, parsed };
}

// Reuse ordinary collection corrections without changing a URL cache alias.
// Metadata and current offers must also resist replaying an older observation.
function replayStore(store) {
  return new Proxy(store, {
    get(target, property) {
      if (property === 'put') {
        return (kind, record) => {
          if (kind === 'cache') {
            throw new Error(
              'Historical replay cannot replace URL cache aliases'
            );
          }
          return ['sku-inventory', 'evidence'].includes(kind) &&
            record.observedAt
            ? target.putLatest(kind, record)
            : target.put(kind, record);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function replayOriginal(application, candidate, original) {
  const replay = Object.create(application);
  replay.store = replayStore(application.store);
  replay.ocr = undefined;
  replay.collector = {
    page: (url) => {
      if (canonicalUrl(url) !== original.url) {
        throw new Error('Historical replay cannot navigate to another source');
      }
      return Promise.resolve({
        ...candidate.record,
        id: candidate.record.cacheId || candidate.record.id,
        snapshot: original.snapshot,
        status: 'ok',
        sourceUrl: original.url,
        fetchedAt: candidate.observed,
        cacheHit: true,
        stale: true,
      });
    },
  };
  const result = await replay.collect(original.url);
  if (candidate.priceContext) {
    result.offer = await replay.saveOffer({
      ...result.offer,
      priceContext: candidate.priceContext,
    });
  }
  return result;
}

// Only original stored bytes are read. A collection challenge remains active;
// parser replay neither resumes collection nor performs a provider/browser call.
export async function replayHistoricalCaptures(
  application,
  { includeLatestCache = true } = {}
) {
  if (!application.cache?.offline) {
    throw new Error(
      'Historical extraction replay requires an offline application'
    );
  }
  if (typeof application.store.putLatest !== 'function') {
    throw new Error('Historical replay requires chronological store writes');
  }
  const { candidates, invalidatedHashes } = await replayCandidates(
    application,
    includeLatestCache
  );
  const downloadsBefore = application.cache.stats.downloads;
  const results = [];
  const replayed = new Set();
  for (const candidate of candidates) {
    const receipt = {
      sourceRecords: candidate.sources,
      sourceUrl: candidate.record.sourceUrl || candidate.record.url,
      sourceSha256: candidate.record.html?.sha256,
      expectedSku: candidate.expectedSku,
      observedAt: Number.isFinite(candidate.observed)
        ? new Date(candidate.observed).toISOString()
        : null,
    };
    try {
      const original = await readOriginal(
        application,
        candidate,
        invalidatedHashes
      );
      const key = `${receipt.sourceSha256}:${candidate.observed}:${original.parsed.offer.sku}`;
      receipt.sku = original.parsed.offer.sku;
      receipt.price = original.parsed.offer.price;
      if (replayed.has(key)) {
        results.push({ ...receipt, status: 'reused' });
        continue;
      }
      const result = await replayOriginal(application, candidate, original);
      replayed.add(key);
      results.push({
        ...receipt,
        status: 'reprocessed',
        cacheHit: true,
        category: result.product.category,
        packCount: result.product.packCount,
        netMassG: result.product.netMassG,
        netVolumeMl: result.product.netVolumeMl,
        currentOffer: await application.store.get('offer', result.offer.id),
      });
    } catch (error) {
      results.push({ ...receipt, status: 'rejected', error: error.message });
    }
  }
  return {
    reprocessedAt: new Date().toISOString(),
    mode: 'offline exact historical originals; URL aliases and original bytes retained',
    visibility: application.store.visibility,
    downloads: application.cache.stats.downloads - downloadsBefore,
    captures: results.length,
    reprocessed: results.filter((result) => result.status === 'reprocessed')
      .length,
    reused: results.filter((result) => result.status === 'reused').length,
    errors: results.filter((result) => result.status === 'rejected').length,
    results,
  };
}
