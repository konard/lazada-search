import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  LazadaSearch,
  RepositoryArchive,
  exportRepositoryArchive,
} from '../src/index.js';
import { atomicWrite } from '../src/util.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-archive-refresh-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    store: new AssociativeStore({ directory: join(directory, 'source') }),
    target: join(directory, 'archive'),
  };
}

test('a persistent private fallback observes re-exported records, previously unloaded shards, graphs and offline audit', async (t) => {
  const { directory, store, target } = await setup(t);
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/products.json', import.meta.url))
  );
  const product = fixture.products[0];
  const offer = fixture.offers[0];
  await store.put('product', product);
  await store.put('offer', offer);
  await store.put('manufacturer-review', { id: 'review', version: 1 });
  await store.put('crawl', {
    id: 'crawl:old',
    finishedAt: '2026-10-10T10:00:00Z',
    scopes: [{ query: 'whey', terminalConfirmed: false }],
  });
  await exportRepositoryArchive({ store, directory: target });
  const shared = new AssociativeStore({
    directory: join(directory, 'public'),
    archive: target,
  });
  const account = new AssociativeStore({
    directory: join(directory, 'account'),
    fallback: shared,
    visibility: 'private',
  });
  const app = new LazadaSearch({ store: account, offline: true, ocr: false });
  app.collector.start = () => {
    throw Error('Archive refresh must remain offline');
  };
  t.after(() => app.close());
  const before = await shared.archive.manifest();
  assert.equal((await app.audit()).unfinishedSearches.length, 1);
  assert.equal((await account.get('product', product.id)).title, product.title);
  await account.put('offer', { ...offer, price: 280000 });
  await store.put('product', { ...product, title: 'Corrected chocolate whey' });
  await store.put('manufacturer-review', { id: 'review', version: 2 });
  await store.put('crawl', {
    id: 'crawl:new',
    finishedAt: '2026-10-10T11:00:00Z',
    scopes: [{ query: 'whey', terminalConfirmed: true }],
  });
  await store.put('discovery', {
    id: 'new-discovery',
    url: 'https://www.lazada.vn/products/new-chocolate-whey-i9901.html',
    category: 'whey',
  });
  await exportRepositoryArchive({ store, directory: target });
  await assert.rejects(
    access(join(target, before.kinds.crawl.json.path)),
    /ENOENT/u
  );
  assert.equal((await account.get('manufacturer-review', 'review')).version, 2);
  assert.equal(
    (await account.get('product', product.id)).title,
    'Corrected chocolate whey'
  );
  assert.equal((await account.get('offer', offer.id)).price, 280000);
  assert.equal((await account.get('offer', offer.id)).visibility, 'private');
  assert.ok(
    (await account.graph('product', product.id)).names.has(
      'string:Corrected chocolate whey'
    )
  );
  const audit = await app.audit();
  assert.equal(audit.unfinishedSearches.length, 0);
  assert.ok(
    audit.missingListings.includes(
      'https://www.lazada.vn/products/new-chocolate-whey-i9901.html'
    )
  );
  assert.equal(audit.verifiedProducts, 1);
  assert.equal((await shared.archive.verify()).valid, true);
  assert.equal(app.cache.stats.downloads, 0);
});

for (const readBeforeReplacement of [false, true]) {
  test(`an active archive read ${readBeforeReplacement ? 'with cached old bytes' : 'whose old shard is deleted'} retries the new generation without poisoning its index`, async (t) => {
    const { store, target } = await setup(t);
    await store.put('product', { id: 'p1', version: 1 });
    await exportRepositoryArchive({ store, directory: target });
    const archive = new RepositoryArchive({ directory: target });
    const old = await archive.manifest();
    const file = archive.file.bind(archive);
    let markStarted, release;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    archive.file = async (entry) => {
      if (entry.path === old.kinds.product.json.path) {
        const bytes = readBeforeReplacement ? await file(entry) : undefined;
        markStarted();
        await gate;
        return bytes || file(entry);
      }
      return file(entry);
    };
    const pending = archive.get('product', 'p1');
    await started;
    await store.putMany('product', [
      { id: 'p0', version: 0 },
      { id: 'p1', version: 2 },
    ]);
    await exportRepositoryArchive({ store, directory: target });
    assert.deepEqual(await archive.get('product', 'p1'), {
      id: 'p1',
      version: 2,
    });
    release();
    assert.deepEqual(await pending, { id: 'p1', version: 2 });
    assert.deepEqual(await archive.list('product'), [
      { id: 'p0', version: 0 },
      { id: 'p1', version: 2 },
    ]);
    const graph = await archive.graph('product', 'p1');
    assert.ok(graph.names.has('record:product:p1'));
    assert.ok(graph.names.has('number:2'));
    assert.equal(graph.names.has('record:product:p0'), false);
  });
}

test('an old manifest response cannot populate a newly activated generation with stale record bytes', async (t) => {
  const { store, target } = await setup(t);
  await store.put('product', { id: 'p1', version: 1 });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const old = await archive.manifest();
  const bytes = await archive.file(old.kinds.product.json);
  const manifest = archive.manifest.bind(archive);
  const file = archive.file.bind(archive);
  let markStarted, release;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let delayed = false;
  archive.manifest = async () => {
    const metadata = await manifest();
    if (!delayed) {
      delayed = true;
      markStarted();
      await gate;
    }
    return metadata;
  };
  archive.file = (entry) =>
    entry.path === old.kinds.product.json.path ? bytes : file(entry);
  const pending = archive.get('product', 'p1');
  await started;
  await store.put('product', { id: 'p1', version: 2 });
  await exportRepositoryArchive({ store, directory: target });
  assert.notEqual(await archive.manifest(), old);
  release();
  assert.deepEqual(await pending, { id: 'p1', version: 2 });
  assert.deepEqual(await archive.get('product', 'p1'), {
    id: 'p1',
    version: 2,
  });
});

test('byte-identical manifest replacements retain cached record shards', async (t) => {
  const { store, target } = await setup(t);
  await store.put('product', { id: 'p1', title: 'Chocolate whey' });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const original = await archive.manifest();
  const file = archive.file.bind(archive);
  let sourceReads = 0;
  archive.file = async (entry) => {
    if (entry.path === original.kinds.product.json.path) {
      sourceReads += 1;
    }
    return file(entry);
  };
  await archive.list('product');
  const exported = await exportRepositoryArchive({ store, directory: target });
  assert.equal(exported.rebuilt, 0);
  assert.equal(await archive.manifest(), original);
  await archive.list('product');
  assert.equal(sourceReads, 1);
});

test('refresh never hides real shard corruption or an unsupported replacement manifest', async (t) => {
  const { store, target } = await setup(t);
  await store.put('product', { id: 'p1', version: 1 });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const manifest = await archive.manifest();
  await writeFile(join(target, manifest.kinds.product.json.path), 'corrupt');
  await assert.rejects(
    archive.get('product', 'p1'),
    /Corrupt repository archive file/u
  );
  await exportRepositoryArchive({ store, directory: target });
  assert.deepEqual(await archive.get('product', 'p1'), {
    id: 'p1',
    version: 1,
  });
  await atomicWrite(
    join(target, 'manifest.json'),
    JSON.stringify({ ...manifest, version: 999 })
  );
  await assert.rejects(
    archive.list('product'),
    /Unsupported repository archive version/u
  );
});
