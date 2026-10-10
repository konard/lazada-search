import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  EvidenceCache,
  DomainScheduler,
  BrowserCollector,
  LazadaSearch,
  exportRepositoryArchive,
  RepositoryArchive,
  vietnamPhoneNumber,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const url = 'https://www.lazada.vn/products/fixture-whey-i101-s202.html';
const namespace = 'lazada:vn:Nha Trang';
const snapshot = {
  url,
  title: 'Fixture whey isolate 1 kg',
  sku: '202',
  priceText: '300.000 ₫',
  rawText: 'Net weight: 1 kg. Ingredients: whey protein isolate.',
  brand: 'Fixture',
  seller: 'Fixture store',
};

async function stores(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const privateStore = new AssociativeStore({
    directory: join(shared.directory, 'accounts', 'default'),
    fallback: shared,
    visibility: 'private',
  });
  return { directory, shared, privateStore };
}

async function capture(shared, { status = 'ok', page = snapshot } = {}) {
  return shared.put('cache', {
    id: `${namespace}:${url}`,
    url,
    snapshot: page,
    status,
    fetchedAt: 1000,
    checkedAt: 1000,
    repositoryReusable: true,
  });
}

function collector(store, load) {
  const cache = new EvidenceCache({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const browser = new BrowserCollector({ store, cache });
  browser.captureWithBudget = load;
  return browser;
}

test('private stores reuse public records, image bytes and binary links without copying them', async (t) => {
  const { shared, privateStore } = await stores(t);
  const product = {
    id: 'verified',
    proteinPer100g: 80,
    corrections: ['manufacturer review'],
  };
  await shared.put('product', product);
  const blob = await shared.putBlob('public nutrition image');
  assert.deepEqual(await privateStore.get('product', product.id), product);
  assert.deepEqual(await privateStore.put('product', product), product);
  assert.deepEqual(await privateStore.putBlob('public nutrition image'), blob);
  await assert.rejects(
    access(privateStore.recordPath('product', product.id)),
    /ENOENT/
  );
  await assert.rejects(access(join(privateStore.directory, 'blobs')), /ENOENT/);
  assert.deepEqual(
    (await privateStore.graph('product', product.id)).links,
    (await shared.graph('product', product.id)).links
  );
  assert.equal(
    (await privateStore.blob(blob.sha256)).toString(),
    'public nutrition image'
  );
});

test('private overrides survive restart, merge once and cannot enter public archives or other accounts', async (t) => {
  const { directory, shared, privateStore } = await stores(t);
  await shared.put('offer', { id: 'same-SKU', price: 300000 });
  await privateStore.put('offer', {
    id: 'same-SKU',
    price: 290000,
    shipping: 40000,
  });
  const another = new AssociativeStore({
    directory: join(directory, 'another'),
    fallback: shared,
    visibility: 'private',
  });
  const restarted = new AssociativeStore({
    directory: privateStore.directory,
    fallback: shared,
    visibility: 'private',
  });
  assert.deepEqual(await restarted.list('offer'), [
    { id: 'same-SKU', price: 290000, shipping: 40000, visibility: 'private' },
  ]);
  assert.equal((await another.get('offer', 'same-SKU')).price, 300000);
  assert.equal((await shared.get('offer', 'same-SKU')).price, 300000);
  assert.equal(
    (await restarted.exportGraph()).names.has('record:offer:same-SKU'),
    true
  );
  await assert.rejects(
    exportRepositoryArchive({
      store: restarted,
      directory: join(directory, 'private-export'),
    }),
    /Account evidence is private/
  );
  const target = join(directory, 'public-export');
  await exportRepositoryArchive({ store: shared, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  assert.equal((await archive.get('offer', 'same-SKU')).shipping, undefined);
  assert.equal((await archive.manifest()).kinds.accounts, undefined);
});

test('account collections reuse a correctly priced public SKU with zero navigations', async (t) => {
  const { shared, privateStore } = await stores(t);
  await capture(shared);
  const browser = collector(privateStore, () => {
    throw new Error('Unnecessary download');
  });
  const app = new LazadaSearch({
    store: privateStore,
    collector: browser,
    ocr: false,
  });
  const result = await app.collect(url);
  assert.equal(result.offer.price, 300000);
  assert.equal(browser.cache.stats.downloads, 0);
  assert.equal(browser.runtime, undefined);
});

test('a private default-flavour capture is replaced once with the requested SKU price', async (t) => {
  const { privateStore } = await stores(t);
  await capture(privateStore, { page: { ...snapshot, sku: '201' } });
  let navigations = 0;
  const browser = collector(privateStore, async () => {
    navigations++;
    return { status: 'ok', snapshot };
  });
  const app = new LazadaSearch({
    store: privateStore,
    collector: browser,
    ocr: false,
  });
  assert.equal((await app.collect(url)).offer.variantConfirmed, true);
  assert.equal((await app.collect(url)).offer.sku, '202');
  assert.equal(navigations, 1);
});

for (const status of ['login', 'challenge', 'ok']) {
  test(`account collection fills a public ${status === 'ok' ? 'missing price' : status} once and retains the public source`, async (t) => {
    const { shared, privateStore } = await stores(t);
    const page = { ...snapshot };
    delete page.priceText;
    await capture(shared, { status, page });
    let navigations = 0;
    const browser = collector(privateStore, async () => {
      navigations++;
      return { status: 'ok', snapshot };
    });
    const app = new LazadaSearch({
      store: privateStore,
      collector: browser,
      ocr: false,
    });
    assert.equal((await app.collect(url)).offer.price, 300000);
    assert.equal((await app.collect(url)).offer.price, 300000);
    assert.equal(navigations, 1);
    assert.equal(
      (await shared.get('cache', `${namespace}:${url}`)).status,
      status
    );
    assert.equal(
      (await privateStore.get('cache', `${namespace}:${url}`)).visibility,
      'private'
    );
  });
}

test('private failures stay cached; explicit invalidation refreshes only the account source and conversions', async (t) => {
  const { shared, privateStore } = await stores(t);
  await capture(shared, { status: 'login' });
  let navigations = 0;
  const browser = collector(privateStore, async () => {
    navigations++;
    return { status: navigations === 1 ? 'challenge' : 'ok', snapshot };
  });
  assert.equal((await browser.page(url, { namespace })).status, 'challenge');
  assert.equal((await browser.page(url, { namespace })).cacheHit, true);
  await browser.cache.invalidate(url, {
    namespace,
    reason: 'Signed in successfully',
  });
  assert.equal((await browser.page(url, { namespace })).status, 'ok');
  assert.equal(navigations, 2);
  const record = await privateStore.get('cache', `${namespace}:${url}`);
  assert.equal(record.invalidatedAt, undefined);
  assert.match(
    (await privateStore.graph('cache', record.id)).toNotation(),
    /ok/
  );
  assert.equal((await shared.get('cache', record.id)).status, 'login');
});

test('CLI account paths are isolated and login selects its private default', async (t) => {
  const { directory } = await stores(t);
  const options = parseArguments([
    'collect',
    url,
    '--account',
    'fixture',
    '--data-dir',
    directory,
    '--no-archive',
  ]);
  const account = configuredStore(options);
  assert.equal(account.visibility, 'private');
  assert.equal(account.directory, join(directory, 'accounts', 'fixture'));
  assert.equal(account.fallback.directory, directory);
  assert.equal(
    configuredStore({ dataDir: directory, archive: false, _: ['login'] })
      .visibility,
    'private'
  );
  assert.throws(
    () => configuredStore({ dataDir: directory, account: '../escape' }),
    /Account name/
  );
});

test('phone normalization accepts Vietnam mobile formats and rejects incomplete numbers', () => {
  assert.equal(new DomainScheduler().intervalMs, 60000);
  assert.equal(vietnamPhoneNumber('+84 90 1234567'), '0901234567');
  assert.equal(vietnamPhoneNumber('0901234567'), '0901234567');
  assert.throws(() => vietnamPhoneNumber('123'), /valid Vietnamese/);
});
