export function workflowSourceInvalidated(source, cacheRecords, invalidations) {
  if (source.invalidated || source.invalidatedAt) {
    return true;
  }
  const urls = new Set([source.url, source.finalUrl].filter(Boolean));
  const cache = cacheRecords.filter(
    (record) =>
      record.id === source.id ||
      record.id === source.cacheId ||
      (record.requestFingerprint &&
        record.requestFingerprint === source.requestFingerprint) ||
      urls.has(record.url)
  );
  const date = Date.parse(source.observedAt);
  return [
    ...cache,
    ...invalidations.filter(
      (record) =>
        urls.has(record.url) ||
        record.evidenceIds?.includes(source.id) ||
        record.sourceIds?.includes(source.id) ||
        record.cacheIds?.some(
          (id) =>
            id === source.cacheId || cache.some((entry) => entry.id === id)
        )
    ),
  ].some(
    (record) =>
      record.active !== false &&
      record.invalidated !== false &&
      !record.resolvedAt &&
      (record.invalidated === true ||
        (record.invalidatedAt &&
          (!Number.isFinite(date) || Date.parse(record.invalidatedAt) >= date)))
  );
}
