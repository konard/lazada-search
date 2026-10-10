import { parseHTML } from 'linkedom';
import { sanitizePublicHtml, sanitizePublicData } from './archive.js';
import { canonicalUrl, sha256 } from './util.js';
import { extractPage } from './browser.js';
import { parseProduct } from './products.js';

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
  let reused = 0;
  for (const capture of (await accountStore.list('cache')).filter(
    (record) =>
      record.visibility === 'private' &&
      record.status === 'ok' &&
      record.html &&
      record.id.startsWith(`lazada:${application.market}:`)
  )) {
    try {
      const original = parseProduct(capture.snapshot);
      if (
        !(original.offer.price > 0) ||
        !original.offer.variantConfirmed ||
        !capture.snapshot.sku
      ) {
        throw new Error('The requested SKU and its price were not confirmed');
      }
      const bytes = await accountStore.blob(capture.html.sha256);
      if (!bytes) {
        throw new Error('The captured product HTML is missing');
      }
      const html = sanitizePublicHtml(bytes.toString('utf8'));
      const sourceUrl = canonicalUrl(sanitizePublicData(capture.snapshot.url));
      const { document } = parseHTML(html);
      const snapshot = extractPage({ document, url: sourceUrl });
      const checked = parseProduct(snapshot);
      if (
        checked.offer.sku !== original.offer.sku ||
        checked.offer.price !== original.offer.price ||
        !checked.offer.variantConfirmed
      ) {
        throw new Error(
          'Redacted HTML did not preserve the exact selected SKU and price'
        );
      }
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
        priceContext: 'authenticated-browser-observation',
        exactSkuConfirmed: true,
        manualVisualReview: false,
      };
      await application.store.put('offer', {
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
  return {
    published,
    rejected,
    reused,
    downloads: application.cache.stats.downloads,
  };
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
