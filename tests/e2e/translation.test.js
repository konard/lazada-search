import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import {
  AssociativeStore,
  LazadaSearch,
  DomainScheduler,
  CachedTranslator,
  planCatalogTranslation,
  createHttpTranslationProvider,
  createTelegramBot,
  COLLECTION_STOP_ID,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/translation/vi-en.json', import.meta.url))
);

async function localApi(t, status = 200, translate) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    requests.push({ input, authorization: request.headers.authorization });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    const pair = fixture.pairs.find((item) => item.vi === input.text);
    response.end(
      JSON.stringify({
        translatedText: translate ? translate(input) : pair?.en,
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/translate`,
    requests,
  };
}
async function directoryFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-translation-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function cli(directory, arguments_, env = {}) {
  const result = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      ...arguments_,
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
        ...env,
      },
    }
  );
  return JSON.parse(result.stdout);
}

test('real CLI opts into local HTTP, reuses cache and replays without credentials or an endpoint', async (t) => {
  const directory = await directoryFor(t);
  const api = await localApi(t);
  const pair = fixture.pairs[0];
  const identity = [
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '1',
  ];
  const configured = [
    'translate',
    pair.vi,
    ...identity,
    '--translation-endpoint',
    api.endpoint,
    '--translation-token-env',
    'FIXTURE_TRANSLATION_TOKEN',
  ];
  const first = await cli(directory, configured, {
    FIXTURE_TRANSLATION_TOKEN: 'fixture-private-secret',
  });
  assert.equal(first.translatedText, pair.en);
  assert.equal(first.originalText, pair.vi);
  assert.equal(first.presentationOnly, true);
  assert.equal(first.authoritative, false);
  assert.equal(api.requests[0].authorization, 'Bearer fixture-private-secret');
  const second = await cli(directory, configured);
  assert.equal(second.cacheHit, true);
  assert.equal(api.requests.length, 1);
  const offline = await cli(directory, [
    'translate',
    pair.vi,
    ...identity,
    '--offline',
  ]);
  assert.equal(offline.translatedText, pair.en);
  assert.equal(offline.cacheHit, true);
  assert.equal(api.requests.length, 1);
  await cli(directory, [...configured, '--refresh']);
  assert.equal(api.requests.length, 2);
  const store = new AssociativeStore({ directory });
  assert.ok(
    !JSON.stringify(await store.list('translation')).includes(
      'fixture-private-secret'
    )
  );
  const pending = await cli(directory, ['translate', fixture.pairs[1].vi]);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.translatedText, undefined);
  assert.equal(api.requests.length, 2);
});

test('HTTP provider obeys pacing and persistent CAPTCHA stop before making any new call', async (t) => {
  const api = await localApi(t);
  const directory = await directoryFor(t);
  const store = new AssociativeStore({ directory });
  const sleeps = [];
  const scheduler = new DomainScheduler({
    intervalMs: 60000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler,
    translationProvider: createHttpTranslationProvider({
      endpoint: api.endpoint,
      id: 'fixture-human',
      version: '1',
    }),
  });
  t.after(() => app.close());
  await app.translate(fixture.pairs[0].vi);
  await app.translate(fixture.pairs[1].vi);
  assert.equal(api.requests.length, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] > 50000);
  await store.put('collection-stop', { id: COLLECTION_STOP_ID, active: true });
  assert.equal(
    (await app.translate(fixture.pairs[2].vi)).reason,
    'collection-stopped'
  );
  assert.equal(api.requests.length, 2);
  assert.equal((await app.translate(fixture.pairs[0].vi)).cacheHit, true);
});

test('real HTTP rate-limit response checkpoints a stop and blocks subsequent translations', async (t) => {
  const api = await localApi(t, 429);
  const store = new AssociativeStore({ directory: await directoryFor(t) });
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: createHttpTranslationProvider({
      endpoint: api.endpoint,
      id: 'fixture-human',
      version: '1',
    }),
  });
  t.after(() => app.close());
  const rejected = await app.translate(fixture.pairs[0].vi);
  assert.equal(rejected.reason, 'collection-stopped');
  assert.equal(rejected.translatedText, undefined);
  const stop = await store.get('collection-stop', COLLECTION_STOP_ID);
  assert.equal(stop.active, true);
  assert.deepEqual(stop.signals, ['translation-http-429']);
  await app.translate(fixture.pairs[1].vi);
  assert.equal(api.requests.length, 1);
});

async function telegramFixture(t, app) {
  const messages = [];
  const api = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const message = JSON.parse(body);
    messages.push(message);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
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
  let number = 0;
  const update = (text, userId = 777) => ({
    update_id: ++number,
    message: {
      message_id: number,
      date: 0,
      from: { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId, type: 'private' },
      text,
      entities: [
        { offset: 0, length: text.split(' ')[0].length, type: 'bot_command' },
      ],
    },
  });
  return { bot, messages, update };
}

test('real Telegram commands deliver original and cached English, pending failures, and reject unauthorized actors', async (t) => {
  const directory = await directoryFor(t);
  const store = new AssociativeStore({ directory });
  let calls = 0;
  const provider = {
    id: 'fixture-human',
    version: '1',
    translate: ({ originalText }) => {
      calls += 1;
      const pair = fixture.pairs.find((item) => item.vi === originalText);
      if (!pair) {
        throw new Error('Unavailable test translation');
      }
      return pair.en;
    },
  };
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: provider,
  });
  t.after(() => app.close());
  const { bot, messages, update } = await telegramFixture(t, app);
  await store.put('product', {
    id: 'translation-ice',
    title: fixture.pairs[0].vi,
    proteinPer100g: 3.5,
    evidenceIds: ['original-label'],
  });
  await bot.handleUpdate(update(`/translate "${fixture.pairs[0].vi}"`));
  let result = JSON.parse(messages.at(-1).text);
  assert.equal(result.originalText, fixture.pairs[0].vi);
  assert.equal(result.translatedText, fixture.pairs[0].en);
  assert.equal(result.authoritative, false);
  await bot.handleUpdate(update('/translate_product translation-ice'));
  result = JSON.parse(messages.at(-1).text);
  assert.equal(result.complete, true);
  assert.equal(result.translations[0].cacheHit, true);
  assert.equal(calls, 1);
  assert.equal(
    (await store.get('product', 'translation-ice')).proteinPer100g,
    3.5
  );
  await bot.handleUpdate(update('/translate "Nội dung chưa dịch"'));
  assert.equal(JSON.parse(messages.at(-1).text).status, 'pending');
  const count = messages.length;
  await bot.handleUpdate(update('/translate "Forbidden"', 999));
  assert.equal(messages.length, count);
});

test('real CLI refuses corrupted quantity translations and preserves the source-bound candidate', async (t) => {
  const directory = await directoryFor(t);
  const api = await localApi(t, 200, (input) =>
    input.text.replace('40 g', '400 g')
  );
  const result = await cli(directory, [
    'translate',
    fixture.pairs[0].vi,
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '1',
    '--translation-endpoint',
    api.endpoint,
  ]);
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'translation-quality-failed');
  assert.equal(result.translatedText, undefined);
  assert.equal(result.originalText, fixture.pairs[0].vi);
  assert.ok(result.qualityChecks.issues.includes('number-mismatch'));
  assert.equal(api.requests.length, 1);
  const replay = await cli(directory, [
    'translate',
    fixture.pairs[0].vi,
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '1',
    '--offline',
  ]);
  assert.equal(replay.status, 'pending');
  assert.equal(api.requests.length, 1);
});

async function comparisonSetup(t) {
  const directory = await directoryFor(t);
  const api = await localApi(t);
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: createHttpTranslationProvider({
      endpoint: api.endpoint,
      id: 'fixture-human',
      version: '1',
    }),
  });
  t.after(() => app.close());
  await app.importRecords({
    products: [
      {
        id: 'translated-ice',
        url: 'https://www.lazada.vn/products/fixture-i1201.html',
        category: 'chocolate-ice-cream',
        title: fixture.pairs[0].vi,
        description: fixture.pairs[1].vi,
        netMassG: 40,
        packCount: 5,
        proteinPer100g: 3.5,
      },
    ],
    offers: [
      {
        id: 'translated-ice-offer',
        productId: 'translated-ice',
        url: 'https://www.lazada.vn/products/fixture-i1201.html',
        sku: '1201_VNAMZ-2401',
        price: 39000,
        currency: 'VND',
        variantConfirmed: true,
        observedAt: new Date().toISOString(),
      },
    ],
  });
  const originals = {
    product: await store.get('product', 'translated-ice'),
    offer: await store.get('offer', 'translated-ice-offer'),
  };
  const title = await app.translate(fixture.pairs[0].vi);
  const description = await app.translate(fixture.pairs[1].vi);
  const { bot, messages, update } = await telegramFixture(t, app);
  return {
    directory,
    api,
    store,
    app,
    originals,
    title,
    description,
    bot,
    messages,
    update,
  };
}

async function approve(app, record) {
  return app.translator.review(record.id, {
    sourceSha256: record.sourceSha256,
    translatedSha256: record.translatedSha256,
    reviewer: 'human-fixture-reviewer',
    decision: 'approved',
  });
}

async function seedChunkPresentation(ctx, description) {
  const product = await ctx.store.get('product', 'translated-ice');
  if (description) {
    await ctx.store.put('product', { ...product, description });
  }
  const offer = await ctx.store.get('offer', 'translated-ice-offer');
  await ctx.store.put('offer', {
    ...offer,
    seller: 'Cửa hàng',
    promotionText: 'Giảm 10%',
  });
  const plan = await planCatalogTranslation(ctx.app, { maxChunkBytes: 12 });
  const sources = plan.items.filter(
    (item) =>
      item.sourceKind === 'offer' ||
      (description &&
        item.sourceKind === 'product' &&
        item.path[0] === 'description')
  );
  await ctx.store.putMany('translation-catalog-source', sources);
  const filler = new CachedTranslator({
    store: ctx.store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    provider: {
      id: 'fixture-human',
      version: '1',
      translate: ({ originalText }) =>
        ({ 'Cửa hàng': 'Store', 'Giảm 10%': '10% off' })[originalText] ||
        originalText.replaceAll('Sữa', 'Milk'),
    },
  });
  for (const source of sources) {
    await approve(ctx.app, await filler.translate(source.originalText));
  }
}

test('library, real CLI, HTTP and Telegram use reviewed cached English without changing originals or unit costs', async (t) => {
  const ctx = await comparisonSetup(t);
  const { app, bot, messages, update, store, api } = ctx;
  await bot.handleUpdate(
    update(
      '/compare --category chocolate-ice-cream --sort costPerGramBeforeDelivery'
    )
  );
  assert.match(messages.map((item) => item.text).join(''), /Kem sô cô la 40 g/);
  assert.ok(
    !messages
      .map((item) => item.text)
      .join('')
      .includes(fixture.pairs[0].en)
  );
  await approve(app, ctx.title);
  await approve(app, ctx.description);
  await store.put('collection-stop', { id: COLLECTION_STOP_ID, active: true });
  const library = await app.compare({
    category: 'chocolate-ice-cream',
    sort: 'costPerGramBeforeDelivery',
  });
  const command = await cli(ctx.directory, [
    'compare',
    '--category',
    'chocolate-ice-cream',
    '--sort',
    'costPerGramBeforeDelivery',
    '--offline',
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '1',
  ]);
  const server = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const http = await (
    await fetch(
      `${origin}/api/compare?category=chocolate-ice-cream&sort=costPerGramBeforeDelivery`
    )
  ).json();
  for (const result of [library, command, http]) {
    const row = result.observedPrices[0];
    assert.equal(row.product.title, fixture.pairs[0].vi);
    assert.equal(row.product.presentation.title.text, fixture.pairs[0].en);
    assert.equal(row.product.presentation.title.status, 'reviewed');
    assert.equal(row.product.netMassG, 40);
    assert.equal(row.metrics.costPerGramBeforeDelivery, 195);
    assert.equal(row.offer.price, 39000);
  }
  const previous = messages.length;
  await bot.handleUpdate(
    update(
      '/compare --category chocolate-ice-cream --sort costPerGramBeforeDelivery'
    )
  );
  const telegram = messages
    .slice(previous)
    .map((item) => item.text)
    .join('');
  assert.ok(telegram.includes(fixture.pairs[0].en));
  assert.ok(telegram.includes(`Original: ${fixture.pairs[0].vi}`));
  assert.equal(api.requests.length, 2);
  assert.deepEqual(
    await store.get('product', 'translated-ice'),
    ctx.originals.product
  );
  assert.deepEqual(
    await store.get('offer', 'translated-ice-offer'),
    ctx.originals.offer
  );
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('served web calculator consumes reviewed English with original Vietnamese visible, using a local DOM fixture', async (t) => {
  const ctx = await comparisonSetup(t);
  await approve(ctx.app, ctx.title);
  await approve(ctx.app, ctx.description);
  await seedChunkPresentation(ctx);
  const server = await startServer({ application: ctx.app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(origin)).text();
  const script = await (await fetch(`${origin}/app.js`)).text();
  const { document } = parseHTML(html);
  let finished;
  const ready = new Promise((resolve) => {
    finished = resolve;
  });
  const http = async (path) => {
    const response = await fetch(`${origin}${path}`);
    return {
      ok: response.ok,
      json: async () => {
        const data = await response.json();
        if (path === '/api/coverage') {
          finished();
        }
        return data;
      },
    };
  };
  class FixtureFormData {
    *[Symbol.iterator]() {
      yield ['category', 'chocolate-ice-cream'];
      yield ['sort', 'costPerGramBeforeDelivery'];
    }
  }
  runInNewContext(script, {
    document,
    URLSearchParams,
    FormData: FixtureFormData,
    fetch: http,
  });
  await ready;
  const rows = document.querySelector('#offers').textContent;
  assert.ok(rows.includes(fixture.pairs[0].en));
  assert.ok(rows.includes(`Original: ${fixture.pairs[0].vi}`));
  assert.ok(rows.includes(fixture.pairs[1].en));
  assert.ok(rows.includes(fixture.pairs[1].vi));
  assert.ok(rows.includes('195'));
  assert.ok(rows.includes('Store (Original: Cửa hàng)'));
  assert.equal(ctx.api.requests.length, 2);
});

test('reviewed catalog chunks and commercial text replay through library, real CLI, HTTP and Telegram while collection stays stopped', async (t) => {
  const ctx = await comparisonSetup(t);
  await approve(ctx.app, ctx.title);
  const original = 'Sữa 🍫. '.repeat(4);
  const translated = 'Milk 🍫. '.repeat(4);
  await seedChunkPresentation(ctx, original);
  await ctx.store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
  });
  ctx.app.translator.offline = true;
  const library = await ctx.app.compare({
    category: 'chocolate-ice-cream',
    sort: 'costPerGramBeforeDelivery',
  });
  const command = await cli(ctx.directory, [
    'compare',
    '--category',
    'chocolate-ice-cream',
    '--sort',
    'costPerGramBeforeDelivery',
    '--offline',
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '1',
  ]);
  const server = await startServer({ application: ctx.app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const http = await (
    await fetch(
      `http://127.0.0.1:${server.address().port}/api/compare?category=chocolate-ice-cream&sort=costPerGramBeforeDelivery`
    )
  ).json();
  for (const result of [library, command, http]) {
    const row = result.observedPrices[0];
    assert.equal(row.product.description, original);
    assert.equal(row.product.presentation.description.text, translated);
    assert.equal(
      row.product.presentation.description.chunkProof.chunks.length,
      4
    );
    assert.equal(row.offer.seller, 'Cửa hàng');
    assert.equal(row.offer.presentation.seller.text, 'Store');
    assert.equal(row.offer.presentation.promotionText.text, '10% off');
    assert.equal(row.offer.price, 39000);
    assert.equal(row.metrics.costPerGramBeforeDelivery, 195);
  }
  await ctx.bot.handleUpdate(
    ctx.update(
      '/compare --category chocolate-ice-cream --sort costPerGramBeforeDelivery'
    )
  );
  const telegram = ctx.messages.map((item) => item.text).join('');
  assert.ok(telegram.includes('Seller: Store\nOriginal: Cửa hàng'));
  assert.ok(telegram.includes('Promotion text: 10% off\nOriginal: Giảm 10%'));
  assert.equal(ctx.api.requests.length, 2);
  assert.equal(
    (await ctx.store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});
