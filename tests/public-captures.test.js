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
  const history = await archive.list('offer-history');
  assert.deepEqual(
    receipts.allPublished.map((record) => record.id).sort(),
    publications.map((record) => record.id).sort()
  );
  assert.deepEqual(
    [...receipts.published, ...receipts.historicalPublished]
      .map((record) => record.id)
      .sort(),
    receipts.allPublished.map((record) => record.id).sort()
  );
  assert.ok(publications.length > 0);
  assert.equal(receipts.downloads, 0);
  for (const receipt of receipts.allPublished) {
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
    assert.ok(Date.parse(offer.observedAt) >= Date.parse(record.observedAt));
    assert.ok(
      history.some(
        (observation) =>
          observation.offerId === record.offerId &&
          observation.observedAt === record.observedAt &&
          observation.sku === record.sku &&
          observation.price === record.price
      ),
      `Historical selected price is preserved for ${record.id}`
    );
    assert.equal(offer.priceContext, 'authenticated-browser-observation');
    assert.notEqual(offer.visibility, 'private');
    const newest = publications
      .filter((item) => item.sourceUrl === record.sourceUrl)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    if (newest.id === record.id) {
      const cache = await archive.get(
        'cache',
        `lazada:vn:Nha Trang:${record.sourceUrl}`
      );
      assert.equal(cache.repositoryReusable, true);
      const source = new URL(record.sourceUrl);
      if (
        !source.searchParams.has('skuId') &&
        !/-s\d+\.html$/u.test(source.pathname) &&
        cache.snapshot.sku !== record.sku
      ) {
        assert.ok(
          publications.some(
            (item) =>
              item.sku === cache.snapshot.sku &&
              item.html.sha256 === cache.html.sha256 &&
              Date.parse(item.observedAt) >= Date.parse(record.observedAt)
          ),
          'An unqualified listing cache can represent a newer verified selected SKU'
        );
        continue;
      }
      assert.equal(cache.snapshot.sku, record.sku);
      assert.deepEqual(snapshot.skuCatalog, cache.snapshot.skuCatalog);
      assert.deepEqual(
        snapshot.selectedVariant,
        cache.snapshot.selectedVariant
      );
    }
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
  assert.deepEqual(report.historicalPublished, []);
  assert.deepEqual(report.allPublished, report.published);
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

test('republishing an overwritten account cache reports current and historical exact prices without downloads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-public-history-'));
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
    throw new Error('Historical publication replay must remain offline');
  };
  const url = 'https://www.lazada.vn/products/fixture-whey-i100-s11.html';
  const reports = [];
  for (const [observedAt, price] of [
    ['2026-10-09T09:00:00Z', '250.000'],
    ['2026-10-10T09:00:00Z', '200.000'],
  ]) {
    const html = `<h1>Fixture whey isolate 500g chocolate</h1><div data-product-price>${price} ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-11</span></div>`;
    const { document } = parseHTML(html);
    await source.put('cache', {
      id: `lazada:vn:Nha Trang:${url}`,
      url,
      status: 'ok',
      html: await source.putBlob(html),
      snapshot: extractPage({ document, url }),
      fetchedAt: Date.parse(observedAt),
    });
    reports.push(await publishAccountCaptures(app, source));
  }
  const [first, second] = reports;
  assert.equal(second.published.length, 1);
  assert.equal(second.published[0].price, 200000);
  assert.deepEqual(second.historicalPublished, first.published);
  assert.equal(second.historicalPublished[0].price, 250000);
  assert.equal(second.allPublished.length, 2);
  assert.deepEqual(
    second.allPublished.map((record) => record.id).sort(),
    [...second.published, ...second.historicalPublished]
      .map((record) => record.id)
      .sort()
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(second)).allPublished,
    second.allPublished
  );
  assert.equal(
    (await source.list('cache')).filter(
      (record) => record.visibility === 'private'
    ).length,
    1
  );
  assert.equal(second.downloads, 0);
  assert.deepEqual(second.rejected, []);
  const archivedAt = join(directory, 'archive');
  await exportRepositoryArchive({ store: shared, directory: archivedAt });
  const archive = new RepositoryArchive({ directory: archivedAt });
  const publications = await archive.list('publication');
  assert.deepEqual(publications, second.allPublished);
  const history = await archive.list('offer-history');
  for (const record of publications) {
    const html = (await archive.blob(record.html.sha256)).toString();
    const { document } = parseHTML(html);
    const extracted = parseProduct(
      extractPage({ document, url: record.sourceUrl })
    );
    assert.equal(extracted.offer.sku, record.sku);
    assert.equal(extracted.offer.price, record.price);
    assert.equal(extracted.offer.variantConfirmed, true);
    assert.ok(
      history.some(
        (item) =>
          item.offerId === record.offerId &&
          item.observedAt === record.observedAt &&
          item.price === record.price
      )
    );
  }
  const latest = second.published[0];
  assert.equal((await archive.get('offer', latest.offerId)).price, 200000);
  assert.equal(
    parseProduct(
      (await archive.get('cache', `lazada:vn:Nha Trang:${url}`)).snapshot
    ).offer.price,
    200000
  );
  assert.equal((await archive.verify()).valid, true);
  const replay = await publishAccountCaptures(app, source);
  assert.equal(replay.reused, 1);
  assert.deepEqual(replay.allPublished, second.allPublished);
  assert.deepEqual(replay.historicalPublished, first.published);
  assert.equal(app.cache.stats.downloads, 0);
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
