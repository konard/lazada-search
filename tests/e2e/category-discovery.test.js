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
  BrowserCollector,
  DomainScheduler,
  EvidenceCache,
  LazadaSearch,
  createTelegramBot,
} from '../../src/index.js';

const execute = promisify(execFile);
const category = 'https://www.lazada.vn/protein/';
const items = [
  { id: 7201, title: 'Chocolate whey protein 100 g', price: 50000, grams: 100 },
  {
    id: 7202,
    title: 'Chocolate whey protein 10 kg',
    price: 2000000,
    grams: 10000,
  },
].map((item) => ({
  ...item,
  url: `https://www.lazada.vn/products/pdp-i${item.id}.html`,
}));

function listingHtml(page, sort) {
  const item = items[sort === 'pricedesc' ? 2 - page : page - 1];
  return `<h1>Protein category</h1><div data-product-card><a href="${item.url}" title="${item.title}">${item.title}</a><span data-card-price>${item.price.toLocaleString('vi-VN')} ₫</span></div><nav data-pagination><span aria-current="page">${page}</span><span data-page-number>2</span>${page === 1 ? '<a data-next-page href="/protein/?page=2">Next</a>' : '<button data-next-page aria-disabled="true">Next</button>'}</nav>`;
}

function productHtml(item) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.title,
    sku: String(item.id),
    offers: {
      price: String(item.price),
      priceCurrency: 'VND',
      availability: 'https://schema.org/InStock',
    },
  };
  return `<h1 data-product-title>${item.title}</h1><div data-product-price>${item.price.toLocaleString('vi-VN')} ₫</div><div data-description>Net weight: ${item.grams} g<br>Per 100 g<br>Protein 80 g<br>Sugar 3 g<br>Total Fat 2 g<br>Saturated Fat 1 g<br>Energy 380 kcal<br>Ingredients: whey protein isolate, cocoa</div><script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function assertSortedDiscovery(report, sort) {
  assert.equal(report.discoveryComplete, true);
  assert.equal(report.searchSort, sort);
  assert.deepEqual(report.queries, []);
  assert.equal(report.scopes.length, 1);
  assert.equal(report.scopes[0].type, 'category');
  assert.equal(report.scopes[0].visitedPages, 2);
  assert.equal(report.discovered, 2);
  for (const page of report.pages) {
    const url = new URL(page.url);
    assert.equal(url.pathname, '/protein/');
    assert.equal(url.searchParams.get('sort'), sort);
    assert.ok(
      [...url.searchParams.keys()].every((key) =>
        ['sort', 'page'].includes(key)
      )
    );
  }
}

async function installFixture(t, collector) {
  const requests = [];
  const replies = [];
  const fixture = createServer(async (request, response) => {
    if (request.method === 'POST') {
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
      return;
    }
    const url = new URL(request.url, 'http://fixture.local');
    requests.push(url);
    if (url.pathname === '/redirect-category/') {
      response.writeHead(302, {
        Location: 'https://www.lazada.vn/tag/kem-chocolate/',
      });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (url.pathname === '/protein/') {
      response.end(
        listingHtml(
          Number(url.searchParams.get('page') || 1),
          url.searchParams.get('sort')
        )
      );
    } else if (url.pathname === '/tag/kem-chocolate/') {
      response.end(listingHtml(2, 'priceasc'));
    } else {
      const item = items.find(
        (entry) => new URL(entry.url).pathname === url.pathname
      );
      response.end(
        item ? productHtml(item) : '<h1>Unexpected fixture route</h1>'
      );
    }
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => fixture.close(resolve)));
  const fixtureRoot = `http://127.0.0.1:${fixture.address().port}`;
  await collector.start();
  await collector.runtime.page.route(
    'https://www.lazada.vn/**',
    async (route) => {
      const url = new URL(route.request().url());
      // A manual redirect keeps even the redirect target inside the local fixture.
      const local = await fetch(`${fixtureRoot}${url.pathname}${url.search}`, {
        redirect: 'manual',
      });
      const location = local.headers.get('location');
      await route.fulfill({
        status: local.status,
        headers: {
          'Content-Type': local.headers.get('content-type') || 'text/html',
          ...(location ? { Location: location } : {}),
        },
        body: await local.text(),
      });
    }
  );
  return { requests, replies, fixtureRoot };
}

async function discoverCli(directory) {
  const cli = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'discover',
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
      '--category-only',
      '--query',
      'kem chocolate',
      '--category-url',
      category,
      '--search-sort',
      'priceasc',
      '--max-pages',
      '2',
    ],
    { maxBuffer: 4 * 1024 ** 2, timeout: 30000 }
  );
  return JSON.parse(cli.stdout);
}

test('real browser, offline CLI and Telegram retain price-sorted category pagination, every package size, and redirect protection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-category-e2e-'));
  const store = new AssociativeStore({ directory });
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const collector = new BrowserCollector({
    store,
    cache,
    settleMs: 0,
    browserOptions: { launch: 'engine', persistent: false },
  });
  const app = new LazadaSearch({ store, cache, collector, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const { requests, replies, fixtureRoot } = await installFixture(t, collector);
  const options = {
    categoryOnly: true,
    queries: ['kem chocolate'],
    categoryUrls: [category],
    searchSort: 'priceasc',
    maxPages: 2,
  };
  const collected = await app.crawl(options);
  assertSortedDiscovery(collected, 'priceasc');
  assert.equal(collected.products.length, 2);
  assert.deepEqual(
    (await store.list('offer'))
      .map((offer) => offer.price)
      .sort((a, b) => a - b),
    [50000, 2000000]
  );
  assert.deepEqual(
    (await store.list('product'))
      .map((product) => product.netMassG)
      .sort((a, b) => a - b),
    [100, 10000]
  );
  const ascendingRequests = requests.filter(
    (url) => url.pathname === '/protein/'
  );
  assert.equal(ascendingRequests.length, 2);
  assert.ok(
    ascendingRequests.every(
      (url) => url.searchParams.get('sort') === 'priceasc'
    )
  );
  assert.ok(requests.every((url) => !url.searchParams.has('q')));

  const descending = await app.crawl({
    ...options,
    searchSort: 'pricedesc',
    discoveryOnly: true,
  });
  assertSortedDiscovery(descending, 'pricedesc');
  const onlineRequests = requests.length;
  const cli = await discoverCli(directory);
  assertSortedDiscovery(cli, 'priceasc');
  assert.equal(
    requests.length,
    onlineRequests,
    'CLI discovery must reuse the complete sorted page cache'
  );
  const replay = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  replay.collector.start = () => {
    throw Error('Telegram replay must not open a browser');
  };
  t.after(() => replay.close());
  const bot = createTelegramBot({
    application: replay,
    token: '123:TEST',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: fixtureRoot, fetch },
  });
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: { id: 777, is_bot: false, first_name: 'Tester' },
      chat: { id: 777, type: 'private' },
      text: `/discover --category-only --query "kem chocolate" --category-url ${category} --search-sort pricedesc --max-pages 2`,
      entities: [{ offset: 0, length: 9, type: 'bot_command' }],
    },
  });
  assertSortedDiscovery(JSON.parse(replies.join('')), 'pricedesc');
  assert.equal(
    requests.length,
    onlineRequests,
    'Telegram discovery must reuse the sorted page cache'
  );
  assert.equal(replay.cache.stats.downloads, 0);

  const detailRequestsBeforeRedirect = requests.filter((url) =>
    url.pathname.includes('/products/')
  ).length;
  const redirected = await app.crawl({
    ...options,
    categoryUrls: ['https://www.lazada.vn/redirect-category/'],
  });
  assert.equal(redirected.discoveryComplete, false);
  assert.equal(redirected.failures.length, 1);
  assert.match(
    redirected.failures[0].error,
    /Category scope mismatch at \/tag\/kem-chocolate/u
  );
  assert.deepEqual(redirected.products, []);
  assert.equal(
    requests.filter((url) => url.pathname.includes('/products/')).length,
    detailRequestsBeforeRedirect
  );
  assert.ok(
    (await store.list('discovery')).every(
      (entry) => new URL(entry.sourceUrl).pathname === '/protein/'
    )
  );
  assert.ok(
    requests.every((url) =>
      [...url.searchParams.keys()].every(
        (key) => !/^(?:(?:min|max)[_-]?)?price(?:[_-]?range)?$/iu.test(key)
      )
    ),
    `No request may add a price cutoff: ${requests.map((url) => url.href).join(', ')}`
  );
});
