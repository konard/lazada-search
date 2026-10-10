import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import {
  AssociativeStore,
  LazadaSearch,
  publishAccountCaptures,
  extractPage,
  exportRepositoryArchive,
  RepositoryArchive,
  parseProduct,
} from '../src/index.js';

test('every published real SKU price re-extracts from committed redacted HTML and has a reusable variant cache', async () => {
  const receipts = JSON.parse(
    await readFile(
      new URL('../docs/acceptance/account-publication.json', import.meta.url)
    )
  );
  const archive = new RepositoryArchive({
    directory: fileURLToPath(
      new URL('../data/cases/vietnam-nha-trang', import.meta.url)
    ),
  });
  const publications = await archive.list('publication');
  assert.equal(publications.length, receipts.published.length);
  assert.ok(publications.length > 0);
  assert.equal(receipts.downloads, 0);
  for (const receipt of receipts.published) {
    const record = await archive.get('publication', receipt.id);
    assert.equal(record.sku, receipt.sku);
    assert.equal(record.manualVisualReview, false);
    const html = (await archive.blob(record.html.sha256)).toString();
    assert.doesNotMatch(html, /myAccountTrigger|topActionUserAccont/u);
    const { document } = parseHTML(html);
    const snapshot = extractPage({ document, url: record.sourceUrl });
    const extracted = parseProduct(snapshot);
    assert.equal(extracted.offer.price, record.price);
    assert.equal(extracted.offer.sku, record.sku);
    assert.equal(extracted.offer.variantConfirmed, true);
    const offer = await archive.get('offer', record.offerId);
    assert.equal(offer.observedAt, record.observedAt);
    assert.equal(offer.priceContext, 'authenticated-browser-observation');
    assert.notEqual(offer.visibility, 'private');
    const cache = await archive.get(
      'cache',
      `lazada:vn:Nha Trang:${record.sourceUrl}`
    );
    assert.equal(cache.repositoryReusable, true);
    assert.equal(cache.snapshot.sku, record.sku);
    assert.deepEqual(snapshot.skuCatalog, cache.snapshot.skuCatalog);
    assert.deepEqual(snapshot.selectedVariant, cache.snapshot.selectedVariant);
  }
});

test('account publication preserves selected prices, timestamps and cached labels while removing personal UI and screenshots', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-public-captures-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const source = new AssociativeStore({
    directory: join(directory, 'account'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  app.collector.start = () => {
    throw new Error('Publication must be offline');
  };
  const url = 'https://www.lazada.vn/products/fixture-whey-i100-s11.html';
  const imageUrl = 'https://cdn.example/label.png';
  const html = `<h1>Fixture whey isolate 500g chocolate</h1><div id="topActionHeaderWrapper"><span id="myAccountTrigger">TÀI KHOẢN Fictional Customer</span></div><input type="tel" value="0901234567"><div data-product-price>250.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-11</span></div><img data-product-image src="${imageUrl}"><script>window.sessionToken='fictional-secret';</script>`;
  const { document } = parseHTML(html);
  const snapshot = extractPage({ document, url });
  const finalView = await source.putBlob('private final viewport');
  const captured = await source.put('cache', {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    status: 'ok',
    snapshot,
    html: await source.putBlob(html),
    screenshot: await source.putBlob('private account screenshot'),
    screenshots: [{ role: 'after-scroll', blob: finalView }],
    screenshotMode: 'viewport',
    fetchedAt: Date.parse('2026-10-09T09:00:00Z'),
    checkedAt: 1,
  });
  const label = await source.putBlob('public nutrition label');
  await source.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    blob: label,
    contentType: 'image/png',
    fetchedAt: 1,
    checkedAt: 1,
  });
  const report = await publishAccountCaptures(app, source);
  assert.equal(report.published.length, 1);
  assert.equal(report.rejected.length, 0);
  assert.equal(report.downloads, 0);
  const offer = await shared.get('offer', report.published[0].offerId);
  assert.equal(offer.price, 250000);
  assert.equal(offer.variantConfirmed, true);
  assert.equal(offer.observedAt, '2026-10-09T09:00:00.000Z');
  assert.equal(offer.priceContext, 'authenticated-browser-observation');
  const publishedHtml = (
    await shared.blob(report.published[0].html.sha256)
  ).toString();
  assert.doesNotMatch(
    publishedHtml,
    /Fictional Customer|0901234567|fictional-secret|myAccountTrigger/u
  );
  assert.match(publishedHtml, /100_VNAMZ-11|250\.000/u);
  assert.equal(await shared.blob(captured.screenshot.sha256), undefined);
  assert.equal(await shared.blob(finalView.sha256), undefined);
  const publicCapture = await shared.get('cache', captured.id);
  assert.equal(publicCapture.screenshots, undefined);
  assert.equal(
    (await shared.blob(label.sha256)).toString(),
    'public nutrition label'
  );
  assert.equal((await app.collect(url)).cacheHit, true);
  const replay = await publishAccountCaptures(app, source);
  assert.equal(replay.reused, 1);
  assert.equal((await shared.list('offer')).length, 1);
  const archiveDir = join(directory, 'archive');
  await exportRepositoryArchive({ store: shared, directory: archiveDir });
  assert.equal(
    (await new RepositoryArchive({ directory: archiveDir }).verify()).valid,
    true
  );
  assert.equal(
    (await source.get('cache', captured.id)).html.sha256,
    captured.html.sha256
  );
});

test('publication refuses unconfirmed default SKU prices and public sources', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-public-capture-refusal-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const source = new AssociativeStore({
    directory: join(directory, 'account'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  const url = 'https://www.lazada.vn/products/fixture-i100-s12.html';
  const html = await source.putBlob('<h1>Whey</h1>');
  await source.put('cache', {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    status: 'ok',
    html,
    snapshot: {
      url,
      title: 'Whey',
      sku: '100_VNAMZ-11',
      priceText: '250.000 ₫',
    },
  });
  const report = await publishAccountCaptures(app, source);
  assert.equal(report.published.length, 0);
  assert.match(report.rejected[0].reason, /not confirmed/u);
  assert.equal((await shared.list('offer')).length, 0);
  await assert.rejects(publishAccountCaptures(app, shared), /private source/u);
});
