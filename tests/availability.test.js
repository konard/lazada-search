import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  LazadaSearch,
  ListingUnavailableError,
  recordListingUnavailable,
  applyListingAvailability,
  auditCoverage,
  publishAccountCaptures,
  exportRepositoryArchive,
  RepositoryArchive,
} from '../src/index.js';

const url = 'https://www.lazada.vn/products/pdp-i100.html';
const removed =
  '<html><head><title>Xin lỗi! Sản phẩm này không còn tồn tại</title></head><body>Xin lỗi! Sản phẩm này không còn tồn tại</body></html>';
const oldOffer = {
  id: '100-11',
  url: `${url}?skuId=11`,
  productId: '100',
  price: 250000,
  sku: '100_VNAMZ-11',
  available: true,
  variantConfirmed: true,
  observedAt: '2026-10-09T00:00:00Z',
};

async function setup(t, html = removed) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-availability-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'public') });
  const capture = {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    finalUrl: url,
    status: 'unavailable',
    fetchedAt: Date.parse('2026-10-10T00:00:00Z'),
    html: await store.putBlob(html),
  };
  return { directory, store, capture };
}

test('original unavailable evidence suppresses old ranks without changing the historical price', async (t) => {
  const { store, capture } = await setup(t);
  const evidence = await recordListingUnavailable(store, capture, url);
  assert.equal(evidence.verification, 'original-html-confirmed');
  assert.equal((await store.list('evidence'))[0].role, 'availability');
  const [derived] = applyListingAvailability([oldOffer], [evidence]);
  assert.equal(derived.available, false);
  assert.equal(derived.price, oldOffer.price);
  assert.equal(derived.availabilityEvidenceId, evidence.id);
  assert.equal(oldOffer.available, true);
  assert.equal(
    applyListingAvailability(
      [oldOffer],
      [evidence],
      [{ url, invalidatedAt: '2026-10-11T00:00:00Z' }]
    )[0].available,
    true
  );
  const freshOffer = { ...oldOffer, observedAt: '2026-10-11T00:00:00Z' };
  assert.equal(
    applyListingAvailability([freshOffer], [evidence])[0].available,
    true
  );
});

test('structured catalog import preserves removed-listing outcomes and explicit invalidation without starting a browser', async (t) => {
  const { directory, store, capture } = await setup(t);
  const evidence = await recordListingUnavailable(store, capture, url);
  const importedStore = new AssociativeStore({
    directory: join(directory, 'imported'),
  });
  const app = new LazadaSearch({
    store: importedStore,
    offline: true,
    ocr: false,
  });
  app.collector.start = () => {
    throw new Error('Offline import must not start a browser');
  };
  await app.importRecords({
    availability: [evidence],
    discoveries: [
      {
        id: 'removed-card',
        url,
        listingUrl: url,
        title: 'Chocolate whey protein',
      },
    ],
  });
  assert.deepEqual((await app.audit()).missingListings, []);
  assert.equal(
    (await importedStore.get('listing-availability', evidence.id)).html.sha256,
    capture.html.sha256
  );
  await app.importRecords({
    invalidations: [
      {
        id: url,
        url,
        invalidatedAt: new Date(Date.UTC(2026, 9, 12)).toISOString(),
      },
    ],
  });
  assert.deepEqual((await app.audit()).missingListings, [url]);
  assert.equal(app.cache.stats.downloads, 0);
  await app.close();
});

test('an unavailable flag cannot establish deletion from a loader, login, CAPTCHA or unrelated redirect', async (t) => {
  const { store, capture } = await setup(t);
  for (const html of [
    '<html><head><title>Lazada</title></head><body>Loading...</body></html>',
    '<html><head><title>Đăng nhập</title></head><body></body></html>',
    '<html><head><title>Security verification</title></head><body>Product no longer exists</body></html>',
  ]) {
    const candidate = { ...capture, html: await store.putBlob(html) };
    assert.equal(
      await recordListingUnavailable(store, candidate, url),
      undefined
    );
  }
  for (const finalUrl of [
    'https://www.lazada.vn/products/pdp-i101.html',
    'https://www.lazada.co.th/products/pdp-i100.html',
    'https://www.lazada.vn/member/login',
  ]) {
    assert.equal(
      await recordListingUnavailable(store, { ...capture, finalUrl }, url),
      undefined
    );
  }
  assert.deepEqual(await store.list('listing-availability'), []);
});

test('verified removed listings are separate audit outcomes and fresh positive evidence restores collection gaps', async (t) => {
  const { store, capture } = await setup(t);
  const evidence = await recordListingUnavailable(store, capture, url);
  const input = {
    crawl: { uncollectedUrls: [url], scopes: [] },
    offers: [oldOffer],
    discoveries: [
      { url, classification: 'needs-category-review', category: 'whey' },
    ],
    skuInventories: [
      { url, inventoryObserved: false, skus: [{ sku: '100_VNAMZ-12', url }] },
    ],
    availability: [evidence],
  };
  const audit = auditCoverage(input);
  for (const field of [
    'missingListings',
    'missingSkuPrices',
    'missingPrices',
    'unknownSkuInventories',
    'categoryReview',
  ]) {
    assert.deepEqual(audit[field], []);
  }
  assert.equal(audit.unavailableListings.length, 1);
  assert.equal(audit.complete, false);
  const restored = auditCoverage({
    ...input,
    offers: [{ ...oldOffer, observedAt: '2026-10-11T00:00:00Z' }],
  });
  assert.equal(restored.unavailableListings.length, 0);
  assert.equal(restored.missingSkuPrices.length, 1);
  assert.equal(restored.categoryReview.length, 1);
});

test('collect returns a typed item outcome and continues to the next item', async (t) => {
  const { store, capture } = await setup(t);
  const nextUrl = 'https://www.lazada.vn/products/pdp-i101.html';
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    collector: {
      page: async (requested) =>
        requested === url
          ? capture
          : {
              ...capture,
              url: nextUrl,
              finalUrl: nextUrl,
              status: 'ok',
              snapshot: {
                url: nextUrl,
                title: 'Whey isolate chocolate 500g',
                priceText: '200.000 ₫',
                rawText: 'Whey isolate chocolate 500g',
                sku: '101_VNAMZ-21',
                variantConfirmed: true,
                selectedVariantConfirmed: true,
                skuCatalogObserved: true,
                skuCatalog: [],
                productImages: [],
              },
            },
      close: async () => {},
    },
  });
  await assert.rejects(app.collect(url), (error) => {
    assert.ok(error instanceof ListingUnavailableError);
    assert.equal(error.code, 'PAGE_UNAVAILABLE');
    assert.ok(error.evidence.id);
    assert.doesNotMatch(error.message, /Collection stopped/u);
    return true;
  });
  assert.equal((await app.collect(nextUrl)).offer.price, 200000);
  assert.equal((await store.list('offer')).length, 1);
  await app.close();
});

test('private removed pages publish safe originals and replay from an archive in a new account with zero requests', async (t) => {
  const { directory, store: shared } = await setup(t);
  const source = new AssociativeStore({
    directory: join(directory, 'account'),
    visibility: 'private',
    fallback: shared,
  });
  const html = `${removed}<div id="myAccountTrigger">Fictional Customer</div><input type="tel" value="0901234567"><script>window.sessionToken='fictional-secret';</script>`;
  const capture = await source.put('cache', {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    finalUrl: url,
    status: 'unavailable',
    html: await source.putBlob(html),
    screenshot: await source.putBlob('private account screenshot'),
    fetchedAt: Date.parse('2026-10-10T00:00:00Z'),
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  const published = await publishAccountCaptures(app, source);
  assert.equal(published.unavailablePublished.length, 1);
  assert.equal(published.published.length, 0);
  assert.equal(published.rejected.length, 0);
  assert.equal(published.downloads, 0);
  const publicHtml = (
    await shared.blob(published.unavailablePublished[0].html.sha256)
  ).toString();
  assert.doesNotMatch(
    publicHtml,
    /Fictional Customer|0901234567|fictional-secret/u
  );
  assert.equal(await shared.blob(capture.screenshot.sha256), undefined);
  const archiveDir = join(directory, 'archive');
  await exportRepositoryArchive({ store: shared, directory: archiveDir });
  const archive = new RepositoryArchive({ directory: archiveDir });
  assert.equal((await archive.verify()).valid, true);
  const replay = new LazadaSearch({
    store: new AssociativeStore({
      directory: join(directory, 'fresh-account'),
      visibility: 'private',
      fallback: new AssociativeStore({
        directory: join(directory, 'fresh-public'),
        archive,
      }),
    }),
    offline: true,
    ocr: false,
  });
  replay.collector.start = () => {
    throw new Error('Negative archive replay must not start a browser');
  };
  await assert.rejects(replay.collect(url), { code: 'PAGE_UNAVAILABLE' });
  assert.equal(replay.cache.stats.downloads, 0);
  assert.equal((await replay.audit()).unavailableListings.length, 1);
  await app.close();
  await replay.close();
});
