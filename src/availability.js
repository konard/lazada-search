import { parseHTML } from 'linkedom';
import { classifyPage, extractPage } from './browser.js';
import { canonicalUrl, listingKey, sha256 } from './util.js';

const time = (value) =>
  (typeof value === 'number' ? value : Date.parse(value)) || 0;

export class ListingUnavailableError extends Error {
  constructor(url, evidence) {
    super(`Listing is unavailable: ${url}`);
    this.name = 'ListingUnavailableError';
    this.code = 'PAGE_UNAVAILABLE';
    this.url = url;
    this.evidence = evidence;
  }
}

// A transport failure, empty loader, login wall or CAPTCHA is never deletion
// evidence. Confirm the saved original DOM and the exact product identity.
export async function recordListingUnavailable(store, capture, url) {
  if (capture.status !== 'unavailable' || !capture.html?.sha256) {
    return undefined;
  }
  const requested = canonicalUrl(url || capture.url);
  const finalUrl = canonicalUrl(capture.finalUrl || capture.snapshot?.url);
  if (
    !/\/products\/.*-i\d+(?:-s\d+)?\.html$/u.test(
      new URL(requested).pathname
    ) ||
    new URL(requested).hostname.replace(/^www\./u, '') !==
      new URL(finalUrl).hostname.replace(/^www\./u, '') ||
    listingKey(requested) !== listingKey(finalUrl) ||
    !time(capture.fetchedAt)
  ) {
    return undefined;
  }
  const bytes = await store.blob(capture.html.sha256);
  if (!bytes || sha256(bytes) !== capture.html.sha256) {
    return undefined;
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const snapshot = extractPage({ document, url: finalUrl });
  if (classifyPage(snapshot) !== 'unavailable') {
    return undefined;
  }
  const observedAt = new Date(capture.fetchedAt).toISOString();
  const id = `unavailable:${sha256(`${listingKey(requested)}:${observedAt}:${capture.html.sha256}`)}`;
  const html = await store.putBlob(bytes);
  const record = {
    id,
    url: requested,
    finalUrl,
    listingKey: listingKey(requested),
    status: 'unavailable',
    verification: 'original-html-confirmed',
    observedAt,
    html,
    cacheId: capture.id,
    notice: snapshot.title,
  };
  await store.put('evidence', {
    ...record,
    role: 'availability',
    sourceUrl: finalUrl,
  });
  return store.put('listing-availability', record);
}

const verified = (entry) =>
  entry?.status === 'unavailable' &&
  entry.verification === 'original-html-confirmed' &&
  !entry.invalidatedAt &&
  /^[a-f\d]{64}$/u.test(entry.html?.sha256 || '') &&
  time(entry.observedAt) > 0;

export function currentUnavailableListings(
  records = [],
  offers = [],
  invalidations = []
) {
  const latest = new Map();
  for (const record of records.filter(verified)) {
    const key = listingKey(record.url);
    if (
      invalidations.some(
        (entry) =>
          listingKey(entry.url) === key &&
          time(entry.invalidatedAt) >= time(record.observedAt)
      )
    ) {
      continue;
    }
    if (time(record.observedAt) > time(latest.get(key)?.observedAt)) {
      latest.set(key, record);
    }
  }
  for (const offer of offers.filter(
    (entry) => !entry.supersededBy && entry.price > 0 && entry.variantConfirmed
  )) {
    const key = listingKey(offer.url);
    const removed = latest.get(key);
    if (removed && time(offer.observedAt) > time(removed.observedAt)) {
      latest.delete(key);
    }
  }
  return latest;
}

export function applyListingAvailability(
  offers,
  records = [],
  invalidations = []
) {
  const unavailable = currentUnavailableListings(
    records,
    offers,
    invalidations
  );
  return offers.map((offer) => {
    const removed = unavailable.get(listingKey(offer.url));
    return removed
      ? {
          ...offer,
          available: false,
          listingUnavailableAt: removed.observedAt,
          availabilityEvidenceId: removed.id,
          availabilitySourceSha256: removed.html.sha256,
        }
      : { ...offer };
  });
}
