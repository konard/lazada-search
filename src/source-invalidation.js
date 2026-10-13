function timestamp(value) {
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}

/** Cache metadata is not itself an invalidation; bound invalidation records are. */
export function sourceInvalidationApplies(
  record,
  observedAt,
  { requireTimestamp = false } = {}
) {
  if (record.active === false || record.invalidated === false) {
    return false;
  }
  if (
    record.resolvedAt !== undefined &&
    record.resolvedAt !== null &&
    record.resolvedAt !== ''
  ) {
    return !Number.isFinite(timestamp(record.resolvedAt));
  }
  if (record.invalidated) {
    return true;
  }
  if (
    record.invalidatedAt === undefined ||
    record.invalidatedAt === null ||
    record.invalidatedAt === ''
  ) {
    return requireTimestamp;
  }
  const time = timestamp(record.invalidatedAt);
  return (
    !Number.isFinite(time) || !Number.isFinite(observedAt) || time >= observedAt
  );
}

function urlsOf(record) {
  return [record.url, record.sourceUrl, record.finalUrl].filter(
    (value) => typeof value === 'string' && value
  );
}

function contains(values, id) {
  return Boolean(id && Array.isArray(values) && values.includes(id));
}

function sourceCache(record, source, urls) {
  return (
    (source.id && record.id === source.id) ||
    (source.cacheId && record.id === source.cacheId) ||
    (record.requestFingerprint &&
      record.requestFingerprint === source.requestFingerprint) ||
    urlsOf(record).some((url) => urls.has(url))
  );
}

function boundInvalidation(record, source, urls, cacheIds) {
  return (
    urls.has(record.id) ||
    urlsOf(record).some((url) => urls.has(url)) ||
    (source.id && record.id === source.id) ||
    contains(record.evidenceIds, source.id) ||
    contains(record.sourceIds, source.id) ||
    (Array.isArray(record.cacheIds) &&
      record.cacheIds.some((id) => cacheIds.has(id)))
  );
}

export function workflowSourceInvalidated(
  source,
  cacheRecords = [],
  invalidations = []
) {
  const date = Number.isFinite(source.fetchedAt)
    ? source.fetchedAt
    : timestamp(source.observedAt);
  if (sourceInvalidationApplies(source, date)) {
    return true;
  }
  const urls = new Set(urlsOf(source));
  const cache = cacheRecords.filter((record) =>
    sourceCache(record, source, urls)
  );
  const cacheIds = new Set(
    [source.cacheId, ...cache.map((record) => record.id)].filter(Boolean)
  );
  return (
    cache.some((record) => sourceInvalidationApplies(record, date)) ||
    invalidations.some(
      (record) =>
        boundInvalidation(record, source, urls, cacheIds) &&
        sourceInvalidationApplies(record, date, { requireTimestamp: true })
    )
  );
}
