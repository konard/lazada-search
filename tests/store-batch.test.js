import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AssociativeStore, LazadaSearch } from '../src/index.js';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-store-batch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory: join(directory, 'store') });
}

test('a batch validates every kind, ID and serializable record before taking a writer lock or mutating files', async (t) => {
  const store = await temporary(t);
  let locks = 0;
  const lock = store.locked.bind(store);
  store.locked = (action) => {
    locks += 1;
    return lock(action);
  };
  for (const invalid of [null, {}, { id: '' }, { id: 1 }]) {
    await assert.rejects(
      store.putMany('discovery', [{ id: 'would-write' }, invalid]),
      /nonempty string id/u
    );
  }
  const circular = { id: 'circular' };
  circular.self = circular;
  await assert.rejects(
    store.putMany('discovery', [{ id: 'would-write' }, circular]),
    /circular/iu
  );
  for (const kind of [null, '', '../discovery']) {
    await assert.rejects(store.putMany(kind, []), /Invalid record kind/u);
  }
  await assert.rejects(store.putMany('discovery', {}), /require an array/u);
  assert.equal(locks, 0);
  await assert.rejects(access(store.directory), /ENOENT/u);
  assert.deepEqual(await store.putMany('discovery', []), []);
  assert.equal(locks, 0);
});

test('one batch writer lock bounds parallel independent paths and commits canonical text before projections', async (t) => {
  const store = await temporary(t);
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: `record-${index}`,
    title: 'Sô cô la',
    details: {
      position: index,
      sources: ['manufacturer', 'Lazada'],
      missing: null,
    },
  }));
  const original = globalThis.structuredClone(records);
  const project = store.project.bind(store);
  const lock = store.locked.bind(store);
  let locks = 0,
    active = 0,
    peak = 0;
  store.locked = (action) => {
    locks += 1;
    return lock(action);
  };
  store.project = async (kind, record, notation, path) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      assert.equal(await readFile(path, 'utf8'), notation);
      await access(join(store.directory, '.write-lock', 'owner'));
      await delay(10);
      return await project(kind, record, notation, path);
    } finally {
      active -= 1;
    }
  };
  assert.deepEqual(await store.putMany('discovery', records), original);
  assert.equal(locks, 1);
  assert.ok(peak > 1 && peak <= 8, `parallel projection peak was ${peak}`);
  assert.equal(active, 0);
  assert.deepEqual(records, original);
  assert.equal((await store.list('discovery')).length, records.length);
  const graph = await store.graph('discovery', records[0].id);
  assert.ok(graph.names.has('string:Sô cô la'));
  assert.ok(graph.names.has('field:/details/sources/1'));
});

test('duplicate batch IDs write sequentially, preserve result order and leave the final binary consistent', async (t) => {
  const store = await temporary(t);
  const records = [
    { id: 'same', version: 1 },
    { id: 'independent', version: 10 },
    { id: 'same', version: 2 },
    { id: 'same', version: 3 },
  ];
  const project = store.project.bind(store);
  const activeIds = new Set();
  const versions = [];
  store.project = async (kind, record, notation, path) => {
    assert.equal(
      activeIds.has(record.id),
      false,
      'a path must have only one active writer'
    );
    activeIds.add(record.id);
    try {
      if (record.id === 'same') {
        versions.push(record.version);
      }
      await delay(5);
      return await project(kind, record, notation, path);
    } finally {
      activeIds.delete(record.id);
    }
  };
  assert.deepEqual(await store.putMany('discovery', records), records);
  assert.deepEqual(versions, [1, 2, 3]);
  assert.deepEqual(await store.get('discovery', 'same'), records.at(-1));
  const graph = await store.graph('discovery', 'same');
  assert.ok(graph.names.has('number:3'));
  assert.equal(graph.names.has('number:1'), false);
});

test('an identical batch reuses canonical files and binary projections without changing their timestamps', async (t) => {
  const store = await temporary(t);
  const records = [
    { id: 'a', title: 'Chocolate' },
    { id: 'b', title: 'Unflavoured' },
  ];
  await store.putMany('discovery', records);
  const paths = records.flatMap(({ id }) => {
    const path = store.recordPath('discovery', id);
    return [path, path.replace(/\.lino$/u, '.links'), `${path}.sha256`];
  });
  const before = await Promise.all(
    paths.map(async (path) => ({
      bytes: await readFile(path),
      mtime: (await stat(path)).mtimeMs,
    }))
  );
  store.project = () => {
    throw Error('Unchanged records must reuse their binary projections');
  };
  await store.putMany('discovery', records);
  for (const [index, path] of paths.entries()) {
    assert.deepEqual(await readFile(path), before[index].bytes);
    assert.equal((await stat(path)).mtimeMs, before[index].mtime);
  }
});

test('projection failure preserves canonical records and holds the writer lock until every active write drains', async (t) => {
  const store = await temporary(t);
  const project = store.project.bind(store);
  let markSlowStarted, releaseSlow;
  const slowStarted = new Promise((resolve) => {
    markSlowStarted = resolve;
  });
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  store.project = async (kind, record, notation, path) => {
    assert.equal(await readFile(path, 'utf8'), notation);
    if (record.id === 'fail') {
      await slowStarted;
      throw Error('Simulated binary failure');
    }
    markSlowStarted();
    await slowGate;
    return project(kind, record, notation, path);
  };
  const writing = store.putMany('discovery', [
    { id: 'fail', value: 'canonical' },
    { id: 'slow', value: 'complete' },
  ]);
  let settled = false;
  writing.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await slowStarted;
  let observerAcquired = false;
  const observer = store.locked(async () => {
    observerAcquired = true;
  });
  await delay(20);
  assert.equal(settled, false);
  assert.equal(observerAcquired, false);
  await access(join(store.directory, '.write-lock', 'owner'));
  releaseSlow();
  await assert.rejects(writing, /Simulated binary failure/u);
  await observer;
  assert.equal(observerAcquired, true);
  store.project = project;
  assert.deepEqual(await store.get('discovery', 'fail'), {
    id: 'fail',
    value: 'canonical',
  });
  assert.ok(
    (await store.graph('discovery', 'fail')).names.has('string:canonical')
  );
  assert.ok(
    (await store.graph('discovery', 'slow')).names.has('string:complete')
  );
});

test('private batches reuse shared records without shadowing them and retain private overrides across duplicate IDs', async (t) => {
  const shared = await temporary(t);
  const originals = [
    { id: 'shared-only', price: 100 },
    { id: 'overridden', price: 200 },
  ];
  await shared.putMany('discovery', originals);
  const privateStore = new AssociativeStore({
    directory: join(shared.directory, '..', 'account'),
    fallback: shared,
    visibility: 'private',
  });
  const inputs = [
    originals[0],
    { id: 'overridden', price: 150 },
    { id: 'new', price: 50 },
  ];
  const results = await privateStore.putMany('discovery', inputs);
  assert.deepEqual(results[0], originals[0]);
  assert.equal(results[1].visibility, 'private');
  assert.equal(results[2].visibility, 'private');
  assert.ok(inputs.every((record) => record.visibility === undefined));
  await assert.rejects(
    access(privateStore.recordPath('discovery', originals[0].id)),
    /ENOENT/u
  );
  await privateStore.putMany('discovery', [
    { id: 'overridden', price: 125 },
    originals[1],
  ]);
  assert.deepEqual(await privateStore.get('discovery', 'overridden'), {
    ...originals[1],
    visibility: 'private',
  });
  assert.deepEqual(
    await shared.list('discovery'),
    [...originals].sort((left, right) => left.id.localeCompare(right.id))
  );
  assert.equal((await privateStore.list('discovery')).length, 3);
});

function customStore(batch) {
  const calls = [];
  const records = new Map();
  const store = {
    directory: '/unused-fixture-directory',
    list: async (kind) => [...(records.get(kind)?.values() || [])],
    put: async (kind, record) => {
      calls.push({ method: 'put', kind, ids: [record.id] });
      records.set(
        kind,
        (records.get(kind) || new Map()).set(record.id, record)
      );
      return record;
    },
  };
  if (batch) {
    store.putMany = async (kind, inputs) => {
      calls.push({
        method: 'putMany',
        kind,
        ids: inputs.map((record) => record.id),
      });
      for (const record of inputs) {
        records.set(
          kind,
          (records.get(kind) || new Map()).set(record.id, record)
        );
      }
      return inputs;
    };
  }
  return { store, calls };
}

for (const batch of [true, false]) {
  test(`application metadata import supports a custom store ${batch ? 'with' : 'without'} batching while preserving offer history`, async () => {
    const { store, calls } = customStore(batch);
    const fixture = JSON.parse(
      await readFile(new URL('./fixtures/products.json', import.meta.url))
    );
    const app = new LazadaSearch({
      store,
      collector: {},
      ocr: false,
      offline: true,
    });
    const metadata = {
      discoveries: [{ id: 'd1' }, { id: 'd2' }],
      skuInventories: [{ id: 's1' }],
      crawls: [{ id: 'c1' }],
    };
    await app.importRecords({
      products: [fixture.products[0]],
      offers: [fixture.offers[0]],
      ...metadata,
    });
    assert.deepEqual(
      calls.slice(0, 3).map((call) => `${call.method}:${call.kind}`),
      ['put:product', 'put:offer-history', 'put:offer']
    );
    assert.deepEqual(
      calls.slice(3).map((call) => [call.method, call.kind, call.ids]),
      batch
        ? [
            ['putMany', 'discovery', ['d1', 'd2']],
            ['putMany', 'sku-inventory', ['s1']],
            ['putMany', 'crawl', ['c1']],
          ]
        : [
            ['put', 'discovery', ['d1']],
            ['put', 'discovery', ['d2']],
            ['put', 'sku-inventory', ['s1']],
            ['put', 'crawl', ['c1']],
          ]
    );
    assert.equal((await store.list('offer-history')).length, 1);
    assert.equal(app.cache.stats.downloads, 0);
    await app.close();
  });
}

test('invalid metadata IDs reject an entire application import before even its valid products are written', async () => {
  const { store, calls } = customStore(true);
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/products.json', import.meta.url))
  );
  const app = new LazadaSearch({
    store,
    collector: {},
    ocr: false,
    offline: true,
  });
  await assert.rejects(
    app.importRecords({
      products: [fixture.products[0]],
      discoveries: [{ id: 'valid' }, { id: '' }],
    }),
    /Imported discovery records require string IDs/u
  );
  assert.deepEqual(calls, []);
  await app.close();
});
