import { parseHTML } from 'linkedom';
import { sanitizePublicHtml, sanitizePublicData } from './archive.js';
import { canonicalUrl, sha256 } from './util.js';
import { classifyPage, extractPage } from './browser.js';
import { parseProduct } from './products.js';
import { recordListingUnavailable } from './availability.js';
import { publishScopeDecisions } from './scope-decisions.js';
import { publishPublicProductImageOcr } from './public-product-ocr.js';
import {
  publicationApplication,
  publicationFingerprint,
  publicationSourceContext,
  reusablePublication,
  savePublicationProof,
} from './publication-cache.js';

const capturePriceContext = (capture) =>
  capture.priceContext || 'private-profile-browser-observation';
const publishable = (record, market) =>
  record.visibility === 'private' &&
  ['ok', 'unavailable'].includes(record.status) &&
  record.html &&
  record.id.startsWith(`lazada:${market}:`);

function assertSelectedPrice({ offer }, snapshot) {
  if (!(offer.price > 0) || !offer.variantConfirmed || !snapshot.sku) {
    throw new Error('The requested SKU and its price were not confirmed');
  }
}

function assertPreservedPrice(original, checked) {
  if (
    checked.offer.sku !== original.offer.sku ||
    checked.offer.price !== original.offer.price ||
    !checked.offer.variantConfirmed
  ) {
    throw new Error(
      'Redacted HTML did not preserve the exact selected SKU and price'
    );
  }
}

// Rebuild public records from redacted product DOM. Account records, account
// screenshots, cookies, authentication forms and private raw text are not copied.
export async function publishAccountCaptures(application, accountStore) {
  if (application.store.visibility !== 'public' || !application.cache.offline) {
    throw new Error(
      'Product publication requires an offline public application'
    );
  }
  if (accountStore.visibility !== 'private') {
    throw new Error('Product publication requires a private source store');
  }
  const published = [];
  const rejected = [];
  const unavailablePublished = [];
  const fingerprint = await publicationFingerprint();
  const sourceRecords = await accountStore.list('cache');
  const sourceCache = new Map(
    sourceRecords.map((record) => [record.id, record])
  );
  let reused = 0;
  for (const capture of sourceRecords.filter((record) =>
    publishable(record, application.market)
  )) {
    try {
      if (capture.status === 'unavailable') {
        unavailablePublished.push(
          await publishUnavailable(application, accountStore, capture)
        );
        continue;
      }
      const result = await publishProductCapture(
        application,
        accountStore,
        capture,
        fingerprint,
        sourceCache
      );
      published.push(result.record);
      reused += Number(result.reused);
    } catch (error) {
      rejected.push({
        url: sanitizePublicData(capture.url),
        reason: error.message,
      });
    }
  }
  const allPublished = (await application.store.list('publication')).filter(
    (record) => record.visibility !== 'private'
  );
  const scopeDecisions = await publishScopeDecisions(
    application.store,
    accountStore
  );
  const ocrPublication = await publishPublicProductImageOcr(
    application.store,
    accountStore,
    {
      publications: published,
      sourceRecords,
    }
  );
  const currentIds = new Set(published.map((record) => record.id));
  return {
    published,
    historicalPublished: allPublished.filter(
      (record) => !currentIds.has(record.id)
    ),
    allPublished,
    rejected,
    reused,
    unavailablePublished,
    scopeDecisions,
    ocrPublication,
    downloads: application.cache.stats.downloads,
  };
}

async function publishProductCapture(
  application,
  accountStore,
  capture,
  fingerprint,
  sourceCache
) {
  const bytes = await accountStore.blob(capture.html.sha256);
  const sourceImages = (capture.snapshot.productImages || []).map((url) => {
    const source = sourceCache.get(`image:${canonicalUrl(url)}`);
    return {
      urlSha256: sha256(url),
      sha256: source?.blob?.sha256,
      contentType: source?.contentType,
      invalidatedAt: source?.invalidatedAt,
    };
  });
  const context = publicationSourceContext(
    application,
    capture,
    bytes,
    fingerprint,
    sourceImages
  );
  const saved = await reusablePublication(application, context);
  if (saved) {
    return { record: saved, reused: true };
  }
  const original = parseProduct(capture.snapshot);
  assertSelectedPrice(original, capture.snapshot);
  const html = sanitizePublicHtml(bytes.toString('utf8'));
  const { sourceUrl, observedAt } = context;
  const { document } = parseHTML(html);
  const snapshot = extractPage({ document, url: sourceUrl });
  const checked = parseProduct(snapshot);
  assertPreservedPrice(original, checked);
  const id = `public-capture:${sha256(`${sourceUrl}:${html}:${capture.fetchedAt}`)}`;
  await publishImages(
    application.store,
    accountStore,
    snapshot.productImages || [],
    sourceCache
  );
  const { view, state } = publicationApplication(application);
  const result = await view.importCapture({ url: sourceUrl, html, observedAt });
  assertPreservedPrice(original, result);
  const publicPage = state.page;
  await view.store.put('cache', {
    ...publicPage,
    id: `lazada:${application.market}:${application.deliveryArea}:${sourceUrl}`,
    url: sourceUrl,
    finalUrl: sourceUrl,
    snapshot: { ...publicPage.snapshot, url: sourceUrl },
  });
  const record = {
    id,
    url: result.offer.url,
    sourceUrl,
    sku: result.offer.sku,
    category: result.product.category,
    price: result.offer.price,
    observedAt,
    html: publicPage.html,
    offerId: result.offer.id,
    priceContext: capturePriceContext(capture),
    exactSkuConfirmed: true,
    manualVisualReview: false,
  };
  await view.saveOffer({ ...result.offer, priceContext: record.priceContext });
  const publication = await application.store.put('publication', record);
  await savePublicationProof(application, context, publication);
  return { record: publication, reused: false };
}

async function publishUnavailable(application, accountStore, capture) {
  const source = await recordListingUnavailable(
    accountStore,
    capture,
    capture.url
  );
  if (!source) {
    throw new Error(
      'Unavailable listing was not confirmed by its original HTML'
    );
  }
  const bytes = await accountStore.blob(source.html.sha256);
  const html = sanitizePublicHtml(bytes.toString('utf8'));
  const url = canonicalUrl(sanitizePublicData(source.url));
  const finalUrl = canonicalUrl(sanitizePublicData(source.finalUrl));
  const { document } = parseHTML(html);
  const snapshot = extractPage({ document, url: finalUrl });
  if (classifyPage(snapshot) !== 'unavailable') {
    throw new Error('Redacted HTML did not preserve the unavailable notice');
  }
  const publicCapture = {
    id: `lazada:${application.market}:${application.deliveryArea}:${url}`,
    url,
    finalUrl,
    snapshot,
    status: 'unavailable',
    html: await application.store.putBlob(Buffer.from(html)),
    fetchedAt: capture.fetchedAt,
    checkedAt: capture.checkedAt || capture.fetchedAt,
    repositoryReusable: true,
    availabilityVerified: true,
  };
  await application.store.put('cache', publicCapture);
  const evidence = await recordListingUnavailable(
    application.store,
    publicCapture,
    url
  );
  if (!evidence) {
    throw new Error('Public unavailable listing verification failed');
  }
  return application.store.put('availability-publication', {
    id: evidence.id,
    url,
    observedAt: evidence.observedAt,
    availabilityEvidenceId: evidence.id,
    html: evidence.html,
    originalSourceSha256: source.html.sha256,
    status: 'unavailable',
    redactionApplied: true,
  });
}

async function publishImages(publicStore, accountStore, urls, sourceCache) {
  for (const imageUrl of urls) {
    const source = sourceCache.get(`image:${canonicalUrl(imageUrl)}`);
    if (!source?.blob || source.invalidatedAt) {
      continue;
    }
    const bytes = await accountStore.blob(source.blob.sha256);
    if (!bytes) {
      continue;
    }
    const url = canonicalUrl(sanitizePublicData(imageUrl));
    await publicStore.put('cache', {
      id: `image:${url}`,
      url,
      blob: await publicStore.putBlob(bytes),
      contentType: source.contentType,
      fetchedAt: source.fetchedAt,
      checkedAt: source.checkedAt,
      repositoryReusable: true,
    });
  }
}
