import { parseHTML } from 'linkedom';
import { extractPage, EXTRACTOR_VERSION } from './browser.js';
import { sanitizePublicHtml, sanitizePublicData } from './archive.js';
import { sha256 } from './util.js';

const cards = (snapshot) =>
  (snapshot.cards || []).map(({ url, title, priceText, sku }) => ({
    url,
    title,
    priceText,
    sku,
  }));

export async function publishAccountDiscovery(application, accountStore) {
  if (
    application.store.visibility !== 'public' ||
    !application.cache.offline ||
    accountStore.visibility !== 'private'
  ) {
    throw new Error(
      'Discovery publication requires a private source and offline public application'
    );
  }
  const published = [];
  const rejected = [];
  const validCaches = new Set();
  for (const capture of (await accountStore.list('cache')).filter(
    (record) =>
      record.visibility === 'private' &&
      record.id.startsWith(`search:${application.market}:`) &&
      record.status === 'ok' &&
      record.html
  )) {
    try {
      const html = sanitizePublicHtml(
        (await accountStore.blob(capture.html.sha256)).toString()
      );
      const { document } = parseHTML(html);
      const snapshot = extractPage({ document, url: capture.snapshot.url });
      if (
        JSON.stringify(cards(snapshot)) !==
          JSON.stringify(cards(capture.snapshot)) ||
        JSON.stringify(snapshot.searchCoverage) !==
          JSON.stringify(capture.snapshot.searchCoverage)
      ) {
        throw new Error(
          'Redaction changed search cards or pagination evidence'
        );
      }
      const blob = await application.store.putBlob(Buffer.from(html));
      await application.store.put('cache', {
        id: capture.id,
        url: capture.url,
        finalUrl: snapshot.url,
        snapshot,
        status: 'ok',
        html: blob,
        fetchedAt: capture.fetchedAt,
        checkedAt: capture.checkedAt,
        extractorVersion: EXTRACTOR_VERSION,
        extractedHtmlSha256: blob.sha256,
        repositoryReusable: true,
        scrolling: capture.scrolling,
      });
      validCaches.add(capture.id);
      const record = {
        id: `discovery-publication:${sha256(`${capture.id}:${blob.sha256}`)}`,
        url: capture.url,
        html: blob,
        cacheId: capture.id,
        observedAt: new Date(capture.fetchedAt).toISOString(),
        cards: snapshot.cards.length,
        scrolling: capture.scrolling,
        ...snapshot.searchCoverage,
      };
      published.push(
        await application.store.put('discovery-publication', record)
      );
    } catch (error) {
      rejected.push({ url: capture.url, reason: error.message });
    }
  }
  for (const kind of ['discovery', 'crawl-page', 'crawl']) {
    for (const input of (await accountStore.list(kind)).filter(
      (record) => record.visibility === 'private'
    )) {
      if (
        kind === 'crawl'
          ? !input.pages.every(
              (page) =>
                page.status !== 'ok' ||
                validCaches.has(
                  `search:${application.market}:${application.deliveryArea}:${page.url}`
                )
            )
          : !validCaches.has(input.cacheId)
      ) {
        continue;
      }
      const record = sanitizePublicData(input);
      delete record.visibility;
      await application.store.put(kind, record);
    }
  }
  return { published, rejected, downloads: application.cache.stats.downloads };
}
