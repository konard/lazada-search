import { readFile } from 'node:fs/promises';
import { sanitizePublicData } from './archive.js';
import { publicationFingerprint } from './publication-cache.js';
import { EXTRACTOR_VERSION } from './browser.js';
import { sha256 } from './util.js';

export function discoveryDigest(value) {
  const keys = new Set();
  JSON.stringify(value, (key, child) => {
    keys.add(key);
    return child;
  });
  return sha256(JSON.stringify(value, [...keys].sort()));
}

// Discovery has its own producer code in addition to the shared extraction and
// redaction pipeline. Freeze this identity with the modules loaded by this process.
const fingerprint = Promise.all([
  publicationFingerprint(),
  readFile(new URL('./public-discovery.js', import.meta.url)),
  readFile(new URL('./discovery-publication-cache.js', import.meta.url)),
]).then(([shared, producer, helper]) =>
  discoveryDigest({
    shared,
    producer: sha256(producer),
    helper: sha256(helper),
  })
);
export const discoveryPublicationFingerprint = () => fingerprint;

export function discoveryObservedAt(record, fallback) {
  for (const value of [
    record?.observedAt,
    record?.fetchedAt,
    record?.finishedAt,
    record?.startedAt,
    fallback,
  ]) {
    const time = typeof value === 'number' ? value : Date.parse(value);
    if (Number.isFinite(time)) {
      return new Date(time).toISOString();
    }
  }
  return undefined;
}

export function discoverySourceContext(application, capture, bytes, pipeline) {
  if (
    !bytes?.length ||
    sha256(bytes) !== capture.html.sha256 ||
    (capture.html.bytes !== undefined && capture.html.bytes !== bytes.length)
  ) {
    throw new Error('Original search HTML digest or length is invalid');
  }
  if (capture.invalidatedAt) {
    throw new Error('Invalidated search source requires reloading');
  }
  const observedAt = discoveryObservedAt({ fetchedAt: capture.fetchedAt });
  if (!observedAt) {
    throw new Error('Search publication requires an original observation time');
  }
  const url = sanitizePublicData(capture.url);
  const finalUrl = sanitizePublicData(capture.snapshot?.url);
  application.assertMarket(url);
  application.assertMarket(finalUrl);
  const input = {
    sourceHtmlSha256: capture.html.sha256,
    sourceHtmlBytes: bytes.length,
    sourceSnapshotSha256: discoveryDigest(capture.snapshot),
    sourceIdentitySha256: discoveryDigest([
      capture.id,
      capture.url,
      capture.snapshot.url,
    ]),
    sourceMetadataSha256: discoveryDigest({
      checkedAt: capture.checkedAt,
      scrolling: capture.scrolling,
    }),
    pipelineFingerprint: pipeline,
    cacheId: sanitizePublicData(capture.id),
    url,
    finalUrl,
    observedAt,
    market: application.market,
    deliveryArea: application.deliveryArea,
  };
  return {
    ...input,
    id: `discovery-publication-source:${discoveryDigest(input)}`,
  };
}

export async function verifyDiscoveryBlob(store, blob) {
  if (!blob?.sha256) {
    return false;
  }
  const bytes = await store.blob(blob.sha256).catch(() => undefined);
  return Boolean(
    bytes?.length &&
    sha256(bytes) === blob.sha256 &&
    (blob.bytes === undefined || bytes.length === blob.bytes)
  );
}

function matchingProof(proof, context) {
  return (
    proof &&
    proof.snapshot &&
    Object.keys(context).every((key) => proof[key] === context[key]) &&
    proof.contextSha256 === discoveryDigest(context) &&
    proof.visibility !== 'private' &&
    proof.outputSnapshotSha256 === discoveryDigest(proof.snapshot)
  );
}

async function newerDiscoveryOutputMatches(store, cache) {
  const record =
    cache.discoveryPublicationId &&
    (await store.get('discovery-publication', cache.discoveryPublicationId));
  return Boolean(
    record &&
    record.visibility !== 'private' &&
    record.cacheId === cache.id &&
    record.html?.sha256 === cache.html.sha256 &&
    record.observedAt === discoveryObservedAt(cache) &&
    record.snapshotSha256 === discoveryDigest(cache.snapshot)
  );
}

function matchingPublication(record, proof, context) {
  return (
    record &&
    record.visibility !== 'private' &&
    record.observedAt === context.observedAt &&
    record.cacheId === context.cacheId &&
    record.snapshotSha256 === proof.outputSnapshotSha256 &&
    discoveryDigest(record) === proof.publicationSha256
  );
}

function viableSearchCache(cache, sourceTime) {
  const time = Date.parse(discoveryObservedAt(cache));
  return Boolean(
    cache &&
    cache.visibility !== 'private' &&
    !cache.invalidatedAt &&
    cache.status === 'ok' &&
    cache.extractorVersion === EXTRACTOR_VERSION &&
    cache.repositoryReusable &&
    cache.html &&
    cache.extractedHtmlSha256 === cache.html.sha256 &&
    Number.isFinite(time) &&
    time >= sourceTime
  );
}

export async function reusableDiscoveryPublication(application, context) {
  const store = application.store;
  const proof = await store.get('discovery-publication-source', context.id);
  if (!matchingProof(proof, context)) {
    return undefined;
  }
  const record = await store.get('discovery-publication', proof.publicationId);
  if (
    !matchingPublication(record, proof, context) ||
    !(await verifyDiscoveryBlob(store, record.html))
  ) {
    return undefined;
  }
  const cache = await store.get('cache', context.cacheId);
  const cacheTime = Date.parse(discoveryObservedAt(cache));
  const sourceTime = Date.parse(context.observedAt);
  if (
    !viableSearchCache(cache, sourceTime) ||
    !(await verifyDiscoveryBlob(store, cache.html))
  ) {
    return undefined;
  }
  if (
    cacheTime === sourceTime &&
    (cache.html.sha256 !== record.html.sha256 ||
      discoveryDigest(cache.snapshot) !== proof.outputSnapshotSha256)
  ) {
    return undefined;
  }
  if (
    cacheTime > sourceTime &&
    !(await newerDiscoveryOutputMatches(store, cache))
  ) {
    return undefined;
  }
  return record;
}

export async function saveDiscoveryProof(store, context, record, snapshot) {
  return await store.put('discovery-publication-source', {
    ...context,
    contextSha256: discoveryDigest(context),
    publicationId: record.id,
    publicationSha256: discoveryDigest(record),
    outputSnapshotSha256: discoveryDigest(snapshot),
    snapshot,
  });
}

export async function discoveryPublicationId(store, context, blob) {
  const identity = `${context.cacheId}:${blob.sha256}`;
  const id = `discovery-publication:${sha256(identity)}`;
  const previous = await store.get('discovery-publication', id);
  return !previous || previous.observedAt === context.observedAt
    ? id
    : `discovery-publication:${sha256(`${identity}:${context.observedAt}`)}`;
}

export async function saveDiscoveryMetadata(store, kind, record) {
  const current = await store.get(kind, record.id);
  if (current && discoveryDigest(current) === discoveryDigest(record)) {
    return current;
  }
  return store.putLatest(kind, record);
}

// The atomic writer reads legacy timestamps through this view, so a search
// cache without an observedAt field still protects its newer fetchedAt.
export function discoveryPublicationStore(store) {
  if (!store.putLatest) {
    throw new Error(
      'Discovery publication requires a chronological store writer'
    );
  }
  const view = new Proxy(store, {
    get(target, property) {
      if (property === 'get') {
        return async (kind, id) => {
          const record = await target.get(kind, id);
          const observedAt = discoveryObservedAt(record);
          return record && observedAt ? { ...record, observedAt } : record;
        };
      }
      if (property === 'putLatest') {
        return (kind, record) =>
          Reflect.apply(target.putLatest, view, [kind, record]);
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return view;
}
