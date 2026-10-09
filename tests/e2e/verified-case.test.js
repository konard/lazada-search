import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('verified public case keeps factory corrections and prices across library, CLI, HTTP and Telegram offline', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-verified-case-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({
      directory,
      archive: 'data/cases/vietnam-nha-trang',
    }),
    offline: true,
    ocr: false,
  });
  app.collector.start = () => {
    throw Error('Public case replay must not launch a browser');
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const opts = {
    category: 'whey',
    allowStale: true,
    sort: 'costPerProteinGramBeforeDelivery',
  };
  const report = await app.compare(opts);
  const verified = report.comparisons.filter((row) => row.manufacturerVerified);
  assert.ok(verified.length >= 11);
  const just = verified.find(
    (row) => row.offer.sku === '3201573592_VNAMZ-15280912681'
  );
  assert.equal(just.product.netMassG, 2268);
  assert.equal(just.product.proteinPer100g, (30 / 33) * 100);
  assert.equal(just.metrics.totalAfterDelivery, 3170000);
  assert.ok(
    just.product.corrections.some(
      (c) => c.field === 'netMassG' && c.previous === 2300
    )
  );
  const chocolate = verified.find(
    (row) => row.offer.sku === '13384018556_VNAMZ-116984256859'
  );
  const vanilla = verified.find(
    (row) => row.offer.sku === '13384018556_VNAMZ-116984256856'
  );
  assert.equal(chocolate.product.proteinPer100g, (26 / 30) * 100);
  assert.equal(vanilla.product.proteinPer100g, 90);
  const bulk = await app.compare({ ...opts, quantity: 10 });
  assert.equal(
    bulk.comparisons.find((row) => row.offer.id === just.offer.id).metrics
      .totalAfterDelivery,
    null
  );
  const cli = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'compare',
      '--data-dir',
      join(directory, 'cli'),
      '--archive-dir',
      'data/cases/vietnam-nha-trang',
      '--offline',
      '--no-ocr',
      '--allow-stale',
      '--category',
      'whey',
      '--sort',
      'costPerProteinGramBeforeDelivery',
    ],
    { maxBuffer: 32 * 1024 ** 2 }
  );
  const cliReport = JSON.parse(cli.stdout);
  assert.deepEqual(
    cliReport.ranked.map((row) => row.offer.id),
    report.ranked.map((row) => row.offer.id)
  );
  const http = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${http.address().port}/api/compare?category=whey&allowStale=true&sort=costPerProteinGramBeforeDelivery`
  );
  assert.equal(response.status, 200);
  const httpReport = await response.json();
  assert.deepEqual(
    httpReport.ranked.map((row) => row.offer.id),
    report.ranked.map((row) => row.offer.id)
  );
  const messages = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    const message = JSON.parse(body);
    messages.push(message.text);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: messages.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: message.text,
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
  const text =
    '/compare --category whey --allow-stale --sort costPerProteinGramBeforeDelivery';
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
  const full = messages.join('\n');
  for (const row of verified) {
    assert.ok(full.includes(row.product.title), `Missing ${row.offer.sku}`);
  }
  assert.match(full, /90.9090909090909 g protein\/100 g/);
  assert.match(full, /3170000.00/);
  assert.equal(app.cache.stats.downloads, 0);
  assert.equal(app.cache.stats.misses, 0);
});
