import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { encode } from 'lino-objects-codec';
import { AssociativeStore } from '../src/store.js';

async function temporary(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-store-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory, ...options });
}

test('catalog lists bound actual canonical reads to eight and retain sorted filtered records', async (t) => {
  const store = await temporary(t);
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: `item-${String(index).padStart(2, '0')}`,
    category: index % 2 ? 'whey' : 'chocolate-ice-cream',
    title: 'Sô cô la',
  })).reverse();
  await store.putMany('product', records);
  const read = store.readRecordFile.bind(store);
  let active = 0;
  let peak = 0;
  let count = 0;
  store.readRecordFile = async (kind, file) => {
    active += 1;
    peak = Math.max(peak, active);
    count += 1;
    try {
      await delay(5);
      return await read(kind, file);
    } finally {
      active -= 1;
    }
  };
  store.locked = () => {
    throw new Error('Listing canonical records must not take a writer lock');
  };
  assert.deepEqual(
    await store.list('product', { path: 'category', value: 'whey' }),
    records.filter((record) => record.category === 'whey').reverse()
  );
  assert.equal(peak, 8);
  assert.equal(active, 0);
  assert.equal(count, records.length);
});

test('local rows override fallback and duplicate local IDs follow filename order despite reversed completion', async (t) => {
  const fallback = [
    { id: 'duplicate', source: 'fallback' },
    { id: 'only-fallback', source: 'fallback' },
  ];
  const store = await temporary(t, {
    archive: {
      list: async (kind) => {
        assert.equal(kind, 'product');
        return fallback;
      },
    },
  });
  await mkdir(join(store.directory, 'product'));
  await writeFile(
    join(store.directory, 'product', 'a.lino'),
    encode({ obj: { id: 'duplicate', source: 'local-first' } })
  );
  await writeFile(
    join(store.directory, 'product', 'z.lino'),
    encode({ obj: { id: 'duplicate', source: 'local-last' } })
  );
  const read = store.readRecordFile.bind(store);
  let release;
  const firstGate = new Promise((resolve) => {
    release = resolve;
  });
  const completed = [];
  store.readRecordFile = async (kind, file) => {
    if (file === 'a.lino') {
      await firstGate;
    }
    const row = await read(kind, file);
    completed.push(file);
    if (file === 'z.lino') {
      release();
    }
    return row;
  };
  assert.deepEqual(await store.list('product'), [
    { id: 'duplicate', source: 'local-last' },
    { id: 'only-fallback', source: 'fallback' },
  ]);
  assert.deepEqual(completed, ['z.lino', 'a.lino']);
  assert.equal(fallback[0].source, 'fallback');
});

test('failed list reads drain already active operations and never return a partial catalog', async (t) => {
  const store = await temporary(t);
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: `row-${index}`,
  }));
  await store.putMany('product', records);
  const read = store.readRecordFile.bind(store);
  const sorted = records
    .map((record) => basename(store.recordPath('product', record.id)))
    .sort();
  const failure = new Error('Unusable canonical record');
  let release;
  let markStarted;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  let active = 0;
  let issued = 0;
  let settled = false;
  store.readRecordFile = async (kind, file) => {
    active += 1;
    issued += 1;
    try {
      if (file === sorted[0]) {
        markStarted();
        throw failure;
      }
      await gate;
      return await read(kind, file);
    } finally {
      active -= 1;
    }
  };
  const listing = store.list('product').finally(() => {
    settled = true;
  });
  const rejected = assert.rejects(listing, (error) => error === failure);
  await started;
  await delay(5);
  assert.equal(settled, false);
  assert.equal(issued, 8);
  release();
  await rejected;
  assert.equal(active, 0);
  assert.equal(issued, 8);
  store.readRecordFile = read;
  assert.equal((await store.list('product')).length, records.length);
});

test('every list rereads same-path canonical replacements even when length and mtime match', async (t) => {
  const store = await temporary(t);
  const first = { id: 'exact-sku', title: 'A' };
  await store.put('product', first);
  assert.deepEqual(await store.list('product'), [first]);
  const path = store.recordPath('product', first.id);
  const before = await stat(path);
  const original = await readFile(path);
  const replacement = { ...first, title: 'B' };
  const notation = encode({ obj: replacement });
  assert.equal(Buffer.byteLength(notation), original.length);
  await writeFile(path, notation);
  await utimes(path, before.atime, before.mtime);
  assert.deepEqual(await store.list('product'), [replacement]);
  const returned = await store.list('product');
  returned[0].title = 'Caller mutation';
  assert.deepEqual(await store.list('product'), [replacement]);
});
