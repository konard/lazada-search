import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { listingKey } from '../src/util.js';
import {
  AssociativeStore,
  LazadaSearch,
  extractPage,
  publishAccountDiscovery,
  RepositoryArchive,
} from '../src/index.js';

test('every published real search page preserves all card identities, prices and pagination in committed HTML', async () => {
  const receipts = JSON.parse(
    await readFile(
      new URL('../docs/acceptance/account-publication.json', import.meta.url)
    )
  ).discovery.published;
  const archive = new RepositoryArchive({
    directory: fileURLToPath(
      new URL('../data/cases/vietnam-nha-trang', import.meta.url)
    ),
  });
  const proof = JSON.parse(
    await readFile(
      new URL('../docs/acceptance/discovery-scope-review.json', import.meta.url)
    )
  );
  const scopePages = [];
  const scopeListings = new Set();
  let scopeCards = 0;
  assert.ok(receipts.length > 0);
  for (const receipt of receipts) {
    const published = await archive.get('discovery-publication', receipt.id);
    const cache = await archive.get('cache', receipt.cacheId);
    assert.equal(cache.repositoryReusable, true);
    assert.equal(published.cards, receipt.cards);
    const html = (await archive.blob(published.html.sha256)).toString();
    assert.doesNotMatch(html, /myAccountTrigger|topActionUserAccont/u);
    const snapshot = extractPage({
      document: parseHTML(html).document,
      url: cache.snapshot.url,
    });
    assert.equal(snapshot.cards.length, receipt.cards);
    assert.deepEqual(snapshot.cards, cache.snapshot.cards);
    assert.deepEqual(snapshot.searchCoverage, cache.snapshot.searchCoverage);
    if (new URL(snapshot.url).searchParams.get('q') === proof.scope) {
      scopePages.push(
        Number(new URL(snapshot.url).searchParams.get('page')) || 1
      );
      scopeCards += snapshot.cards.length;
      for (const card of snapshot.cards) {
        scopeListings.add(listingKey(card.url));
      }
    }
  }
  assert.deepEqual(
    scopePages.sort((a, b) => a - b),
    proof.expectedConsecutivePages
  );
  assert.equal(scopeCards, proof.cardObservations);
  assert.equal(scopeListings.size, proof.distinctListings);
});

test('public discovery retains every preliminary listing and pagination while removing account UI and screenshots', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-discovery-public-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const privateStore = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  app.collector.start = () => {
    throw new Error('Publication must not start a browser');
  };
  const url = 'https://www.lazada.vn/catalog/?q=whey';
  const html =
    '<div id="myAccountTrigger">Private Customer</div><div data-product-card><a title="Whey 500g" href="/products/pdp-i101.html"></a><span data-card-price>300.000 ₫</span></div><div data-product-card><a title="Ice cream molds" href="/products/pdp-i102.html"></a></div><nav class="ant-pagination"><button class="ant-pagination-next" aria-disabled="true">Next</button></nav><script>sessionToken="private-secret"</script>';
  const snapshot = extractPage({ document: parseHTML(html).document, url });
  const cacheId = `search:vn:Nha Trang:${url}`;
  const screenshot = await privateStore.putBlob('private screenshot');
  const finalView = await privateStore.putBlob('private final viewport');
  await privateStore.put('cache', {
    id: cacheId,
    url,
    status: 'ok',
    snapshot,
    html: await privateStore.putBlob(html),
    screenshot,
    screenshots: [{ role: 'after-scroll', blob: finalView }],
    screenshotMode: 'viewport',
    fetchedAt: 1,
    checkedAt: 1,
  });
  await privateStore.put('discovery', {
    id: 'preliminary-whey',
    url: 'https://www.lazada.vn/products/pdp-i101.html',
    cacheId,
    category: 'whey',
  });
  const report = await publishAccountDiscovery(app, privateStore);
  assert.equal(report.published.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.downloads, 0);
  const cached = await shared.get('cache', cacheId);
  assert.equal(cached.snapshot.cards.length, 2);
  assert.equal(cached.snapshot.searchCoverage.terminalConfirmed, true);
  assert.doesNotMatch(
    (await shared.blob(cached.html.sha256)).toString(),
    /Private Customer|private-secret|myAccountTrigger/u
  );
  assert.equal(await shared.blob(screenshot.sha256), undefined);
  assert.equal(await shared.blob(finalView.sha256), undefined);
  assert.equal(cached.screenshots, undefined);
  assert.equal(
    (await shared.get('discovery', 'preliminary-whey')).visibility,
    undefined
  );

  // Publication compares serialized original HTML with redacted HTML.
  await privateStore.put('cache', {
    ...(await privateStore.get('cache', cacheId)),
    snapshot: {
      ...snapshot,
      cards: snapshot.cards.map((card) => ({
        ...card,
        title: 'Earlier live loading placeholder',
      })),
    },
  });
  const replayed = await publishAccountDiscovery(app, privateStore);
  assert.equal(replayed.published.length, 1);
  assert.equal(replayed.rejected.length, 0);
  assert.equal(replayed.published[0].extractionReprocessed, true);
  assert.deepEqual(
    (await shared.get('cache', cacheId)).snapshot.cards,
    JSON.parse(JSON.stringify(snapshot.cards))
  );
  assert.equal(replayed.downloads, 0);
});

test('discovery publication still rejects redaction that changes a product card', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-card-redaction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const source = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  const url = 'https://www.lazada.vn/catalog/?q=redaction';
  const html =
    '<div data-product-card><a href="/products/pdp-i303.html"><span id="myAccountTrigger">Private Customer</span></a><span data-card-price>300.000 ₫</span></div>';
  await source.put('cache', {
    id: `search:vn:Nha Trang:${url}`,
    url,
    status: 'ok',
    snapshot: extractPage({ document: parseHTML(html).document, url }),
    html: await source.putBlob(html),
    fetchedAt: 1,
  });
  const report = await publishAccountDiscovery(app, source);
  assert.equal(report.published.length, 0);
  assert.equal(report.rejected.length, 1);
  assert.match(report.rejected[0].reason, /Redaction changed search cards/u);
  assert.equal((await shared.list('discovery-publication')).length, 0);
  assert.equal(report.downloads, 0);
});
