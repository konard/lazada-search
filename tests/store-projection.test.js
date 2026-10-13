import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AssociativeStore } from '../src/store.js';
import { DoubletGraph } from '../src/doublets.js';
import { writeStoreProjection } from '../src/store-projection.js';
import { atomicWrite, sha256 } from '../src/util.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function trackSettlement(promise) {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  return () => settled;
}

function injectedProject(write) {
  return async (kind, record, notation, path, options) => {
    const graph = new DoubletGraph();
    graph.addRecord(kind, record);
    await writeStoreProjection(path, notation, graph.toBinary(), {
      ...options,
      write,
    });
    return graph;
  };
}

test('independent projections start together and await both durable writes without changing exact bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-projection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'record.lino');
  const notation = 'Durable Sô cô la 🥛';
  const bytes = Buffer.from([0, 255, 42, 0, 1]);
  await atomicWrite(path, notation);
  const canonicalTime = (await stat(path)).mtimeMs;
  const started = [];
  const bothStarted = deferred();
  const gate = deferred();
  const writing = writeStoreProjection(path, notation, bytes, {
    directoryPrepared: true,
    write: async (destination, contents, options) => {
      assert.equal(await readFile(path, 'utf8'), notation);
      assert.equal(options.directoryPrepared, true);
      started.push(destination);
      if (started.length === 2) {
        bothStarted.resolve();
      }
      await gate.promise;
      await atomicWrite(destination, contents, options);
    },
  });
  const settled = trackSettlement(writing);
  await bothStarted.promise;
  assert.equal(settled(), false);
  assert.deepEqual(
    started.sort(),
    [path.replace('.lino', '.links'), `${path}.sha256`].sort()
  );
  gate.resolve();
  await writing;
  assert.deepEqual(await readFile(path.replace('.lino', '.links')), bytes);
  assert.equal(
    await readFile(`${path}.sha256`, 'utf8'),
    `${sha256(notation)}:${sha256(bytes)}`
  );
  assert.equal((await stat(path)).mtimeMs, canonicalTime);
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith('.tmp')),
    false
  );
});

for (const failedSuffix of ['.links', '.lino.sha256']) {
  test(`a real ${failedSuffix} failure drains its sibling under the writer lock and repairs from unchanged canonical bytes`, async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'lazada-projection-failure-')
    );
    const store = new AssociativeStore({ directory });
    const originalProject = store.project.bind(store);
    const record = { id: 'selected', title: 'Sô cô la', revision: 2 };
    await store.put('discovery', { ...record, revision: 1 });
    const path = store.recordPath('discovery', record.id);
    const blocked = path.replace(/\.lino$/u, failedSuffix);
    await rm(blocked);
    await mkdir(blocked);
    await writeFile(join(blocked, 'protected'), 'existing protected directory');
    const slowStarted = deferred();
    const failed = deferred();
    const gate = deferred();
    let originalFailure, canonicalTime;
    t.after(async () => {
      gate.resolve();
      await writing?.catch(() => undefined);
      await observer;
      await rm(directory, { recursive: true, force: true });
    });
    store.project = injectedProject(async (destination, contents, options) => {
      await access(join(directory, '.write-lock', 'owner'));
      assert.deepEqual(await store.get('discovery', record.id), record);
      canonicalTime = (await stat(path)).mtimeMs;
      if (destination !== blocked) {
        slowStarted.resolve();
        await gate.promise;
      }
      try {
        await atomicWrite(destination, contents, options);
      } catch (error) {
        originalFailure = error;
        failed.resolve();
        throw error;
      }
    });
    const writing = store.put('discovery', record);
    const settled = trackSettlement(writing);
    await Promise.all([slowStarted.promise, failed.promise]);
    let observerAcquired = false;
    const observer = store.locked(async () => {
      observerAcquired = true;
      await access(
        path.replace(
          /\.lino$/u,
          failedSuffix === '.links' ? '.lino.sha256' : '.links'
        )
      );
    });
    await delay(20);
    assert.equal(settled(), false);
    assert.equal(observerAcquired, false);
    await access(join(directory, '.write-lock', 'owner'));
    gate.resolve();
    await assert.rejects(writing, (error) => error === originalFailure);
    await observer;
    assert.equal(observerAcquired, true);
    assert.equal(
      await readFile(join(blocked, 'protected'), 'utf8'),
      'existing protected directory'
    );
    assert.deepEqual(await store.get('discovery', record.id), record);
    await rm(blocked, { recursive: true });
    store.project = originalProject;
    const graph = await store.graph('discovery', record.id);
    assert.ok(graph.names.has('number:2'));
    assert.equal(graph.names.has('number:1'), false);
    const notation = await readFile(path, 'utf8');
    const binary = await readFile(path.replace('.lino', '.links'));
    assert.equal(
      await readFile(`${path}.sha256`, 'utf8'),
      `${sha256(notation)}:${sha256(binary)}`
    );
    assert.deepEqual(DoubletGraph.fromBinary(binary).links, graph.links);
    assert.equal((await stat(path)).mtimeMs, canonicalTime);
    assert.equal(
      (await readdir(join(directory, 'discovery'))).some((name) =>
        name.endsWith('.tmp')
      ),
      false
    );
  });
}

test('duplicate IDs cannot commit a newer version until both older projection writes drain', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-projection-duplicates-')
  );
  const store = new AssociativeStore({ directory });
  const gate = deferred();
  const firstDigestStarted = deferred();
  t.after(async () => {
    gate.resolve();
    await writing?.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });
  const versions = [];
  let olderCompleted = 0;
  store.project = async (kind, record, notation, path, options) => {
    versions.push(record.revision);
    if (record.revision === 2) {
      assert.equal(olderCompleted, 2);
    }
    return injectedProject(async (destination, contents, writeOptions) => {
      if (record.revision === 1 && destination.endsWith('.sha256')) {
        firstDigestStarted.resolve();
        await gate.promise;
      }
      await atomicWrite(destination, contents, writeOptions);
      if (record.revision === 1) {
        olderCompleted += 1;
      }
    })(kind, record, notation, path, options);
  };
  const records = [
    { id: 'same', revision: 1 },
    { id: 'same', revision: 2 },
  ];
  const writing = store.putMany('discovery', records);
  await firstDigestStarted.promise;
  assert.deepEqual(versions, [1]);
  assert.deepEqual(await store.get('discovery', 'same'), records[0]);
  gate.resolve();
  assert.deepEqual(await writing, records);
  assert.deepEqual(versions, [1, 2]);
  assert.deepEqual(await store.get('discovery', 'same'), records[1]);
  const graph = await store.graph('discovery', 'same');
  assert.ok(graph.names.has('number:2'));
  assert.equal(graph.names.has('number:1'), false);
});

test('synchronous and asynchronous projection failures both drain and retain binary-first error precedence', async () => {
  const gate = deferred();
  const digestStarted = deferred();
  const binaryFailure = new Error('Delayed binary failure');
  const digestFailure = new Error('Immediate digest failure');
  const calls = [];
  const writing = writeStoreProjection(
    '/unused/record.lino',
    'canonical',
    Buffer.from('binary'),
    {
      write: (destination) => {
        calls.push(destination);
        if (destination.endsWith('.sha256')) {
          digestStarted.resolve();
          throw digestFailure;
        }
        return gate.promise.then(() => {
          throw binaryFailure;
        });
      },
    }
  );
  const settled = trackSettlement(writing);
  await digestStarted.promise;
  assert.equal(calls.length, 2);
  assert.equal(settled(), false);
  gate.resolve();
  await assert.rejects(writing, (error) => error === binaryFailure);
});
