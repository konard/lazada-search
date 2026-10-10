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
  DomainScheduler,
  createHttpTranslationProvider,
  createTelegramBot,
  COLLECTION_STOP_ID,
} from '../../src/index.js';

const execute = promisify(execFile);
const fixture = JSON.parse(
  await readFile(new URL('../fixtures/translation/vi-en.json', import.meta.url))
);

async function localApi(t, status = 200) {
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
    response.end(JSON.stringify({ translatedText: pair?.en }));
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
