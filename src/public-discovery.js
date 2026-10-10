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

const samePage = (first, second) =>
  JSON.stringify(cards(first)) === JSON.stringify(cards(second)) &&
  JSON.stringify(first.searchCoverage) ===
    JSON.stringify(second.searchCoverage);

async function publicSnapshot(accountStore, capture) {
  const originalHtml = (
    await accountStore.blob(capture.html.sha256)
  ).toString();
  const html = sanitizePublicHtml(originalHtml);
  const snapshot = extractPage({
    document: parseHTML(html).document,
    url: capture.snapshot.url,
  });
  if (samePage(snapshot, capture.snapshot)) {
    return { html, snapshot, extractionReprocessed: false };
  }
  // Compare serialized source bytes when live innerText differs from textContent.
  const original = extractPage({
    document: parseHTML(originalHtml).document,
    url: capture.snapshot.url,
  });
  if (!samePage(snapshot, original)) {
    throw new Error('Redaction changed search cards or pagination evidence');
  }
  return { html, snapshot, extractionReprocessed: true };
}

async function publishedCaches(store) {
  const valid = new Set();
  for (const record of await store.list('discovery-publication')) {
    const cached = await store.get('cache', record.cacheId);
    if (
      cached?.status === 'ok' &&
      cached.repositoryReusable &&
      cached.extractorVersion === EXTRACTOR_VERSION &&
      cached.html?.sha256 === record.html.sha256
    ) {
      valid.add(record.cacheId);
    }
  }
  return valid;
}

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
  const validCaches = await publishedCaches(application.store);
  for (const capture of (await accountStore.list('cache')).filter(
    (record) =>
      record.visibility === 'private' &&
      record.id.startsWith(`search:${application.market}:`) &&
      record.status === 'ok' &&
      record.html
  )) {
    try {
      const { html, snapshot, extractionReprocessed } = await publicSnapshot(
        accountStore,
        capture
      );
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
        ...(extractionReprocessed ? { extractionReprocessed: true } : {}),
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
