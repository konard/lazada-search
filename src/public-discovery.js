import { parseHTML } from 'linkedom';
import { extractPage, EXTRACTOR_VERSION } from './browser.js';
import { sanitizePublicHtml, sanitizePublicData } from './archive.js';
import {
  discoveryDigest,
  discoveryObservedAt,
  discoveryPublicationFingerprint,
  discoveryPublicationId,
  discoveryPublicationStore,
  discoverySourceContext,
  reusableDiscoveryPublication,
  saveDiscoveryProof,
  saveDiscoveryMetadata,
  verifyDiscoveryBlob,
} from './discovery-publication-cache.js';

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

function publicSnapshot(originalBytes, sourceUrl, capturedSnapshot) {
  const originalHtml = originalBytes.toString();
  const html = sanitizePublicHtml(originalHtml);
  const snapshot = extractPage({
    document: parseHTML(html).document,
    url: sourceUrl,
  });
  if (samePage(snapshot, capturedSnapshot)) {
    return { html, snapshot, extractionReprocessed: false };
  }
  // Compare serialized source bytes when live innerText differs from textContent.
  const original = extractPage({
    document: parseHTML(originalHtml).document,
    url: sourceUrl,
  });
  if (!samePage(snapshot, original)) {
    throw new Error('Redaction changed search cards or pagination evidence');
  }
  return { html, snapshot, extractionReprocessed: true };
}

function matchesPublishedCache(cached, record) {
  return (
    cached?.status === 'ok' &&
    cached.visibility !== 'private' &&
    record.visibility !== 'private' &&
    !cached.invalidatedAt &&
    cached.repositoryReusable &&
    cached.extractorVersion === EXTRACTOR_VERSION &&
    cached.html?.sha256 === record.html.sha256 &&
    (!record.snapshotSha256 ||
      record.snapshotSha256 === discoveryDigest(cached.snapshot))
  );
}

async function publishedCaches(store) {
  const valid = new Set();
  for (const record of await store.list('discovery-publication')) {
    if (!record.cacheId || !record.html?.sha256) {
      continue;
    }
    const cached = await store.get('cache', record.cacheId);
    if (
      matchesPublishedCache(cached, record) &&
      (await verifyDiscoveryBlob(store, cached.html))
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
  let reused = 0;
  const pipeline = await discoveryPublicationFingerprint();
  const store = discoveryPublicationStore(application.store);
  const sourceTimes = new Map();
  const validCaches = await publishedCaches(application.store);
  for (const capture of (await accountStore.list('cache')).filter(
    (record) =>
      record.visibility === 'private' &&
      record.id.startsWith(`search:${application.market}:`) &&
      record.status === 'ok' &&
      record.html
  )) {
    try {
      const bytes = await accountStore.blob(capture.html.sha256);
      const context = discoverySourceContext(
        application,
        capture,
        bytes,
        pipeline
      );
      sourceTimes.set(context.cacheId, context.observedAt);
      const saved = await reusableDiscoveryPublication(application, context);
      if (saved) {
        published.push(saved);
        validCaches.add(context.cacheId);
        reused += 1;
        continue;
      }
      const { html, snapshot, extractionReprocessed } = await publicSnapshot(
        bytes,
        context.finalUrl,
        capture.snapshot
      );
      const blob = await application.store.putBlob(Buffer.from(html));
      const publicationId = await discoveryPublicationId(store, context, blob);
      await store.putLatest('cache', {
        id: context.cacheId,
        url: context.url,
        finalUrl: snapshot.url,
        snapshot,
        status: 'ok',
        html: blob,
        fetchedAt: capture.fetchedAt,
        checkedAt: capture.checkedAt,
        observedAt: context.observedAt,
        extractorVersion: EXTRACTOR_VERSION,
        extractedHtmlSha256: blob.sha256,
        repositoryReusable: true,
        discoveryPublicationId: publicationId,
        scrolling: sanitizePublicData(capture.scrolling),
      });
      validCaches.add(context.cacheId);
      const record = {
        id: publicationId,
        url: context.url,
        html: blob,
        cacheId: context.cacheId,
        observedAt: context.observedAt,
        snapshotSha256: discoveryDigest(snapshot),
        cards: snapshot.cards.length,
        scrolling: sanitizePublicData(capture.scrolling),
        ...(extractionReprocessed ? { extractionReprocessed: true } : {}),
        ...snapshot.searchCoverage,
      };
      const savedRecord = await store.putLatest(
        'discovery-publication',
        record
      );
      await saveDiscoveryProof(store, context, savedRecord, snapshot);
      published.push(savedRecord);
    } catch (error) {
      validCaches.delete(sanitizePublicData(capture.id));
      rejected.push({
        url: sanitizePublicData(capture.url),
        reason: error.message,
      });
    }
  }
  for (const kind of ['discovery', 'crawl-page', 'crawl']) {
    for (const input of (await accountStore.list(kind)).filter(
      (record) => record.visibility === 'private'
    )) {
      const record = sanitizePublicData(input);
      delete record.visibility;
      if (
        kind === 'crawl'
          ? !record.pages.every(
              (page) =>
                page.status !== 'ok' ||
                validCaches.has(
                  `search:${application.market}:${application.deliveryArea}:${page.url}`
                )
            )
          : !validCaches.has(record.cacheId)
      ) {
        continue;
      }
      const observedAt = discoveryObservedAt(
        record,
        sourceTimes.get(record.cacheId)
      );
      await saveDiscoveryMetadata(store, kind, {
        ...record,
        ...(observedAt ? { observedAt } : {}),
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
