import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  BrowserCollector,
  DomainScheduler,
  EvidenceCache,
  RepositoryArchive,
  exportRepositoryArchive,
  extractPage,
} from '../src/index.js';
import { parseHTML } from 'linkedom';
import { executeCommand } from '../src/commands.js';
import { sanitizePublicHtml, sanitizePublicData } from '../src/archive.js';

test('public product capture excludes private floating cart contents', () => {
  const html = sanitizePublicHtml(
    '<h1>Chocolate ice cream130ml</h1><span data-product-price>27.000 ₫</span><div class="cart-drawer"><div id="floating-cart">Private cart seller and checkout totals</div></div>'
  );
  assert.match(html, /Chocolate ice cream130ml/u);
  assert.match(html, /27.000/u);
  assert.doesNotMatch(html, /Private cart|checkout totals|floating-cart/u);
});

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-repository-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'working') });
  const target = join(directory, 'committed');
  return { directory, store, target };
}

test('archive replays all sources and conversions, detects corruption and rebuilds only changes', async (t) => {
  const { store, target, directory } = await setup(t);
  const url = 'https://www.lazada.vn/products/pdp-i12.html';
  const html = await store.putBlob(
    '<h1 data-product-title>Whey 500g</h1><span data-product-price>658.000 ₫</span><script>window.accessToken="secret"</script>'
  );
  const image = await store.putBlob(Buffer.from([1, 2, 3, 4]));
  await store.put('cache', {
    id: `page:${url}`,
    url,
    html,
    screenshot: image,
    fetchedAt: 1000,
    checkedAt: 1000,
    snapshot: { url, title: 'Whey 500g', rawText: 'Whey 500g' },
    status: 'ok',
    extractorVersion: 7,
  });
  await store.put('product', { id: 'p1', title: 'Whey', price: 20 });
  await store.put('ocr', {
    id: 'label',
    imageHash: image.sha256,
    text: 'Protein 25g',
    words: [{ box: [1, 2, 3, 4], text: 'Protein' }],
  });
  const first = await exportRepositoryArchive({ store, directory: target });
  assert.equal(first.records, 3);
  assert.equal(first.blobs, 2);
  const archive = new RepositoryArchive({ directory: target });
  assert.deepEqual(await archive.verify(), {
    valid: true,
    records: 3,
    blobs: 2,
    downloads: 0,
  });
  const second = await exportRepositoryArchive({ store, directory: target });
  assert.equal(second.rebuilt, 0);
  const manifest = await archive.manifest();
  const saved = await archive.get('cache', `page:${url}`);
  assert.notEqual(saved.html.sha256, html.sha256);
  assert.equal(manifest.sourceRewrites[0].originalSha256, html.sha256);
  assert.doesNotMatch(
    (await archive.blob(saved.html.sha256)).toString(),
    /secret|accessToken/u
  );
  const working = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  assert.equal((await working.get('product', 'p1')).price, 20);
  assert.ok(
    (await working.graph('product', 'p1')).names.has('record:product:p1')
  );
  assert.deepEqual(await working.blob(image.sha256), Buffer.from([1, 2, 3, 4]));
  await working.put('product', {
    id: 'p1',
    title: 'Corrected whey',
    price: 10,
  });
  assert.equal((await working.list('product')).length, 1);
  assert.equal((await working.list('product'))[0].price, 10);
  assert.equal((await archive.get('product', 'p1')).price, 20);
  const overlayTarget = join(directory, 'updated-archive');
  await exportRepositoryArchive({ store: working, directory: overlayTarget });
  const overlay = new RepositoryArchive({ directory: overlayTarget });
  assert.equal((await overlay.get('product', 'p1')).price, 10);
  assert.equal((await overlay.verify()).records, 3);
  assert.ok(await overlay.blob(image.sha256));
  await store.put('product', { id: 'p1', title: 'Corrected whey', price: 10 });
  const changed = await exportRepositoryArchive({ store, directory: target });
  assert.equal(changed.rebuilt, 3);
  const after = new RepositoryArchive({ directory: target });
  assert.equal((await after.get('product', 'p1')).price, 10);
  assert.equal(
    (await after.manifest()).kinds.ocr.sourceSha256,
    manifest.kinds.ocr.sourceSha256
  );
  await writeFile(join(target, manifest.kinds.ocr.lino.path), 'broken');
  await assert.rejects(
    new RepositoryArchive({ directory: target }).verify(),
    /Corrupt repository/u
  );
  assert.equal(
    (await exportRepositoryArchive({ store, directory: target })).rebuilt,
    1
  );
  assert.equal(
    (await new RepositoryArchive({ directory: target }).verify()).valid,
    true
  );
});

test('failed export leaves the earlier manifest and all referenced sources intact', async (t) => {
  const { store, target } = await setup(t);
  await store.put('product', { id: 'p', title: 'Whey', price: 100 });
  await exportRepositoryArchive({ store, directory: target });
  const before = await readFile(join(target, 'manifest.json'));
  await store.put('product', { id: 'p', title: 'Whey', price: 200 });
  await store.put('zzz-record', {
    id: 'missing',
    source: { sha256: 'a'.repeat(64), bytes: 100 },
  });
  await assert.rejects(
    exportRepositoryArchive({ store, directory: target }),
    /Missing source evidence/u
  );
  assert.deepEqual(await readFile(join(target, 'manifest.json')), before);
  const archive = new RepositoryArchive({ directory: target });
  assert.equal((await archive.get('product', 'p')).price, 100);
  assert.equal((await archive.verify()).valid, true);
});

test('source hash metadata preserves record identity and still copies nested blobs', async (t) => {
  const { store, target, directory } = await setup(t);
  const imageBytes = Buffer.from('original chocolate label image');
  const image = await store.putBlob(imageBytes);
  const records = [
    {
      id: 'manufacturer-source',
      sha256: image.sha256,
      bytes: image.bytes,
      url: 'https://manufacturer.example/chocolate',
      image,
      description: 'Hash and size describe the source alongside other metadata',
    },
    {
      id: 'source-metadata-only',
      sha256: 'a'.repeat(64),
      bytes: 123,
      description: 'A recorded hash does not require a cached blob',
    },
  ];
  for (const record of records) {
    await store.put('research-attempt', record);
  }
  const exported = await exportRepositoryArchive({ store, directory: target });
  assert.equal(exported.records, 2);
  assert.equal(exported.blobs, 1);
  const archive = new RepositoryArchive({ directory: target });
  assert.deepEqual(await archive.verify(), {
    valid: true,
    records: 2,
    blobs: 1,
    downloads: 0,
  });
  for (const record of records) {
    assert.deepEqual(await archive.get('research-attempt', record.id), record);
    const graph = await archive.graph('research-attempt', record.id);
    assert(graph.names.has(`record:research-attempt:${record.id}`));
    assert(graph.names.has(`string:${record.sha256}`));
  }
  assert.deepEqual(await archive.blob(image.sha256), imageBytes);
  const fresh = new AssociativeStore({
    directory: join(directory, 'offline-replay'),
    archive,
  });
  assert.deepEqual(await fresh.list('research-attempt'), records);
  assert.equal(
    (await exportRepositoryArchive({ store, directory: target })).rebuilt,
    0
  );
});

test('a corrected local URL alias overrides its older committed capture regardless of sort order', async (t) => {
  const { store, target, directory } = await setup(t);
  const url =
    'https://www.lazada.vn/products/pdp-i12.html?ab_cookie=private&skuId=123';
  const id = `page:${url}`;
  await store.put('cache', {
    id,
    url,
    checkedAt: 100,
    fetchedAt: 100,
    snapshot: { priceText: '100000' },
  });
  await exportRepositoryArchive({ store, directory: target });
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive: target,
  });
  await fresh.put('cache', {
    id,
    url,
    checkedAt: 200,
    fetchedAt: 200,
    snapshot: { priceText: '200000' },
  });
  const revisedTarget = join(directory, 'revised');
  await exportRepositoryArchive({ store: fresh, directory: revisedTarget });
  const archive = new RepositoryArchive({ directory: revisedTarget });
  const records = await archive.list('cache');
  assert.equal(records.length, 1);
  assert.equal(records[0].snapshot.priceText, '200000');
  assert.equal(records[0].checkedAt, 200);
  assert.equal((await archive.verify()).valid, true);
});

test('archived expired sources cause no navigation; explicit refresh and invalidation reload them', async (t) => {
  const { store, target, directory } = await setup(t);
  const url = 'https://www.lazada.vn/products/pdp-i12.html';
  await store.put('cache', {
    id: `page:${url}`,
    url,
    checkedAt: 100,
    fetchedAt: 100,
    snapshot: { title: 'old' },
  });
  await exportRepositoryArchive({ store, directory: target });
  const working = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive: target,
  });
  const cache = new EvidenceCache({
    store: working,
    now: () => 10000,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  let requests = 0;
  const load = async () => {
    requests++;
    return { snapshot: { title: `reload ${requests}` } };
  };
  const cached = await cache.get(url, { ttlMs: 1, load });
  assert.equal(cached.stale, true);
  assert.equal(cached.fetchedAt, 100);
  assert.equal(requests, 0);
  cache.offline = true;
  await assert.rejects(
    cache.get(url, { refresh: true, load }),
    /Cannot refresh a source offline/u
  );
  cache.offline = false;
  await cache.get(url, { refresh: true, load });
  assert.equal(requests, 1);
  await cache.invalidate(url, { reason: 'Manufacturer corrected the label' });
  cache.offline = true;
  await assert.rejects(
    cache.get(url, { load }),
    /Invalidated source needs an online reload/u
  );
  cache.offline = false;
  const reload = await cache.get(url, { load });
  assert.equal(requests, 2);
  assert.equal(reload.snapshot.title, 'reload 2');
  assert.equal(reload.invalidatedAt, undefined);
  await assert.rejects(cache.invalidate(url, {}), /requires a reason/u);
});

test('changed HTML hash reparses cached data even with the same extractor version', async (t) => {
  const { store } = await setup(t);
  const url = 'https://www.lazada.vn/products/pdp-i12.html';
  const html = await store.putBlob(
    '<h1 data-product-title>Corrected whey</h1><span data-product-price>200.000 ₫</span>'
  );
  await store.put('cache', {
    id: `page:${url}`,
    url,
    html,
    fetchedAt: 1000,
    checkedAt: 1000,
    extractorVersion: 8,
    extractedHtmlSha256: 'old-source-hash',
    status: 'ok',
    snapshot: { url, title: 'Wrong title', rawText: 'Original visible text' },
  });
  const cache = new EvidenceCache({ store, offline: true });
  const collector = new BrowserCollector({ store, cache });
  collector.start = () => {
    throw new Error('Must not open a browser');
  };
  const page = await collector.page(url);
  assert.equal(page.snapshot.title, 'Corrected whey');
  assert.equal(page.snapshot.priceText, '200.000 ₫');
  assert.equal(page.fetchedAt, 1000);
  assert.equal(page.extractedHtmlSha256, html.sha256);
  assert.equal(page.cacheHit, true);
  assert.equal(cache.stats.downloads, 0);
});

test('public HTML retains complete SKU JSON and removes session scripts and account fields', () => {
  const result = sanitizePublicHtml(
    '<h1>Protein</h1><div id="J_Header">Customer name</div><script type="application/ld+json">{"name":"Whey","accessToken":"private"}</script><script>var __hasSSR__ = false;\nvar __moduleData__ = {"data":{"root":{"fields":{"userInfo":{"email":"private"},"productOption":{"skuBase":{"skus":[{"skuId":123}]}},"skuInfos":{"123":{"operation":{"disable":false}}}}}}};\nvar __googleBot__ = ""; window.__pdpPageVersion = "v2";</script><a href="https://example.com/product?skuId=123&amp;token=secret">Product</a>'
  );
  assert.doesNotMatch(
    result,
    /Customer name|private|secret|userInfo|accessToken/u
  );
  assert.match(result, /skuId/u);
  assert.match(result, /123/u);
});

test('archive sanitization strips security/cookie parameters including nested URLs and imported source credentials', async (t) => {
  const url =
    'https://www.lazada.vn/products/pdp-i12.html?skuId=123&x5secdata=secret&ab_cookie=secret&ct_cookie_present=1&cookies=secret';
  assert.equal(
    sanitizePublicData(url),
    'https://www.lazada.vn/products/pdp-i12.html?skuId=123'
  );
  assert.doesNotMatch(
    sanitizePublicData(
      `https://example.com/link?url=${encodeURIComponent(url)}`
    ),
    /secret|x5secdata|ab_cookie/u
  );
  const { store, target } = await setup(t);
  const source = await store.putBlob(
    Buffer.from(
      JSON.stringify({
        products: [{ id: 'p1', title: 'Whey' }],
        password: 'secret',
        email: 'private@example.com',
      })
    )
  );
  await store.put('import-source', { id: 'import', format: 'json', source });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const saved = await archive.get('import-source', 'import');
  assert.notEqual(saved.source.sha256, source.sha256);
  const text = (await archive.blob(saved.source.sha256)).toString();
  assert.doesNotMatch(text, /secret|private@example.com/u);
  assert.equal(JSON.parse(text).products[0].title, 'Whey');
  assert.equal((await archive.verify()).valid, true);
});

test('JSON and YAML import retain source bytes and replace corrected records and conversions', async (t) => {
  const { directory, store, target } = await setup(t);
  const application = {
    store,
    importRecords: async (records) => {
      for (const record of records.products) {
        await store.put('product', record);
      }
      return { products: records.products.length, offers: 0 };
    },
  };
  const file = join(directory, 'products.yml');
  const yaml =
    'products:\n  - id: powder\n    title: Whey\n    netMassG: 500\n';
  await writeFile(file, yaml);
  await executeCommand(application, 'import', [file]);
  assert.equal((await store.get('product', 'powder')).netMassG, 500);
  const firstGraph = (await store.graph('product', 'powder')).toBinary();
  const json = JSON.stringify({
    products: [{ id: 'powder', title: 'Whey', netMassG: 907 }],
  });
  const jsonFile = join(directory, 'products.json');
  await writeFile(jsonFile, json);
  await executeCommand(application, 'import', [jsonFile]);
  assert.equal((await store.get('product', 'powder')).netMassG, 907);
  assert.equal(
    firstGraph.equals((await store.graph('product', 'powder')).toBinary()),
    false
  );
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const imports = await archive.list('import-source');
  assert.deepEqual(imports.map((record) => record.format).sort(), [
    'json',
    'yaml',
  ]);
  for (const record of imports) {
    const text = (await archive.blob(record.source.sha256)).toString();
    assert.equal(text, record.format === 'yaml' ? yaml : json);
  }
  assert.equal((await archive.verify()).valid, true);
  assert.ok((await readFile(join(target, 'manifest.json'))).length);
});

test('every committed HTML capture preserves its selected price, options and complete SKU inventory on re-extraction', async () => {
  const archive = new RepositoryArchive();
  const captures = (await archive.list('cache')).filter(
    (record) => record.html && record.snapshot && record.status === 'ok'
  );
  assert.ok(captures.length >= 39);
  for (const record of captures) {
    const html = await archive.blob(record.html.sha256);
    const page = extractPage({
      document: parseHTML(html.toString()).document,
      url: record.finalUrl || record.snapshot.url,
    });
    assert.equal(
      (page.priceText || '').replace(/\s/gu, ''),
      (record.snapshot.priceText || '').replace(/\s/gu, ''),
      `Price changed during archival: ${record.url}`
    );
    assert.deepEqual(
      page.selectedVariant || [],
      record.snapshot.selectedVariant || [],
      `Selected option changed: ${record.url}`
    );
    assert.deepEqual(
      page.skuCatalog || [],
      record.snapshot.skuCatalog || [],
      `SKU inventory changed: ${record.url}`
    );
  }
});
