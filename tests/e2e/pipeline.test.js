import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  EvidenceCache,
  DomainScheduler,
  BrowserCollector,
  LazadaSearch,
  TesseractOcr,
  createTelegramBot,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const listingUrl = 'https://www.lazada.vn/products/fixture-whey-i101.html';
const officialUrl = 'https://manufacturer.example/whey';
const structured = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Fixture Whey Isolate 1 kg',
  brand: { name: 'Fixture Nutrition' },
  gtin13: '0123456789012',
  sku: 'WHEY-1',
  mpn: 'WHEY-1',
  offers: {
    price: '300000',
    priceCurrency: 'VND',
    availability: 'https://schema.org/InStock',
  },
};
const label =
  '<div id="label" style="font:32px Arial;background:white;color:black;padding:30px;width:800px">Net weight: 1 kg<br>Per 100 g<br>Protein 80 g<br>Sugar 3 g<br>Total Fat 2 g<br>Saturated Fat 1 g<br>Energy 380 kcal<br>Ingredients: whey protein isolate, cocoa</div>';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const close = (server) => new Promise((resolve) => server.close(resolve));

// Real Chromium, real Tesseract, the library's real storage, spawned CLI,
// HTTP calculator and Grammy's real update dispatcher. External sites and
// Telegram delivery are replaced by deterministic local fixtures.
test('collect -> OCR -> verify -> quote -> restart -> CLI -> Telegram -> calculator', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-e2e-'));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 50,
    browserOptions: {
      launch: 'engine',
      ...(process.env.LAZADA_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.LAZADA_TEST_BROWSER_EXECUTABLE }
        : {}),
    },
  });
  const app = new LazadaSearch({
    manufacturerRegistry: [
      {
        name: 'Fixture Nutrition',
        aliases: ['Fixture Nutrition'],
        domains: ['manufacturer.example'],
        url: officialUrl,
      },
    ],
    store,
    cache,
    collector,
    ocr: new TesseractOcr({
      store,
      languages: process.env.LAZADA_TEST_OCR_LANGUAGES || 'eng',
      tessdataDir: process.env.LAZADA_TEST_TESSDATA_DIR || undefined,
    }),
    deliveryArea: 'Nha Trang',
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const page = collector.runtime.page;
  await page.setContent(label);
  const png = await page.locator('#label').screenshot();
  let imageRequests = 0;
  const replies = [];
  const fixture = createServer(async (request, response) => {
    if (request.url === '/label.png') {
      imageRequests += 1;
      response.writeHead(200, {
        'Content-Type': 'image/png',
        ETag: 'label-v1',
      });
      response.end(png);
      return;
    }
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
  const fixtureUrl = await listen(fixture);
  t.after(() => close(fixture));
  const navigations = [];
  await page.route('https://www.lazada.vn/**', async (route) => {
    const url = new URL(route.request().url());
    navigations.push(url.href);
    if (url.pathname.includes('/catalog/')) {
      await route.fulfill({
        contentType: 'text/html',
        body: `<h1>Whey search</h1><div data-product-card><a href="${listingUrl}">Fixture whey isolate 1 kg</a></div>`,
      });
    } else {
      await route.fulfill({
        contentType: 'text/html',
        body: `<h1 data-product-title>Fixture Whey Isolate 1 kg</h1><div data-product-price>300.000 ₫</div><div data-seller>Fixture store</div><script type="application/ld+json">${JSON.stringify({ ...structured, url: listingUrl })}</script><img data-product-image src="${fixtureUrl}/label.png">`,
      });
    }
  });
  await page.route(officialUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<h1>Fixture Whey Isolate 1 kg</h1><script type="application/ld+json">${JSON.stringify({ ...structured, url: officialUrl })}</script><div data-description>Net weight: 1 kg<br>Per 100 g<br>Protein 80 g<br>Sugar 3 g<br>Total Fat 2 g<br>Saturated Fat 1 g<br>Energy 380 kcal<br>Ingredients: whey protein isolate, cocoa</div>`,
    })
  );
  const crawl = await app.crawl({
    queries: ['whey protein'],
    maxPages: 2,
    maxProducts: 5,
  });
  assert.equal(crawl.products.length, 1);
  assert.equal(crawl.complete, false);
  const productId = crawl.products[0].id;
  let product = await store.get('product', productId);
  assert.ok(
    product.claims.some(
      (claim) =>
        claim.source === 'ocr' &&
        claim.field === 'proteinPer100g' &&
        claim.value === 80
    )
  );
  assert.ok(
    (await app.compare()).excluded[0].problems.includes(
      'proteinPer100g needs evidence review'
    )
  );
  const offer = (await store.list('offer'))[0];
  const check = await app.verify(productId, officialUrl);
  assert.equal(check.identityMatched, true);
  assert.equal(check.conflicts.length, 0);
  await app.quote(offer.id, {
    shipping: 30000,
    deliveryArea: 'Nha Trang',
    bulkTiers: [{ minQuantity: 10, unitPrice: 250000 }],
  });
  assert.equal(
    (await app.compare({ quantity: 10, deliveryArea: 'Nha Trang' })).ranked[0]
      .metrics.totalCost,
    2530000
  );
  const before = navigations.length;
  const beforeImages = imageRequests;
  const cached = await app.collect(listingUrl);
  assert.equal(cached.cacheHit, true);
  assert.equal(navigations.length, before);
  assert.equal(imageRequests, beforeImages);
  // Recollecting the same snapshot must retain a quote; a refreshed snapshot
  // must expire it. This catches destructive cache-hit refresh behavior.
  await app.quote(offer.id, {
    shipping: 30000,
    deliveryArea: 'Nha Trang',
    bulkTiers: [{ minQuantity: 10, unitPrice: 250000 }],
  });
  const restarted = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    ocr: false,
    offline: true,
  });
  assert.equal(
    (await restarted.compare({ quantity: 10 })).ranked[0].metrics.totalCost,
    2530000
  );
  const cli = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'compare',
      '--data-dir',
      directory,
      '--offline',
      '--quantity',
      '10',
      '--category',
      'whey',
    ],
    { cwd: new URL('../../', import.meta.url).pathname }
  );
  assert.equal(JSON.parse(cli.stdout).ranked[0].metrics.totalProteinG, 8000);
  const bot = createTelegramBot({
    application: restarted,
    token: '123:FIXTURE',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: fixtureUrl, fetch },
  });
  const update = (text, userId = 777, id = 1) => ({
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      from: { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId, type: 'private' },
      text,
      entities: [
        { offset: 0, length: text.split(' ')[0].length, type: 'bot_command' },
      ],
    },
  });
  try {
    await bot.handleUpdate(update('/compare --category whey --quantity 10'));
  } catch (error) {
    throw new Error(
      `Telegram fixture: ${error.error?.error?.message || error.error?.message || error.message}`,
      { cause: error }
    );
  }
  assert.ok(replies.at(-1).includes('25 g protein: 7812.50 / 7906.25'));
  assert.ok(replies.at(-1).includes('Food g: 250.00 / 253.00'));
  const replyCount = replies.length;
  await bot.handleUpdate(update('/compare', 999, 2));
  assert.equal(replies.length, replyCount);
  const server = await startServer({ application: restarted, port: 0 });
  t.after(() => close(server));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() =>
    globalThis.document
      .querySelector('#status')
      .textContent.includes('eligible offers')
  );
  assert.equal(await page.locator('#offers tr').count(), 1);
  await page.locator('[name="quantity"]').fill('10');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() =>
    globalThis.document
      .querySelector('#offers')
      .textContent.includes('2,530,000')
  );
  assert.ok((await page.locator('#offers').innerText()).includes('7,906.25'));
  // A missing delivery quote still needs a visible, recalculating scenario.
  // Keep it excluded while showing the known merchandise/protein arithmetic.
  const unquoted = { ...(await store.get('offer', offer.id)) };
  delete unquoted.shipping;
  delete unquoted.deliveryArea;
  await store.put('offer', unquoted);
  await page.reload();
  await page.waitForSelector('#excluded li');
  await page.locator('[name="quantity"]').fill('10');
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() =>
    globalThis.document
      .querySelector('#excluded')
      .textContent.includes('Calculation for 10 packages')
  );
  const scenario = await page.locator('#excluded').innerText();
  assert.ok(scenario.includes('2,500,000 VND before shipping'));
  assert.ok(scenario.includes('7,812.5 VND per 25 g protein'));
  assert.equal(await page.locator('#offers tr').count(), 1);
  assert.equal(
    (
      await fetch(
        `http://127.0.0.1:${server.address().port}/api/compare?quantity=-1`
      )
    ).status,
    400
  );
  product = await store.get('product', productId);
  assert.ok(product.evidenceIds.length >= 3);
  assert.ok((await store.graph('product', productId)).links.length > 20);
});
