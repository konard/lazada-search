import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  LazadaSearch,
  RepositoryArchive,
  exportRepositoryArchive,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);

test('real public evidence survives repository export and fresh library, CLI and HTTP replay without downloads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-archive-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = join(directory, 'original');
  await cp(
    new URL('../fixtures/public-cache/store', import.meta.url),
    original,
    { recursive: true }
  );
  const target = join(directory, 'repository');
  const exported = await exportRepositoryArchive({
    store: new AssociativeStore({ directory: original }),
    directory: target,
  });
  const verified = await new RepositoryArchive({ directory: target }).verify();
  assert.equal(verified.records, exported.records);
  assert.equal(verified.downloads, 0);
  const app = new LazadaSearch({
    store: new AssociativeStore({
      directory: join(directory, 'fresh'),
      archive: target,
    }),
    offline: true,
    ocr: false,
  });
  app.collector.start = () => {
    throw new Error('Offline archive must not launch a browser');
  };
  t.after(() => app.close());
  const report = await app.compare({
    sort: 'totalBeforeDelivery',
    allowStale: true,
  });
  assert.equal(report.observedPrices.length, 4);
  assert.equal(report.observedPrices[0].metrics.totalBeforeDelivery, 18000);
  assert.equal(report.ranked.length, 0);
  const quote = await app.delivery(
    'https://www.lazada.vn/products/pdp-i3261102356.html'
  );
  assert.equal(quote.cacheHit, true);
  assert.equal(quote.shipping, 80200);
  const first = (await app.store.list('product'))[0];
  assert.ok((await app.store.graph('product', first.id)).links.length > 10);
  const cli = await execute(process.execPath, [
    'bin/lazada-search.js',
    'compare',
    '--data-dir',
    join(directory, 'fresh-cli'),
    '--archive-dir',
    target,
    '--offline',
    '--no-ocr',
    '--allow-stale',
    '--sort',
    'totalBeforeDelivery',
  ]);
  const cliReport = JSON.parse(cli.stdout);
  assert.deepEqual(
    cliReport.observedPrices.map((row) => row.offer.id),
    report.observedPrices.map((row) => row.offer.id)
  );
  const server = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/compare?sort=totalBeforeDelivery&allowStale=true`
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).observedPrices.map((row) => row.offer.id),
    report.observedPrices.map((row) => row.offer.id)
  );
  assert.equal(app.cache.stats.downloads, 0);
  assert.equal(app.cache.stats.misses, 0);
  await app.cache.invalidate(
    'https://www.lazada.vn/products/pdp-i3261102356.html',
    { reason: 'Require a new selected-SKU capture' }
  );
  const invalidated = await app.compare({
    sort: 'totalBeforeDelivery',
    allowStale: true,
  });
  assert.equal(invalidated.observedPrices.length, 3);
  const powder = invalidated.comparisons.find((row) =>
    row.offer.url.includes('i3261102356')
  );
  assert.equal(powder.offer.priceInvalidated, true);
  assert.equal(powder.metrics.totalAfterDelivery, null);
  await assert.rejects(
    app.collect(powder.offer.url),
    /Invalidated source needs an online reload/u
  );
  assert.equal(app.cache.stats.downloads, 0);
});
