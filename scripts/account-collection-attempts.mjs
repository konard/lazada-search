import { canonicalUrl, sha256 } from '../src/util.js';

export async function attemptedCollectionUrls(store, { refresh = false } = {}) {
  if (refresh) {
    return [];
  }
  const attempts = await store.list('collection-attempt');
  const urls = await Promise.all(
    attempts.map(async (record) => {
      const invalidation = await store.get('invalidation', record.url);
      return Date.parse(invalidation?.invalidatedAt) >=
        Date.parse(record.attemptedAt)
        ? undefined
        : record.url;
    })
  );
  return urls.filter(Boolean);
}

export function recordCollectionAttempt(store, url, result) {
  const canonical = canonicalUrl(url);
  return store.put('collection-attempt', {
    id: `attempt:${sha256(canonical)}`,
    url: canonical,
    ...result,
    attemptedAt: new Date().toISOString(),
  });
}
