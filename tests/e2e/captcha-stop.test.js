import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
  LazadaSearch,
  createTelegramBot,
  startServer,
  phoneLoginState,
  COLLECTION_STOP_ID,
} from '../../src/index.js';

const execute = promisify(execFile);
const firstUrl = 'https://www.lazada.vn/products/fixture-i101.html';
const nextUrl = 'https://www.lazada.vn/products/fixture-i102.html';

async function application(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-captcha-stop-'));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 0,
    maxScrolls: 0,
    browserOptions: { launch: 'engine' },
  });
  const app = new LazadaSearch({ store, cache, collector, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const navigations = [];
  await collector.runtime.page.route('https://**.lazada.vn/**', (route) => {
    if (route.request().frame() !== collector.runtime.page.mainFrame()) {
      return route.fulfill({
        body: '<p>Challenge frame</p>',
        contentType: 'text/html',
      });
    }
    navigations.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: '<div id="myAccountTrigger">TÀI KHOẢN Fixture</div><h1>Fixture whey 1kg</h1><div data-product-price>200.000 ₫</div><iframe style="width:300px;height:200px" src="https://sec.lazada.vn/nocaptcha/index"></iframe>',
    });
  });
  return { app, collector, store, directory, navigations };
}

async function telegram(t, app) {
  const messages = [];
  const api = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const message = JSON.parse(body);
    messages.push(message.text);
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
  const send = (text) =>
    bot.handleUpdate({
      update_id: messages.length + 1,
      message: {
        message_id: messages.length + 1,
        date: 0,
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        chat: { id: 777, type: 'private' },
        text,
        entities: [
          { offset: 0, length: text.split(' ')[0].length, type: 'bot_command' },
        ],
      },
    });
  return { messages, send };
}

test('CAPTCHA persists a hard stop across library, CLI, HTTP, Telegram and collector restarts', async (t) => {
  const { app, collector, store, directory, navigations } =
    await application(t);
  await assert.rejects(app.collect(firstUrl), { code: 'COLLECTION_STOPPED' });
  assert.deepEqual(navigations, [firstUrl]);
  assert.equal(
    (await phoneLoginState(collector.runtime.page)).status,
    'challenge'
  );
  const state = await store.get('collection-stop', COLLECTION_STOP_ID);
  assert.equal(state.active, true);
  assert.deepEqual(state.signals, ['visible-challenge-widget']);
  await assert.rejects(collector.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  await assert.rejects(app.collect(nextUrl), { code: 'COLLECTION_STOPPED' });
  await assert.rejects(
    app.delivery(nextUrl, { province: 'Khánh Hòa', locality: 'Nha Trang' }),
    { code: 'COLLECTION_STOPPED' }
  );
  let imageRequests = 0;
  await assert.rejects(
    app.cache.image('https://cdn.example/uncached-label.png', {
      fetchImage: () => {
        imageRequests++;
        throw Error('No image request may start after CAPTCHA');
      },
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  assert.equal(imageRequests, 0);
  const status = await execute(process.execPath, [
    'bin/lazada-search.js',
    'collection-status',
    '--data-dir',
    directory,
    '--no-archive',
    '--no-ocr',
  ]);
  assert.equal(JSON.parse(status.stdout).active, true);
  await assert.rejects(
    execute(process.execPath, [
      'bin/lazada-search.js',
      'collect',
      nextUrl,
      '--data-dir',
      directory,
      '--no-archive',
      '--no-ocr',
      '--interval-ms',
      '0',
    ]),
    (error) => /CAPTCHA/u.test(error.stderr)
  );
  const bot = await telegram(t, app);
  await bot.send(`/collect ${nextUrl}`);
  await bot.send('/collection_status');
  assert.match(bot.messages[0], /Collection stopped: CAPTCHA/u);
  assert.equal(JSON.parse(bot.messages[1]).active, true);
  const api = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const apiRoot = `http://127.0.0.1:${api.address().port}`;
  const httpStatus = await fetch(`${apiRoot}/api/collection-status`);
  assert.equal(httpStatus.status, 200);
  assert.equal((await httpStatus.json()).active, true);
  const cachedReport = await fetch(`${apiRoot}/api/compare`);
  assert.equal(cachedReport.status, 200);
  assert.deepEqual((await cachedReport.json()).comparisons, []);
  assert.deepEqual(navigations, [firstUrl]);
  await collector.close();
  const replacement = new BrowserCollector({ store, cache: app.cache });
  replacement.start = () => {
    throw new Error('Restart must not launch a browser while stopped');
  };
  await assert.rejects(replacement.capture(nextUrl), {
    code: 'COLLECTION_STOPPED',
  });
});

test('a challenge appearing during loading stops before SKU selection or scrolling', async (t) => {
  const { app, collector, navigations } = await application(t);
  await collector.runtime.page.unroute('https://**.lazada.vn/**');
  await collector.runtime.page.route('https://**.lazada.vn/**', (route) => {
    navigations.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: '<h1>Fixture whey</h1><div data-product-price>200.000 ₫</div><div data-loading="true">Loading</div><script>setTimeout(()=>{const node=document.createElement("div");node.setAttribute("data-security-challenge","");node.textContent="Trượt để xác minh";document.body.append(node);},100);</script>',
    });
  });
  await assert.rejects(app.collect(firstUrl), { code: 'COLLECTION_STOPPED' });
  assert.deepEqual(navigations, [firstUrl]);
  const active = await app.store.get('collection-stop', COLLECTION_STOP_ID);
  assert.equal(active.active, true);
  // Simulate the person clearing the fixture; never solve a real challenge.
  await collector.runtime.page.evaluate(() => {
    globalThis.document.querySelector('[data-security-challenge]').remove();
    globalThis.document.querySelector('[data-loading]').remove();
  });
  assert.equal((await collector.resumeCollection()).active, false);
});

test('a late browser challenge stops an image or manufacturer download before its loader starts', async (t) => {
  const { app, collector, store } = await application(t);
  await collector.runtime.page.unroute('https://**.lazada.vn/**');
  await collector.runtime.page.route('https://**.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Fixture whey chocolate 1kg</h1><div data-product-price>200.000 ₫</div>',
    })
  );
  await app.collect(firstUrl);
  await collector.runtime.page.evaluate(() => {
    const challenge = globalThis.document.createElement('div');
    challenge.dataset.securityChallenge = '';
    challenge.textContent = 'Trượt để xác minh';
    globalThis.document.body.append(challenge);
  });
  let requests = 0;
  await assert.rejects(
    app.cache.get('https://manufacturer.example/new-label', {
      namespace: 'manufacturer',
      load: () => {
        requests++;
        throw Error('No loader may start during CAPTCHA');
      },
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  assert.equal(requests, 0);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('a clear marketplace page cannot resume a different manufacturer origin challenge', async (t) => {
  const { collector, store, navigations } = await application(t);
  const page = collector.runtime.page;
  await page.unroute('https://**.lazada.vn/**');
  await page.route('https://**.lazada.vn/**', (route) => {
    navigations.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body: '<h1>Clear marketplace fixture</h1>',
    });
  });
  await page.goto(firstUrl);
  await store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    reason: 'challenge',
    origin: 'https://manufacturer.example',
    signals: ['visible-cloudflare-interstitial'],
  });
  await assert.rejects(collector.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.deepEqual(navigations, [firstUrl]);
  // Emulate the person visiting the challenged origin after clearing it.
  await page.route('https://manufacturer.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Cleared fixture</h1>',
    })
  );
  await page.goto('https://manufacturer.example/product');
  assert.equal((await collector.resumeCollection()).active, false);
});
