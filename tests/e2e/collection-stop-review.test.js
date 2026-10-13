import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  LazadaSearch,
  startServer,
  createTelegramBot,
} from '../../src/index.js';
import { stopForChallenge } from '../../src/page-challenge.js';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-stop-review-e2e-'));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  app.collector.start = () => {
    throw Error('Review must never open a browser');
  };
  await stopForChallenge(store, {
    url: 'https://factory.example/label',
    signals: ['visible-cloudflare-interstitial'],
  });
  const review = {
    decision: 'dismiss-non-browser-stop',
    reason:
      'Explicit operator decision after reviewing the visible marketplace.',
    expectedStop: await store.get('collection-stop', 'browser-collection'),
    observedPageUrl: 'https://www.lazada.vn/',
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, app, review };
}

async function telegram(t, app) {
  const replies = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const message = JSON.parse(Buffer.concat(chunks).toString());
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
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const bot = createTelegramBot({
    application: app,
    token: '123:FIXTURE',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: `http://127.0.0.1:${api.address().port}`, fetch },
  });
  let count = 0;
  return async (text, userId = 777, type = 'private') => {
    const offset = replies.length;
    await bot.handleUpdate({
      update_id: ++count,
      message: {
        message_id: count,
        date: 0,
        from: { id: userId, is_bot: false, first_name: 'Fixture' },
        chat: { id: userId, type },
        text,
        entities: [
          { type: 'bot_command', offset: 0, length: text.split(' ')[0].length },
        ],
      },
    });
    return replies.slice(offset).join('');
  };
}

test('the executable CLI records the exact operator decision offline and retains original stop metadata', async (t) => {
  const { directory, review } = await fixture(t);
  const path = join(directory, 'review.json');
  await writeFile(path, JSON.stringify(review));
  const { stdout } = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'review-collection-stop',
      path,
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, LAZADA_ACCOUNT: '' },
    }
  );
  const result = JSON.parse(stdout);
  assert.equal(result.active, false);
  assert.equal(result.origin, review.expectedStop.origin);
  assert.equal(result.challengedSourceRecoveryConfirmed, false);
  const restarted = new AssociativeStore({ directory });
  assert.deepEqual(
    await restarted.get('collection-stop', 'browser-collection'),
    result
  );
  assert.ok(
    await restarted.get('collection-stop-review', result.operatorReviewId)
  );
});

test('HTTP operator review enforces the local origin and rejects retained browser checkpoints', async (t) => {
  const { app, store, review } = await fixture(t);
  const server = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (headers) =>
    fetch(`${origin}/api/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        operation: 'review-collection-stop',
        input: { review },
      }),
    });
  const crossOrigin = await post({ Origin: 'https://untrusted.example' });
  assert.equal(crossOrigin.status, 400);
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    review.expectedStop
  );
  const accepted = await post({ Origin: origin });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).active, false);
  review.expectedStop = {
    ...review.expectedStop,
    browser: {
      mode: 'persistent',
      headless: false,
      targetId: 'original-captcha',
    },
  };
  await store.put('collection-stop', review.expectedStop);
  const bound = await post({ Origin: origin });
  assert.equal(bound.status, 400);
  assert.match((await bound.json()).error, /retained original page/u);
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    review.expectedStop
  );
});

test('Telegram operator review is restricted to the allowed private user and accepts structured operations', async (t) => {
  const { app, store, review } = await fixture(t);
  const send = await telegram(t, app);
  const command = `/review_collection_stop ${JSON.stringify(review)}`;
  assert.equal(await send(command, 999), '');
  assert.equal(await send(command, 777, 'group'), '');
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    review.expectedStop
  );
  const accepted = JSON.parse(await send(command));
  assert.equal(accepted.active, false);
  assert.ok(
    await store.get('collection-stop-review', accepted.operatorReviewId)
  );
  review.expectedStop = {
    ...review.expectedStop,
    origin: 'https://other-factory.example',
  };
  await store.put('collection-stop', review.expectedStop);
  const structured = JSON.parse(
    await send(
      `/operation ${JSON.stringify({ operation: 'review-collection-stop', input: { review } })}`
    )
  );
  assert.equal(structured.active, false);
  assert.equal((await store.list('collection-stop-review')).length, 2);
  assert.equal(app.cache.stats.downloads, 0);
});
