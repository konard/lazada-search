import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  LazadaSearch,
  createTelegramBot,
  parseProduct,
  reviewListingCategory,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const scope = 'chocolate-or-unflavoured';
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/ice-selling-units.json', import.meta.url))
);

async function application(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-ice-quantity-e2e-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
    flavourScope: scope,
  });
  app.collector.start = () => {
    throw new Error('Carton replay and comparisons cannot open a browser');
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, directory };
}

async function cli(directory, command, args = []) {
  const result = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      command,
      ...args,
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
    ],
    { timeout: 30000, maxBuffer: 4 * 1024 ** 2 }
  );
  return JSON.parse(result.stdout);
}

async function telegram(t, app) {
  const messages = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const sent = JSON.parse(Buffer.concat(chunks).toString());
    messages.push(sent.text);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: messages.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: sent.text,
        },
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const bot = createTelegramBot({
    application: app,
    token: '123:TEST',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: `http://127.0.0.1:${server.address().port}`, fetch },
  });
  return {
    messages,
    async compare(text) {
      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat: { id: 777, type: 'private' },
          text,
          entities: [{ offset: 0, length: 8, type: 'bot_command' }],
        },
      });
      return messages.join('');
    },
  };
}

function assertCartonComparison(report) {
  assert.deepEqual(
    report.observedPrices.map((r) => r.offer.sku),
    ['9201_VNAMZ-103', '9201_VNAMZ-102', '9201_VNAMZ-101']
  );
  const bySku = new Map(report.comparisons.map((r) => [r.offer.sku, r]));
  const carton = bySku.get('9201_VNAMZ-102');
  assert.equal(carton.product.packCount, 24);
  assert.equal(carton.metrics.totalMassG, 6288);
  assert.equal(carton.metrics.totalVolumeMl, 6240);
  assert.equal(carton.metrics.totalBeforeDelivery, 1296000);
  assert.equal(carton.metrics.totalAfterDelivery, 1380000);
  assert.equal(carton.metrics.costPerGramBeforeDelivery, 1296000 / 6288);
  assert.equal(carton.metrics.costPerGramAfterDelivery, 1380000 / 6288);
  assert.equal(carton.metrics.costPerMlBeforeDelivery, 1296000 / 6240);
  assert.equal(carton.metrics.costPerMlAfterDelivery, 1380000 / 6240);
  assert.equal(carton.metrics.totalProteinG, null);
  assert.equal(carton.manufacturerVerified, false);
  assert.equal(report.ranked.length, 0);
  const unknown = bySku.get('9202_VNAMZ-201');
  assert.equal(unknown.product.packageCountUnresolved, true);
  assert.equal(unknown.metrics.totalVolumeMl, null);
  assert.equal(unknown.metrics.totalMassG, null);
  assert.ok(report.unsortable.some((r) => r.offer.sku === unknown.offer.sku));
  assert.equal(bySku.has('9203_VNAMZ-301'), false);
  assert.equal(bySku.has('9204_VNAMZ-401'), false);
}

test('carton arithmetic and strict core filtering survive library, real CLI, HTTP and local Telegram comparisons offline', async (t) => {
  const { app, directory } = await application(t);
  const records = fixture.cases.map((c) => parseProduct(c.snapshot));
  await app.importRecords({
    products: records.map((r) => r.product),
    offers: records.map((r) => r.offer),
  });
  const options = {
    quantity: 2,
    shipping: 84000,
    flavourScope: scope,
    sort: 'costPerMlAfterDelivery',
  };
  assertCartonComparison(await app.compare(options));
  assertCartonComparison(
    await cli(directory, 'compare', [
      '--quantity',
      '2',
      '--shipping',
      '84000',
      '--flavour-scope',
      scope,
      '--sort',
      options.sort,
    ])
  );
  const http = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${http.address().port}/api/compare?${new URLSearchParams(options)}`
  );
  assert.equal(response.status, 200);
  assertCartonComparison(await response.json());
  const bot = await telegram(t, app);
  const text = await bot.compare(
    `/compare --quantity 2 --shipping 84000 --flavour-scope ${scope} --sort ${options.sort}`
  );
  assert.match(text, /Sorted costPerMlAfterDelivery: 208\.65/u);
  assert.match(text, /Sorted costPerMlAfterDelivery: 221\.15/u);
  assert.match(text, /Sorted costPerMlAfterDelivery: 553\.85/u);
  assert.match(text, /Food quantities: 6288\.00 g; 6240\.00 ml/u);
  assert.match(text, /Food g: 206\.11 \/ 219\.47/u);
  assert.match(text, /ml: 207\.69 \/ 221\.15/u);
  assert.match(text, /Manufacturer verification pending/u);
  assert.match(text, /no confirmed count of inner food packages/u);
  assert.doesNotMatch(text, /white ice-cream core|Chocolate-coated ice cream/u);
  const stored = await cli(directory, 'inspect', ['product']);
  assert.equal(stored.length, fixture.cases.length);
  assert.ok(stored.some((p) => p.title.includes('white ice-cream core')));
  assert.ok(stored.some((p) => p.title.includes('core unspecified')));
  assert.equal(app.cache.stats.downloads, 0);
  assert.equal(app.cache.stats.misses, 0);
});

test('actual saved 24-bottle page replays without downloads and retains its unavailable Nha Trang delivery', async (t) => {
  const { app, directory } = await application(t);
  const html = gunzipSync(
    await readFile(
      new URL(
        '../../docs/acceptance/ice-dual-units/expanded-root-pongta-carton.html.gz',
        import.meta.url
      )
    )
  );
  const result = await app.importCapture({
    url: 'https://www.lazada.vn/products/pdp-i3040048563.html?skuId=14623760583',
    html,
    observedAt: '2026-10-10T17:25:00Z',
  });
  assert.equal(result.product.category, 'chocolate-ice-cream');
  assert.equal(result.product.packCount, 24);
  assert.equal(result.product.netVolumeMl, 130);
  assert.equal(result.offer.deliveryAvailable, false);
  const report = await cli(directory, 'compare', [
    '--allow-stale',
    '--sort',
    'costPerMlBeforeDelivery',
  ]);
  assert.equal(report.observedPrices.length, 1);
  const row = report.observedPrices[0];
  assert.equal(row.offer.price, 648000);
  assert.equal(row.metrics.totalVolumeMl, 3120);
  assert.equal(row.metrics.costPerMlBeforeDelivery, 648000 / 3120);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.totalProteinG, null);
  assert.equal(row.metrics.totalAfterDelivery, null);
  assert.ok(
    row.problems.includes('The listing cannot deliver to this destination')
  );
  assert.equal(report.ranked.length, 0);
  assert.equal(app.cache.stats.downloads, 0);
});

test('package and per100ml protein ranks agree across library, CLI, HTTP and Telegram without invented mass', async (t) => {
  const { app, directory } = await application(t);
  const nutrition = JSON.parse(
    await readFile(
      new URL('../fixtures/ice-protein-bases.json', import.meta.url)
    )
  );
  await app.importRecords(nutrition);
  const options = {
    quantity: 2,
    shipping: 84000,
    allowStale: true,
    flavourScope: scope,
    sort: 'costPerProteinGramAfterDelivery',
  };
  const check = (report) => {
    assert.deepEqual(
      report.observedPrices.map((row) => row.offer.sku),
      ['9992_VNAMZ-102', '9991_VNAMZ-101']
    );
    const [volume, carton] = report.observedPrices;
    assert.equal(volume.metrics.totalProteinG, 12);
    assert.equal(volume.metrics.totalMassG, null);
    assert.equal(volume.metrics.costPerProteinGramBeforeDelivery, 6500);
    assert.equal(volume.metrics.costPerProteinGramAfterDelivery, 13500);
    assert.equal(volume.metrics.proteinBasis, '100ml');
    assert.equal(carton.metrics.totalProteinG, 48);
    assert.equal(carton.metrics.totalMassG, 6288);
    assert.equal(carton.metrics.costPerProteinGramBeforeDelivery, 27000);
    assert.equal(carton.metrics.costPerProteinGramAfterDelivery, 28750);
    assert.equal(carton.metrics.proteinBasis, 'package');
    assert.equal(report.ranked.length, 0);
  };
  check(await app.compare(options));
  check(
    await cli(directory, 'compare', [
      '--quantity',
      '2',
      '--shipping',
      '84000',
      '--allow-stale',
      '--flavour-scope',
      scope,
      '--sort',
      options.sort,
    ])
  );
  const http = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${http.address().port}/api/compare?${new URLSearchParams(options)}`
  );
  assert.equal(response.status, 200);
  check(await response.json());
  const bot = await telegram(t, app);
  const text = await bot.compare(
    `/compare --quantity 2 --shipping 84000 --allow-stale --flavour-scope ${scope} --sort ${options.sort}`
  );
  assert.match(text, /Sorted costPerProteinGramAfterDelivery: 13500/u);
  assert.match(text, /Sorted costPerProteinGramAfterDelivery: 28750/u);
  assert.match(text, /Manufacturer verification pending/u);
  assert.equal(app.cache.stats.downloads, 0);
});

test('Aice manual white-core quarantine survives recapture while all SKU prices and official source proof remain stored', async (t) => {
  const { app, directory } = await application(t);
  const review = JSON.parse(
    await readFile(
      new URL(
        '../../docs/acceptance/ice-dual-units/root-expanded-review.json',
        import.meta.url
      )
    )
  );
  const actual = review.reviews.find(
    (r) => r.id === 'expanded:2042258411_VNAMZ-9532010624'
  );
  assert.equal(actual.strictChocolateEligible, false);
  const artifact = actual.artifacts[0];
  const original = gunzipSync(await readFile(artifact.artifactPath));
  const blob = await app.store.putBlob(original);
  assert.equal(blob.sha256, artifact.artifactSha256);
  const capture = {
    url: 'https://www.lazada.vn/products/fixture-aice-i2042258411-s9532010624.html',
    observedAt: '2026-10-10T17:25:00Z',
    html: '<h1>Kem Aice chocolate cone 60g</h1><div data-product-price>1.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">2042258411_VNAMZ-9532010624</span></div>',
  };
  const first = await app.importCapture(capture);
  await app.store.put('evidence', {
    id: blob.sha256,
    role: 'manufacturer',
    url: artifact.url,
    blob,
    text: actual.scopeDecision,
  });
  await reviewListingCategory(app, first.product.url, {
    category: 'unknown',
    evidenceId: first.product.evidenceIds[0],
    reviewedBy: 'Offline regression reviewer',
    reason: `Official source ${artifact.url} SHA-256 ${blob.sha256}: ${actual.scopeDecision}`,
  });
  const next = await app.importCapture({
    ...capture,
    observedAt: '2026-10-10T17:26:00Z',
  });
  assert.equal(next.product.category, 'unknown');
  assert.equal(next.product.categoryReview.status, 'quarantined');
  assert.equal(next.offer.price, 1000);
  const retained = await cli(directory, 'inspect', [
    'product',
    next.product.id,
  ]);
  assert.equal(retained.category, 'unknown');
  assert.match(retained.categoryReview.reason, /white core/u);
  assert.equal(
    (await cli(directory, 'compare', ['--flavour-scope', scope])).comparisons
      .length,
    0
  );
  assert.equal((await app.store.list('offer')).length, 1);
  assert.ok(
    (await app.store.list('evidence')).some((e) => e.id === blob.sha256)
  );
  assert.equal(app.cache.stats.downloads, 0);
});
