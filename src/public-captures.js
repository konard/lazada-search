import { parseHTML } from 'linkedom';
import { sanitizePublicHtml, sanitizePublicData } from './archive.js';
import { canonicalUrl, sha256 } from './util.js';
import { classifyPage, extractPage } from './browser.js';
import { parseProduct } from './products.js';
import { recordListingUnavailable } from './availability.js';
import { publishScopeDecisions } from './scope-decisions.js';

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
  let reused = 0;
  for (const capture of (await accountStore.list('cache')).filter((record) =>
    publishable(record, application.market)
  )) {
    try {
      if (capture.status === 'unavailable') {
        unavailablePublished.push(
          await publishUnavailable(application, accountStore, capture)
        );
        continue;
      }
      const original = parseProduct(capture.snapshot);
      assertSelectedPrice(original, capture.snapshot);
      const bytes = await accountStore.blob(capture.html.sha256);
      if (!bytes) {
        throw new Error('The captured product HTML is missing');
      }
      const html = sanitizePublicHtml(bytes.toString('utf8'));
      const sourceUrl = canonicalUrl(sanitizePublicData(capture.snapshot.url));
      const { document } = parseHTML(html);
      const snapshot = extractPage({ document, url: sourceUrl });
      const checked = parseProduct(snapshot);
      assertPreservedPrice(original, checked);
      const id = `public-capture:${sha256(`${sourceUrl}:${html}:${capture.fetchedAt}`)}`;
      const saved = await application.store.get('publication', id);
      if (saved) {
        published.push(saved);
        reused++;
        continue;
      }
      await publishImages(
        application.store,
        accountStore,
        snapshot.productImages || []
      );
      const observedAt = new Date(capture.fetchedAt).toISOString();
      const result = await application.importCapture({
        url: sourceUrl,
        html,
        observedAt,
      });
      const publicPage = await application.store.get(
        'cache',
        `lazada:${application.market}:${application.deliveryArea}:${result.offer.url}`
      );
      // Exact variant URLs are also reusable in a fresh archive-backed account.
      await application.store.put('cache', {
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
      await application.saveOffer({
        ...result.offer,
        priceContext: record.priceContext,
      });
      published.push(await application.store.put('publication', record));
    } catch (error) {
      rejected.push({
        url: sanitizePublicData(capture.url),
        reason: error.message,
      });
    }
  }
  const allPublished = await application.store.list('publication');
  const scopeDecisions = await publishScopeDecisions(
    application.store,
    accountStore
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
    downloads: application.cache.stats.downloads,
  };
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

async function publishImages(publicStore, accountStore, urls) {
  for (const imageUrl of urls) {
    const source = await accountStore.get(
      'cache',
      `image:${canonicalUrl(imageUrl)}`
    );
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
