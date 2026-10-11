import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  AssociativeStore,
  LazadaSearch,
  DomainScheduler,
  createHttpTranslationProvider,
  createTelegramBot,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const translations = new Map([
  ['Kem sô cô la', 'Chocolate ice cream'],
  ['sữa', 'milk'],
  ['ca cao', 'cocoa'],
]);

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-catalog-e2e-'));
  const requests = [];
  const provider = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    requests.push(input);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({ translatedText: translations.get(input.text) })
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${provider.address().port}/translate`;
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: createHttpTranslationProvider({
      endpoint,
      id: 'fixture-catalog',
      version: '1',
    }),
  });
  await store.put('product', {
    id: 'fixture-ice',
    title: 'Kem sô cô la',
    ingredients: ['sữa', 'ca cao'],
  });
  const server = await startServer({ application: app, port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await app.close();
    await new Promise((resolve) => provider.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, app, origin, endpoint, requests };
}

async function post(origin, path, value, headers = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
  return { status: response.status, result: await response.json() };
}

async function cli(directory, args) {
  const { stdout } = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      ...args,
      '--data-dir',
      directory,
      '--no-archive',
      '--no-ocr',
      '--interval-ms',
      '0',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      env: {
        ...process.env,
        LAZADA_TRANSLATION_ENDPOINT: '',
        LAZADA_TRANSLATION_PROVIDER: 'unconfigured',
        LAZADA_TRANSLATION_TOKEN: '',
      },
    }
  );
  return JSON.parse(stdout);
}

async function telegram(t, application) {
  const replies = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const message = JSON.parse(body);
    replies.push(message.text);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: replies.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: message.text,
        },
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const bot = createTelegramBot({
    application,
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
  let count = 0;
  const send = async (text) => {
    const before = replies.length;
    await bot.handleUpdate({
      update_id: ++count,
      message: {
        message_id: count,
        date: 0,
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        chat: { id: 777, type: 'private' },
        text,
        entities: [
          { offset: 0, length: text.split(' ')[0].length, type: 'bot_command' },
        ],
      },
    });
    const reply = replies.slice(before).join('');
    return reply.startsWith('Command failed:') ? reply : JSON.parse(reply);
  };
  return { send, replies };
}

test('bounded catalog jobs resume through library, real CLI, HTTP and Telegram and replay offline', async (t) => {
  const { app, directory, origin, endpoint, requests } = await setup(t);
  const pending = await app.translateCatalog({
    includeSources: false,
    limit: 1,
  });
  assert.equal(pending.counts.pending, 1);
  assert.equal(requests.length, 0);
  const identity = [
    '--translation-provider',
    'fixture-catalog',
    '--translation-version',
    '1',
  ];
  const cliResult = await cli(directory, [
    'translate-catalog',
    ...identity,
    '--translation-endpoint',
    endpoint,
    '--translation-download',
    '--translation-limit',
    '1',
    '--no-translation-sources',
  ]);
  assert.equal(cliResult.lastRun.providerResults, 1);
  const http = await post(origin, '/api/translation-catalog', {
    cacheOnly: false,
    limit: 1,
    includeSources: false,
  });
  assert.equal(http.status, 200);
  assert.equal(http.result.lastRun.providerResults, 1);
  const bot = await telegram(t, app);
  const completed = await bot.send(
    '/translate_catalog --translation-download --translation-limit 1 --no-translation-sources'
  );
  assert.equal(completed.complete, true);
  assert.equal(completed.counts.translated, 3);
  assert.equal(requests.length, 3);
  const httpStatus = await fetch(
    `${origin}/api/translation-status?jobId=${encodeURIComponent(completed.id)}`
  ).then((response) => response.json());
  assert.equal(httpStatus.complete, true);
  const tgStatus = await bot.send(`/translation_status ${completed.id}`);
  assert.deepEqual(tgStatus.counts, httpStatus.counts);
  const offline = await cli(directory, [
    'translate-catalog',
    ...identity,
    '--offline',
    '--no-translation-sources',
  ]);
  assert.equal(offline.complete, true);
  assert.equal(offline.lastRun.processed, 0);
  assert.equal(requests.length, 3);
  const original = await app.store.get('product', 'fixture-ice');
  assert.equal(original.title, 'Kem sô cô la');
  assert.deepEqual(original.ingredients, ['sữa', 'ca cao']);
});

test('same-origin HTTP operation handling rejects remote origins, filesystem commands and oversized bodies', async (t) => {
  const { origin, requests } = await setup(t);
  const denied = await post(
    origin,
    '/api/translation-catalog',
    { cacheOnly: false },
    { Origin: 'https://untrusted.invalid' }
  );
  assert.equal(denied.status, 400);
  assert.match(denied.result.error, /same local origin/);
  const unsupported = await post(origin, '/api/operations', {
    operation: 'archive',
    args: ['/private/fixture'],
  });
  assert.equal(unsupported.status, 400);
  const excessive = await post(origin, '/api/translation', {
    text: 'a'.repeat(1048576),
  });
  assert.equal(excessive.status, 400);
  assert.match(excessive.result.error, /exceeds 1 MiB/);
  const contentType = await fetch(`${origin}/api/translation`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  assert.equal(contentType.status, 400);
  assert.equal(requests.length, 0);
});

test('HTTP and Telegram structured operations preserve import sources and quote validation', async (t) => {
  const { app, origin } = await setup(t);
  const imported = await post(origin, '/api/operations', {
    operation: 'import',
    input: {
      records: {
        discoveries: [
          {
            id: 'fixture-discovery',
            title: 'Bột whey',
            url: 'https://www.lazada.vn/products/fixture-i123.html',
          },
        ],
      },
    },
  });
  assert.equal(imported.status, 200);
  const sources = await app.store.list('import-source');
  assert.equal(sources.length, 1);
  const original = JSON.parse(
    (await app.store.blob(sources[0].source.sha256)).toString()
  );
  assert.equal(original.discoveries[0].title, 'Bột whey');
  const inspected = await post(origin, '/api/operations', {
    operation: 'inspect',
    input: { kind: 'discovery', id: 'fixture-discovery' },
  });
  assert.equal(inspected.result.title, 'Bột whey');
  const bot = await telegram(t, app);
  const telegramResult = await bot.send(
    '/operation {"operation":"inspect","input":{"kind":"discovery","id":"fixture-discovery"}}'
  );
  assert.deepEqual(telegramResult, inspected.result);
  const rejected = await post(origin, '/api/operations', {
    operation: 'quote',
    input: { offerId: 'missing-offer', quote: { shipping: -1 } },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.result.error, /Unknown offer/);
  const fixture = JSON.parse(
    await readFile(
      new URL('../fixtures/products.json', import.meta.url),
      'utf8'
    )
  );
  const offer = fixture.offers.find((item) => item.id === 'ice-cream-offer');
  await app.store.put('offer', offer);
  const quoted = await post(origin, '/api/operations', {
    operation: 'quote',
    input: {
      offerId: offer.id,
      quote: { shipping: 15000, shippingQuantity: 10 },
    },
  });
  assert.equal(quoted.status, 200);
  assert.equal(quoted.result.shipping, 15000);
  const invalid = await post(origin, '/api/operations', {
    operation: 'quote',
    input: { offerId: offer.id, quote: { shipping: -1 } },
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.result.error, /shipping/iu);
  const tgRejected = await bot.send(
    `/operation ${JSON.stringify({ operation: 'quote', input: { offerId: offer.id, quote: { shipping: -1 } } })}`
  );
  assert.match(tgRejected, /Command failed:.*shipping/iu);
  assert.equal((await app.store.get('offer', offer.id)).shipping, 15000);
  const tgQuoted = await bot.send(
    `/operation ${JSON.stringify({ operation: 'quote', input: { offerId: offer.id, quote: { shipping: 10000, shippingQuantity: 10 } } })}`
  );
  assert.equal(tgQuoted.shipping, 10000);
  assert.equal(tgQuoted.shippingQuantity, 10);
});

test('manufacturer research cannot replace configured authority through library, CLI, HTTP or Telegram', async (t) => {
  const { app, directory, origin, requests } = await setup(t);
  const plan = {
    registry: [{ brand: 'Fixture', domains: ['untrusted.invalid'] }],
  };
  assert.throws(
    () => app.manufacturerResearch(plan),
    /cannot replace the configured trusted/
  );
  const file = join(directory, 'untrusted-plan.json');
  await writeFile(file, JSON.stringify(plan));
  await assert.rejects(
    cli(directory, ['manufacturer-research', file, '--offline']),
    /cannot replace the configured trusted/
  );
  const rejected = await post(origin, '/api/operations', {
    operation: 'manufacturer-research',
    input: { plan },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.result.error, /cannot replace the configured trusted/);
  const bot = await telegram(t, app);
  const reply = await bot.send(
    `/operation ${JSON.stringify({ operation: 'manufacturer-research', input: { plan } })}`
  );
  assert.match(reply, /Command failed:.*cannot replace the configured trusted/);
  assert.equal(requests.length, 0);
});
