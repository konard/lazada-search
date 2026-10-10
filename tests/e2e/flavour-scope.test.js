import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  LazadaSearch,
  createTelegramBot,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const scope = 'chocolate-or-unflavoured';

async function scopedFixtures() {
  const fixture = JSON.parse(
    await readFile(new URL('../fixtures/products.json', import.meta.url))
  );
  const cases = [
    { id: 'plain', title: 'Scope unflavoured whey', included: true },
    { id: 'chocolate', title: 'Scope chocolate whey', included: true },
    {
      id: 'selected',
      title: 'Scope chocolate vanilla whey, choose flavour',
      selectedVariant: [{ text: 'Chocolate 1 kg' }, { text: 'Gift shaker' }],
      included: true,
    },
    { id: 'vanilla', title: 'Scope vanilla whey' },
    { id: 'mixed-powder', title: 'Scope chocolate banana whey' },
    { id: 'unknown-powder', title: 'Scope whey isolate 1 kg' },
    {
      id: 'ice',
      title: 'Scope chocolate ice cream',
      ice: true,
      included: true,
    },
    { id: 'mixed-ice', title: 'Scope chocolate banana ice cream', ice: true },
    {
      id: 'coated',
      title: 'Scope vanilla ice cream coated with chocolate',
      ice: true,
    },
    { id: 'unknown-ice', title: 'Scope ice cream 500 g', ice: true },
    {
      id: 'reviewed-vanilla',
      title: 'Scope advertised chocolate ice cream',
      ice: true,
      manufacturerFlavour: 'Vanilla with chocolate coating',
    },
  ];
  const products = [];
  const offers = [];
  for (const [index, item] of cases.entries()) {
    const baseIndex = item.ice ? 2 : 0;
    const base = globalThis.structuredClone(fixture.products[baseIndex]);
    const url = `https://www.lazada.vn/products/scope-i${4000 + index}.html`;
    products.push({
      ...base,
      id: item.id,
      title: item.title,
      url,
      ...(item.selectedVariant
        ? { selectedVariant: item.selectedVariant }
        : {}),
      manufacturerVerification: {
        ...base.manufacturerVerification,
        ...(item.manufacturerFlavour
          ? { identity: { flavour: item.manufacturerFlavour } }
          : {}),
      },
    });
    offers.push({
      ...globalThis.structuredClone(fixture.offers[baseIndex]),
      id: `scope-offer-${item.id}`,
      productId: item.id,
      url,
      // Wrong flavours would win a price sort without the strict SKU filter.
      price: item.included ? fixture.offers[baseIndex].price : 1,
      observedAt: new Date().toISOString(),
    });
  }
  return { products, offers, cases };
}

const productIds = (rows) => rows.map((row) => row.product.id).sort();

function assertScopedReport(report, expected) {
  assert.equal(report.assumptions.flavourScope, scope);
  assert.deepEqual(productIds(report.comparisons), expected);
  assert.deepEqual(productIds(report.ranked), expected);
  assert.deepEqual(productIds(report.observedPrices), expected);
  assert.deepEqual(report.excluded, []);
  assert.deepEqual(report.unsortable, []);
  assert.ok(report.comparisons.every((row) => row.manufacturerVerified));
}

test('strict SKU flavours survive offline associative storage, CLI, HTTP and Telegram without admitting cheaper other flavours', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-flavour-e2e-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
    flavourScope: scope,
  });
  app.collector.start = () => {
    throw Error('Flavour comparisons must not open a browser');
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { products, offers, cases } = await scopedFixtures();
  await app.importRecords({ products, offers });
  const expected = cases
    .filter((item) => item.included)
    .map((item) => item.id)
    .sort();
  const options = { flavourScope: scope, sort: 'totalBeforeDelivery' };
  const report = await app.compare(options);
  assertScopedReport(report, expected);
  assertScopedReport(
    await app.compare({ sort: 'totalBeforeDelivery' }),
    expected
  );
  assert.equal(
    (await app.compare({ flavourScope: 'all' })).ranked.length,
    cases.length
  );
  assert.equal((await app.store.list('product')).length, cases.length);
  const cli = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'compare',
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
      '--flavour-scope',
      scope,
      '--sort',
      options.sort,
    ],
    { maxBuffer: 4 * 1024 ** 2, timeout: 30000 }
  );
  assertScopedReport(JSON.parse(cli.stdout), expected);

  const http = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const root = `http://127.0.0.1:${http.address().port}`;
  const params = new URLSearchParams(options);
  const response = await fetch(`${root}/api/compare?${params}`);
  assert.equal(response.status, 200);
  assertScopedReport(await response.json(), expected);
  const defaults = await fetch(`${root}/api/compare?sort=totalBeforeDelivery`);
  assert.equal(defaults.status, 200);
  assertScopedReport(await defaults.json(), expected);
  const invalid = await fetch(`${root}/api/compare?flavourScope=vanilla`);
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /Unsupported flavour scope/u);

  const messages = [];
  const api = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const sent = JSON.parse(body);
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
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
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
    client: { apiRoot: `http://127.0.0.1:${api.address().port}`, fetch },
  });
  const command = `/compare --sort ${options.sort}`;
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: { id: 777, is_bot: false, first_name: 'Tester' },
      chat: { id: 777, type: 'private' },
      text: command,
      entities: [{ offset: 0, length: 8, type: 'bot_command' }],
    },
  });
  const text = messages.join('');
  for (const item of cases) {
    assert.equal(
      text.includes(`${item.title}\n`),
      item.included === true,
      item.id
    );
  }
  assert.match(text, /4 eligible offers; 0 need information/u);
  assert.equal(app.cache.stats.downloads, 0);
  assert.equal(app.cache.stats.misses, 0);
});
