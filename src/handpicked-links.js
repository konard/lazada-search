import { canonicalUrl, sha256, listingKey } from './util.js';
import { parseProduct } from './products.js';
import { assertCollectionRunning } from './page-challenge.js';
import { requestedSku } from './variant-policy.js';
import { parseHTML } from 'linkedom';
import { extractPage, classifyPage } from './browser.js';

function submittedUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/^(?:(?:www|s)\.)?lazada\.vn$/u.test(url.hostname)
  ) {
    throw new Error(
      'Handpicked links must be credential-free Vietnam Lazada URLs'
    );
  }
  return url.href;
}

function productUrl(value) {
  try {
    const url = new URL(submittedUrl(value));
    return /\/products\/.*-i\d+(?:-s\d+)?\.html$/u.test(url.pathname)
      ? canonicalUrl(url.href)
      : null;
  } catch {
    return null;
  }
}

export function handpickedIdentityFromUrl(value) {
  const url = productUrl(value);
  if (!url) {
    return null;
  }
  const itemId = new URL(url).pathname.match(/-i(\d+)/u)?.[1];
  const skuId = requestedSku(url);
  return {
    resolvedUrl: url,
    listingId: itemId,
    sku: /^\d+$/u.test(skuId || '') ? `${itemId}_VNAMZ-${skuId}` : null,
    resolutionBasis: 'submitted-product-url',
  };
}

function sameUrl(left, right) {
  try {
    return canonicalUrl(left) === canonicalUrl(right);
  } catch {
    return false;
  }
}

function sameListing(left, right) {
  try {
    return listingKey(left) === listingKey(right);
  } catch {
    return false;
  }
}

const sourceTime = (value) =>
  typeof value === 'number' ? value : Date.parse(value);

function invalidated(entry, records, cache) {
  const observedAt = sourceTime(entry.observedAt);
  if (
    entry.invalidated ||
    entry.invalidatedAt ||
    cache?.invalidated ||
    cache?.invalidatedAt
  ) {
    return true;
  }
  return records.some((record) => {
    const matches =
      [entry.submittedUrl, entry.resolvedUrl].some(
        (url) => url && sameUrl(record.url, url)
      ) ||
      record.cacheIds?.includes(entry.cacheId) ||
      record.evidenceIds?.includes(entry.evidenceId);
    if (!matches) {
      return false;
    }
    const time = sourceTime(record.invalidatedAt);
    return (
      record.invalidated === true ||
      !Number.isFinite(time) ||
      !Number.isFinite(observedAt) ||
      time >= observedAt
    );
  });
}

function newestOffers(offers, identity, invalidations) {
  if (!identity?.resolvedUrl || !identity.sku) {
    return [];
  }
  const candidates = offers.filter((offer) => {
    const observed = sourceTime(offer.observedAt);
    return (
      !offer.supersededBy &&
      offer.sku === identity.sku &&
      sameListing(offer.url, identity.resolvedUrl) &&
      offer.currency === 'VND' &&
      Number.isFinite(offer.price) &&
      offer.price > 0 &&
      offer.variantConfirmed === true &&
      offer.available !== false &&
      !offer.priceInvalidated &&
      Number.isFinite(observed) &&
      observed <= Date.now() + 60000 &&
      !invalidated({ ...identity, observedAt: offer.observedAt }, invalidations)
    );
  });
  if (!candidates.length) {
    return [];
  }
  const latest = Math.max(
    ...candidates.map((offer) => sourceTime(offer.observedAt))
  );
  const rows = candidates.filter(
    (offer) => sourceTime(offer.observedAt) === latest
  );
  return new Set(rows.map((offer) => offer.price)).size === 1 ? rows : [];
}

function normalizedObservedSku(url, value) {
  if (!value) {
    return null;
  }
  const itemId = new URL(url).pathname.match(/-i(\d+)/u)?.[1];
  const number = String(value).split('_VNAMZ-').at(-1);
  const explicitItem = String(value).includes('_VNAMZ-')
    ? String(value).split('_VNAMZ-')[0]
    : itemId;
  return itemId && explicitItem === itemId && /^\d+$/u.test(number)
    ? `${itemId}_VNAMZ-${number}`
    : null;
}

async function verifiedAlias(application, entry, invalidations) {
  if (
    !entry.sourceVerified ||
    !productUrl(entry.resolvedUrl) ||
    !/^[a-f\d]{64}$/u.test(entry.sourceSha256 || '') ||
    !entry.cacheId
  ) {
    return null;
  }
  const cache = await application.store.get('cache', entry.cacheId);
  const bytes = await application.store.blob(entry.sourceSha256);
  const observed = sourceTime(entry.observedAt);
  if (
    !bytes ||
    sha256(bytes) !== entry.sourceSha256 ||
    cache?.html?.sha256 !== entry.sourceSha256 ||
    (cache.html.bytes !== undefined && cache.html.bytes !== bytes.length) ||
    cache.status !== 'ok' ||
    !sameUrl(cache.url, entry.submittedUrl) ||
    !sameUrl(cache.finalUrl || cache.snapshot?.url, entry.resolvedUrl) ||
    !Number.isFinite(observed) ||
    observed !== sourceTime(cache.fetchedAt) ||
    observed > Date.now() + 60000 ||
    invalidated(entry, invalidations, cache)
  ) {
    return null;
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const snapshot = extractPage({ document, url: entry.resolvedUrl });
  if (classifyPage(snapshot) !== 'ok') {
    return null;
  }
  const parsed = parseProduct(snapshot, {
    market: 'vn',
    currency: 'VND',
    observedAt: entry.observedAt,
    originalHtmlSha256: entry.sourceSha256,
    evidenceId: cache.id,
  });
  const sku = parsed.offer.variantConfirmed
    ? normalizedObservedSku(entry.resolvedUrl, parsed.offer.sku)
    : null;
  if (entry.sku && entry.sku !== sku) {
    return null;
  }
  return {
    ...entry,
    sku,
    sourceVerified: true,
    resolutionBasis: 'sha-bound-original-redirect',
    sourceValidation: 'cache-original-digest-and-observation-verified',
  };
}

async function projectedLink(application, entry, offers, invalidations) {
  const direct = handpickedIdentityFromUrl(entry.submittedUrl);
  const verified = direct?.sku
    ? null
    : await verifiedAlias(application, entry, invalidations);
  const identity =
    verified ||
    (direct
      ? {
          ...entry,
          ...direct,
          sourceVerified: true,
          sourceValidation: 'exact-submitted-product-url',
          observedAt: entry.observedAt || entry.registeredAt,
        }
      : null);
  if (!identity || invalidated(identity, invalidations)) {
    return {
      ...entry,
      status: 'resolution-review-required',
      sourceVerified: false,
      resolvedUrl: null,
      sku: null,
      capturedOfferIds: [],
      reason:
        'No accessible matching original redirect or direct product identity; supplied mappings are unverified',
    };
  }
  const captured = newestOffers(offers, identity, invalidations);
  return {
    ...identity,
    capturedOfferIds: captured.map((offer) => offer.id),
    status: captured.length
      ? 'captured'
      : identity.sku
        ? 'resolved-price-and-exact-sku-pending'
        : 'resolved-listing-exact-sku-pending',
    priceObservedAt: captured[0]?.observedAt || null,
    priceFreshness: captured.length
      ? Date.now() - sourceTime(captured[0].observedAt) > 86400000
        ? 'stale'
        : 'within-one-day'
      : 'unpriced',
    reason: captured.length
      ? null
      : 'Exact selected SKU with a current non-invalidated positive price is not collected',
  };
}

/** Read-only verified alias projection shared by reports and link status. */
export async function validatedHandpickedLinks(application, { offers } = {}) {
  const records = await application.store.list('handpicked-link');
  const observed = offers || (await application.store.list('offer'));
  const invalidations = await application.store.list('invalidation');
  const links = [];
  for (const entry of records) {
    links.push(
      await projectedLink(application, entry, observed, invalidations)
    );
  }
  return links;
}

export async function registerHandpickedLinks(
  application,
  { links = [] } = {}
) {
  if (!Array.isArray(links) || links.length > 1000) {
    throw new Error('Handpicked links need a bounded array');
  }
  const results = [],
    offers = await application.store.list('offer'),
    invalidations = await application.store.list('invalidation');
  for (const [index, entry] of links.entries()) {
    const input = typeof entry === 'string' ? { submittedUrl: entry } : entry;
    const url = submittedUrl(input.submittedUrl || input.url);
    const id = `handpicked-link:${sha256(url)}`;
    const existing = await application.store.get('handpicked-link', id);
    const direct = handpickedIdentityFromUrl(url);
    const record = existing || {
      id,
      submittedUrl: url,
      resolvedUrl: direct?.resolvedUrl || null,
      sku: direct?.sku || null,
      proposedResolvedUrl: input.resolvedUrl || null,
      proposedSku: input.sku || null,
      status: direct ? 'resolved-price-and-exact-sku-pending' : 'pending',
      registeredAt: new Date().toISOString(),
      sourceVerified: false,
    };
    const saved = await application.store.put(
      'handpicked-link',
      await projectedLink(application, record, offers, invalidations)
    );
    results.push({ ...saved, submittedIndex: index });
  }
  return {
    submissions: results,
    uniqueLinks: new Set(results.map((item) => item.id)).size,
    automaticSkuSelectionApproved: false,
  };
}

export async function resolveHandpickedLinks(application, options = {}) {
  if (options.allowNetwork !== true && !application.cache.offline) {
    throw new Error('Cached-only link resolution needs an offline application');
  }
  const entries = await application.store.list('handpicked-link'),
    offers = await application.store.list('offer'),
    invalidations = await application.store.list('invalidation');
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Handpicked resolution needs a bounded positive limit');
  }
  if (
    options.linkIds &&
    (!Array.isArray(options.linkIds) || options.linkIds.length > 1000)
  ) {
    throw new Error('Handpicked link IDs require a bounded array');
  }
  const selected = options.linkIds
    ? entries.filter((entry) => options.linkIds.includes(entry.id))
    : entries;
  const results = [];
  for (const entry of selected.slice(0, limit)) {
    const projected = await projectedLink(
      application,
      entry,
      offers,
      invalidations
    );
    if (
      projected.sourceVerified &&
      (projected.status === 'captured' || options.allowNetwork !== true)
    ) {
      const saved = await application.store.put('handpicked-link', projected);
      results.push({ ...saved, reused: true });
      continue;
    }
    try {
      if (options.allowNetwork === true) {
        await assertCollectionRunning(application.store);
      }
      const capture = await application.collector.page(entry.submittedUrl, {
        namespace: `handpicked:${application.market}:${application.deliveryArea}`,
        flavourScope: 'chocolate-or-unflavoured',
      });
      const resolvedUrl = productUrl(
        capture.finalUrl || capture.snapshot?.url || ''
      );
      if (!resolvedUrl || capture.status !== 'ok' || !capture.html?.sha256) {
        throw new Error(
          'Submitted link did not resolve to a captured target product page'
        );
      }
      application.assertMarket(resolvedUrl);
      const original = await application.store.blob(capture.html.sha256);
      if (!original || sha256(original) !== capture.html.sha256) {
        throw new Error('Resolved link original is missing or corrupt');
      }
      const observedAt = new Date(capture.fetchedAt).toISOString();
      const parsed = parseProduct(capture.snapshot, {
        market: application.market,
        currency: 'VND',
        observedAt,
        originalHtmlSha256: capture.html.sha256,
        evidenceId: capture.id,
      });
      const candidate = {
        ...entry,
        resolvedUrl,
        sku: parsed.offer.variantConfirmed
          ? normalizedObservedSku(resolvedUrl, parsed.offer.sku)
          : null,
        sourceSha256: capture.html.sha256,
        cacheId: capture.id,
        observedAt,
        sourceVerified: true,
        status: 'resolved-price-and-exact-sku-pending',
      };
      delete candidate.invalidated;
      delete candidate.invalidatedAt;
      results.push(
        await application.store.put(
          'handpicked-link',
          await projectedLink(application, candidate, offers, invalidations)
        )
      );
    } catch (error) {
      results.push(
        await application.store.put('handpicked-link', {
          ...entry,
          status: 'blocked',
          reason: error.message,
          errorCode: error.code || null,
        })
      );
      if (error.code === 'COLLECTION_STOPPED') {
        break;
      }
    }
  }
  return {
    links: results,
    codeValidation: 'draft-untested',
    pending: results.filter((entry) => entry.status !== 'captured').length,
  };
}

export async function handpickedLinkStatus(application) {
  return {
    links: await validatedHandpickedLinks(application),
    membershipRequiresExactSelectedSku: true,
    codeValidation: 'draft-untested',
  };
}
