import { sha256 } from './util.js';
import { sourceInvalidationApplies } from './source-invalidation.js';

function references(record) {
  return [
    ...[record.id, record.url, record.sourceUrl, record.finalUrl]
      .filter(Boolean)
      .map((id) => `url:${id}`),
    ...[
      record.id,
      ...(Array.isArray(record.evidenceIds) ? record.evidenceIds : []),
    ]
      .filter(Boolean)
      .map((id) => `evidence:${id}`),
    ...[record.id, ...(Array.isArray(record.cacheIds) ? record.cacheIds : [])]
      .filter(Boolean)
      .map((id) => `cache:${id}`),
  ];
}

/** Index once per operation, without a source-count times quote-count scan. */
export async function loadBasketOriginalContext(store) {
  const invalidations = new Map();
  for (const record of await store.list('invalidation')) {
    for (const key of new Set(references(record))) {
      if (!invalidations.has(key)) {
        invalidations.set(key, []);
      }
      invalidations.get(key).push(record);
    }
  }
  return { invalidations };
}

function boundInvalidation(context, evidence, input, observedAt) {
  const keys = [
    `url:${input.sourceUrl}`,
    `evidence:${evidence.id}`,
    ...(evidence.cacheId ? [`cache:${evidence.cacheId}`] : []),
  ];
  return keys.some((key) =>
    context.invalidations.get(key)?.some((record) =>
      sourceInvalidationApplies(record, observedAt, {
        requireTimestamp: true,
      })
    )
  );
}

function assertOriginalEvidence(store, evidence, input) {
  if (
    !evidence?.html ||
    sourceInvalidationApplies(evidence, Date.parse(input.observedAt)) ||
    evidence.html.sha256 !== input.sourceSha256 ||
    (store.visibility === 'public' && evidence.visibility === 'private')
  ) {
    throw new Error(
      'Basket original source is missing, private or invalidated'
    );
  }
  const observedAt = Date.parse(input.observedAt);
  if (
    !Number.isFinite(observedAt) ||
    evidence.sourceUrl !== input.sourceUrl ||
    evidence.observedAt !== new Date(observedAt).toISOString()
  ) {
    throw new Error(
      'Basket original evidence URL or observation date mismatch'
    );
  }
  return observedAt;
}

/** Read retained original bytes only; invalidation never starts collection. */
export async function readBasketOriginal(store, input, suppliedContext) {
  const evidence = await store.get('evidence', input.evidenceId);
  const observedAt = assertOriginalEvidence(store, evidence, input);
  const cache =
    evidence.cacheId && (await store.get('cache', evidence.cacheId));
  const context = suppliedContext || (await loadBasketOriginalContext(store));
  if (
    (cache && sourceInvalidationApplies(cache, observedAt)) ||
    boundInvalidation(context, evidence, input, observedAt)
  ) {
    throw new Error('Invalidated basket original needs a fresh observation');
  }
  const bytes = await store.blob(input.sourceSha256);
  if (
    !bytes ||
    sha256(bytes) !== input.sourceSha256 ||
    bytes.length !== evidence.html.bytes
  ) {
    throw new Error('Basket original source bytes are missing or corrupt');
  }
  return { evidence, bytes };
}
