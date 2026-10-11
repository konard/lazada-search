import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import {
  AssociativeStore,
  LazadaSearch,
  startServer,
  createTelegramBot,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
  CachedTranslator,
  planCatalogTranslation,
} from '../../src/index.js';

const execute = promisify(execFile);

function telegramApi(replies) {
  return createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
    }
    const message = JSON.parse(text);
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
}

async function seedBasketEnglish(app) {
  const translations = new CachedTranslator({
    store: app.store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    provider: {
      id: 'basket-fixture',
      version: '1',
      translate: ({ originalText }) =>
        ({
          'Bột whey chocolate 1kg': 'Whey powder chocolate 1kg',
          'Cửa hàng': 'Store',
        })[originalText],
    },
  });
  const plan = await planCatalogTranslation(app);
  await app.store.putMany('translation-catalog-source', plan.items);
  for (const text of ['Bột whey chocolate 1kg', 'Cửa hàng']) {
    const translation = await translations.translate(text);
    await translations.review(translation.id, {
      sourceSha256: translation.sourceSha256,
      translatedSha256: translation.translatedSha256,
      reviewer: 'fixture-reviewer',
      decision: 'approved',
    });
  }
}

function assertEnglish(report) {
  const line = report.ranked[0].lines[0];
  assert.equal(line.product.title, 'Bột whey chocolate 1kg');
  assert.equal(
    line.product.presentation.title.text,
    'Whey powder chocolate 1kg'
  );
  assert.equal(line.product.presentation.title.status, 'reviewed');
  assert.equal(line.offer.presentation.seller.text, 'Store');
  assert.equal(report.ranked[0].quote.total, 285000);
}

test('library, CLI, HTTP and Telegram use the same source-bound basket quote and preserve original offer prices', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-basket-e2e-'));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    translationProviderId: 'basket-fixture',
    translationProviderVersion: '1',
  });
  const input = JSON.parse(
    await readFile(new URL('../fixtures/basket-mapping.json', import.meta.url))
  );
  const html = await readFile(
    new URL('../fixtures/basket-quote.html', import.meta.url)
  );
  await store.put('evidence', {
    id: input.evidenceId,
    sourceUrl: input.sourceUrl,
    observedAt: input.observedAt,
    html: await store.putBlob(html),
    role: 'checkout',
  });
  await store.put('product', {
    id: 'product-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    title: 'Bột whey chocolate 1kg',
    sku: '100_VNAMZ-11',
    category: 'whey',
    netMassG: 1000,
    proteinPer100g: 80,
  });
  await store.put('offer', {
    id: 'offer-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    productId: 'product-a',
    sku: '100_VNAMZ-11',
    price: 110000,
    currency: 'VND',
    available: true,
    variantConfirmed: true,
    observedAt: input.observedAt,
    seller: 'Cửa hàng',
  });
  await seedBasketEnglish(app);
  const server = await startServer({ application: app, port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const replies = [];
  const api = telegramApi(replies);
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => api.close(resolve));
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = { operation: 'save-basket-quote', input: { quote: input } };
  const response = await fetch(`${origin}/api/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 285000);
  const library = await app.compareBaskets({
    requireManufacturer: false,
    allowStale: true,
  });
  assert.equal(library.ranked[0].metrics.costPerGramAfterDelivery, 95);
  assertEnglish(library);
  const { stdout } = await execute(process.execPath, [
    'bin/lazada-search.js',
    'compare-baskets',
    '--data-dir',
    directory,
    '--no-archive',
    '--offline',
    '--no-ocr',
    '--no-require-manufacturer',
    '--allow-stale',
    '--translation-provider',
    'basket-fixture',
    '--translation-version',
    '1',
  ]);
  assertEnglish(JSON.parse(stdout));
  assert.equal(
    JSON.parse(stdout).ranked[0].metrics.costPerProteinGramAfterDelivery,
    118.75
  );
  const compared = await fetch(`${origin}/api/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'compare-baskets',
      options: { requireManufacturer: false, allowStale: true },
    }),
  });
  assert.equal(compared.status, 200);
  assertEnglish(await compared.json());
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
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false, first_name: 'Fixture' },
      text: `/operation ${JSON.stringify({ operation: 'compare-baskets', options: { requireManufacturer: false, allowStale: true } })}`,
      entities: [{ type: 'bot_command', offset: 0, length: 10 }],
    },
  });
  assert.equal(
    JSON.parse(replies.join('')).ranked[0].metrics.costPerGramAfterDelivery,
    95
  );
  assertEnglish(JSON.parse(replies.join('')));
  assert.equal((await store.get('offer', 'offer-a')).price, 110000);
  const before = (await store.list('basket-quote')).length;
  const invalid = await fetch(`${origin}/api/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation: 'save-basket-quote',
      input: {
        quote: { ...input, lines: [{ ...input.lines[0], quantity: 4 }] },
      },
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await store.list('basket-quote')).length, before);
  assert.equal(app.cache.stats.downloads, 0);
});

test('a real browser reads stable checkout totals without navigating or clicking and CAPTCHA stops the capture', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-checkout-browser-'));
  const shared = new AssociativeStore({ directory: join(directory, 'shared') });
  const store = new AssociativeStore({
    directory: join(directory, 'account'),
    fallback: shared,
    visibility: 'private',
  });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    settleMs: 0,
    browserOptions: { launch: 'engine' },
  });
  const app = new LazadaSearch({ store, collector, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const input = JSON.parse(
    await readFile(new URL('../fixtures/basket-mapping.json', import.meta.url))
  );
  const originalHtml = await readFile(
    new URL('../fixtures/basket-quote.html', import.meta.url),
    'utf8'
  );
  await store.put('offer', {
    id: 'offer-a',
    sku: '100_VNAMZ-11',
    currency: 'VND',
  });
  await collector.start();
  const page = collector.runtime.page;
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navigations++;
    }
  });
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: originalHtml.replace(
        '</body>',
        `<script>globalThis.clicks=0;document.addEventListener('click',()=>globalThis.clicks++);setTimeout(()=>{document.querySelector('#line-a .unit-price').textContent='110.000 ₫';document.querySelector('#line-a .subtotal').textContent='330.000 ₫';document.querySelector('#total').textContent='315.000 ₫';},1700);</script></body>`
      ),
    })
  );
  await collector.commander.goto({
    url: input.sourceUrl,
    waitUntil: 'domcontentloaded',
    waitForNetworkIdle: false,
  });
  const quote = await app.captureBasketQuote(input);
  assert.equal(quote.total, 315000);
  assert.equal(quote.lines[0].unitPrice, 110000);
  assert.equal(navigations, 1);
  assert.equal(await page.evaluate(() => globalThis.clicks), 0);
  assert.equal(quote.visibility, 'private');
  assert.equal(
    (await store.get('evidence', quote.evidenceId)).observedAt,
    quote.observedAt
  );
  const content = page.content.bind(page);
  page.content = async () => {
    const original = await content();
    await page.evaluate(() =>
      globalThis.history.replaceState(
        null,
        '',
        '/cart?changed-during-capture=true'
      )
    );
    return original;
  };
  await assert.rejects(
    () => app.captureBasketQuote(input),
    /Checkout URL changed/u
  );
  assert.equal((await store.list('basket-quote')).length, 1);
  page.content = content;
  await page.evaluate(() => globalThis.history.replaceState(null, '', '/cart'));
  const beforeChallengeNavigations = navigations;
  await page.evaluate(() => {
    const challenge = globalThis.document.createElement('div');
    challenge.className = 'nc-container';
    challenge.textContent = 'Security verification';
    globalThis.document.body.append(challenge);
  });
  await assert.rejects(() => app.captureBasketQuote(input), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
  assert.equal((await store.list('basket-quote')).length, 1);
  assert.equal(navigations, beforeChallengeNavigations);
});
