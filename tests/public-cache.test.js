import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch, TesseractOcr } from '../src/index.js';
import { formatComparison } from '../src/telegram.js';

test('committed public captures replay prices, OCR and Nha Trang delivery without a browser or download', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-public-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(
    new URL('./fixtures/public-cache/store', import.meta.url),
    directory,
    { recursive: true }
  );
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  let browserStarts = 0;
  app.collector.start = () => {
    browserStarts++;
    throw new Error('Offline replay must not start a browser');
  };
  const manifest = JSON.parse(
    await readFile(
      new URL('./fixtures/public-cache/manifest.json', import.meta.url),
      'utf8'
    )
  );
  const now =
    Math.max(
      ...manifest.products.map((product) => Date.parse(product.observedAt))
    ) + 1000;
  const report = await app.compare({ now });
  assert.equal(report.comparisons.length, 4);
  const whey = report.comparisons.find((row) =>
    row.offer.url.includes('i3261102356')
  );
  assert.equal(whey.metrics.totalBeforeDelivery, 3100000);
  assert.equal(whey.metrics.totalAfterDelivery, 3180200);
  assert.equal(whey.metrics.costPerGramBeforeDelivery, 3100000 / 2268);
  assert.equal(whey.metrics.costPerGramAfterDelivery, 3180200 / 2268);
  assert.equal(whey.metrics.costPerMlBeforeDelivery, null);
  const ice = report.comparisons.find((row) =>
    row.offer.url.includes('i338968082')
  );
  assert.equal(ice.metrics.totalVolumeMl, 860);
  assert.equal(ice.metrics.costPerMlBeforeDelivery, 130000 / 860);
  assert.equal(ice.metrics.costPerMlAfterDelivery, null);
  assert.equal(ice.metrics.costPerGramBeforeDelivery, null);
  const quote = await app.delivery(whey.offer.url);
  assert.equal(quote.cacheHit, true);
  assert.equal(quote.shipping, 80200);
  assert.equal(quote.shippingQuantity, 1);
  assert.equal(quote.shippingDestination, 'Khánh Hòa, Phường Nha Trang');
  assert.equal(quote.applied, true);
  const bulk = await new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  }).compare({ quantity: 10, now });
  assert.equal(
    bulk.comparisons.find((row) => row.offer.id === whey.offer.id).metrics
      .totalBeforeDelivery,
    31000000
  );
  assert.equal(
    bulk.comparisons.find((row) => row.offer.id === whey.offer.id).metrics
      .totalAfterDelivery,
    null
  );
  assert.match(formatComparison(bulk), /before \/ after delivery/u);
  assert.match(formatComparison(bulk), /Unknown/u);
  for (const product of manifest.products) {
    const graph = await store.graph('product', product.id);
    assert.ok(graph.names.has(`record:product:${product.id}`));
    assert.ok(graph.links.length > 10);
  }
  for (const blob of manifest.blobs) {
    assert.equal((await store.blob(blob.sha256)).length, blob.bytes);
    const saved = (await store.list('ocr')).find(
      (record) => record.imageHash === blob.sha256
    );
    assert.ok(saved.words.some((word) => word.box.length === 4));
    let engineCalls = 0;
    const ocr = new TesseractOcr({
      store,
      languages: saved.languages,
      psm: saved.psm,
      tessdataDir: '.lazada-search/tessdata',
      execute: async (_command, args) => {
        assert.deepEqual(args, ['--version']);
        engineCalls++;
        return { stdout: `${saved.engine}\n` };
      },
    });
    const replay = await ocr.recognize(blob);
    assert.equal(replay.cacheHit, true);
    assert.equal(replay.text, saved.text);
    assert.equal(engineCalls, 1);
  }
  assert.equal(browserStarts, 0);
  assert.equal(app.cache.stats.downloads, 0);
  assert.equal(app.cache.stats.misses, 0);
  await app.close();
});
