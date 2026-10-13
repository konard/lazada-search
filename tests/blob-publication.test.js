import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { AssociativeStore } from '../src/store.js';
import { publishContentAddressedBlob } from '../src/blob-publication.js';
import { sha256 } from '../src/util.js';

const original = Buffer.from([0, 255, 42, 13, 10, 0, 195, 169]);

async function fixture(t) {
  const directory = await fs.mkdtemp(
    join(tmpdir(), 'lazada-blob-publication-')
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const id = sha256(original);
  const path = join(directory, 'blobs', id.slice(0, 2), id);
  return { directory, id, path };
}

async function noStaging(path) {
  assert.deepEqual(await fs.readdir(dirname(path)), [sha256(original)]);
}

test('blob publication syncs and closes complete staging bytes before exclusive linking and directory sync', async (t) => {
  const { path } = await fixture(t);
  const events = [];
  const operations = {
    open: async (name, ...options) => {
      const directory = name === dirname(path);
      const file =
        directory && process.platform === 'win32'
          ? { sync: async () => {}, close: async () => {} }
          : await fs.open(name, ...options);
      return {
        writeFile: async (bytes) => {
          events.push('write');
          await file.writeFile(bytes);
        },
        sync: async () => {
          events.push(directory ? 'directory-sync' : 'file-sync');
          await file.sync();
        },
        close: async () => {
          events.push(directory ? 'directory-close' : 'file-close');
          await file.close();
        },
      };
    },
    link: async (staging, canonical) => {
      assert.deepEqual(events, ['write', 'file-sync', 'file-close']);
      assert.deepEqual(await fs.readFile(staging), original);
      await assert.rejects(fs.readFile(canonical), { code: 'ENOENT' });
      events.push('link');
      await fs.link(staging, canonical);
    },
    rm: async (name, options) => {
      events.push('cleanup');
      await fs.rm(name, options);
    },
  };
  await publishContentAddressedBlob(path, original, {
    operations,
    platform: 'linux',
  });
  assert.deepEqual(events, [
    'write',
    'file-sync',
    'file-close',
    'link',
    'cleanup',
    'directory-sync',
    'directory-close',
  ]);
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});

test('same-digest competing publishers accept a simulated Windows EPERM only after verifying the complete winner', async (t) => {
  const { path, id } = await fixture(t);
  let release,
    arrived = 0,
    winners = 0,
    collisions = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const operations = {
    link: async (staging, canonical) => {
      assert.deepEqual(await fs.readFile(staging), original);
      if (++arrived === 2) {
        release();
      }
      await gate;
      try {
        await fs.link(staging, canonical);
        winners++;
      } catch (error) {
        assert.ok(['EEXIST', 'EPERM'].includes(error.code));
        collisions++;
        throw Object.assign(new Error('Synthetic competing Windows winner'), {
          code: 'EPERM',
        });
      }
    },
  };
  await Promise.all(
    Array.from({ length: 2 }, () =>
      publishContentAddressedBlob(path, original, {
        operations,
        platform: 'win32',
      })
    )
  );
  assert.equal(winners, 1);
  assert.equal(collisions, 1);
  assert.equal(sha256(await fs.readFile(path)), id);
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});

test('matching existing blobs retain their mtime and need no staging, links or directory writes', async (t) => {
  const { path } = await fixture(t);
  await publishContentAddressedBlob(path, original);
  const before = (await fs.stat(path)).mtimeMs;
  const forbidden = () => {
    throw new Error('A verified blob must not be rewritten');
  };
  await publishContentAddressedBlob(path, original, {
    operations: {
      mkdir: forbidden,
      open: forbidden,
      link: forbidden,
      rm: forbidden,
    },
  });
  assert.equal((await fs.stat(path)).mtimeMs, before);
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});

test('a genuine publication permission failure without a matching winner propagates and cleans staging', async (t) => {
  const { path } = await fixture(t);
  const failure = Object.assign(
    new Error('Synthetic inaccessible destination'),
    { code: 'EPERM' }
  );
  await assert.rejects(
    publishContentAddressedBlob(path, original, {
      operations: {
        link: async () => {
          throw failure;
        },
      },
    }),
    (error) => error === failure
  );
  await assert.rejects(fs.readFile(path), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(dirname(path)), []);
});

for (const code of ['EEXIST', 'EPERM']) {
  test(`a ${code} competing corrupt blob is refused without replacing its bytes`, async (t) => {
    const { path } = await fixture(t);
    const corrupt = Buffer.from('wrong original bytes');
    await assert.rejects(
      publishContentAddressedBlob(path, original, {
        operations: {
          link: async (_, canonical) => {
            await fs.writeFile(canonical, corrupt);
            throw Object.assign(new Error('Synthetic competing writer'), {
              code,
            });
          },
        },
      }),
      /Corrupt evidence blob/u
    );
    assert.deepEqual(await fs.readFile(path), corrupt);
    await noStaging(path);
  });
}

test('unrelated publication IO failure is not hidden by a concurrently matching canonical blob', async (t) => {
  const { path } = await fixture(t);
  const failure = Object.assign(new Error('Synthetic IO failure'), {
    code: 'EIO',
  });
  await assert.rejects(
    publishContentAddressedBlob(path, original, {
      operations: {
        link: async (_, canonical) => {
          await fs.writeFile(canonical, original);
          throw failure;
        },
      },
    }),
    (error) => error === failure
  );
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});

for (const failedOperation of ['writeFile', 'sync', 'close']) {
  test(`a staging ${failedOperation} failure closes the handle, cleans its temporary file and leaves no canonical blob`, async (t) => {
    const { path } = await fixture(t);
    const failure = Object.assign(
      new Error(`Synthetic ${failedOperation} failure`),
      { code: 'EIO' }
    );
    let closed = false;
    await assert.rejects(
      publishContentAddressedBlob(path, original, {
        operations: {
          open: async (name, ...options) => {
            const handle = await fs.open(name, ...options);
            return {
              writeFile: async (bytes) => {
                await handle.writeFile(bytes);
                if (failedOperation === 'writeFile') {
                  throw failure;
                }
              },
              sync: async () => {
                if (failedOperation === 'sync') {
                  throw failure;
                }
                await handle.sync();
              },
              close: async () => {
                await handle.close();
                closed = true;
                if (failedOperation === 'close') {
                  throw failure;
                }
              },
            };
          },
        },
      }),
      (error) => error === failure
    );
    assert.equal(closed, true);
    await assert.rejects(fs.readFile(path), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(dirname(path)), []);
  });
}

test('directory sync failures propagate after immutable publication and leave complete canonical bytes without staging', async (t) => {
  const { path } = await fixture(t);
  const failure = Object.assign(new Error('Synthetic directory sync failure'), {
    code: 'EIO',
  });
  let closed = false;
  await assert.rejects(
    publishContentAddressedBlob(path, original, {
      platform: 'linux',
      operations: {
        open: async (name, ...options) => {
          if (name !== dirname(path)) {
            return fs.open(name, ...options);
          }
          const handle =
            process.platform === 'win32'
              ? { close: async () => {} }
              : await fs.open(name, ...options);
          return {
            sync: async () => {
              throw failure;
            },
            close: async () => {
              await handle.close();
              closed = true;
            },
          };
        },
      },
    }),
    (error) => error === failure
  );
  assert.equal(closed, true);
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});

test('a staged matching contender flushes its own directory before returning while the first publisher later fails its held sync', async (t) => {
  const { path } = await fixture(t);
  let releaseLinks, markLinked, markHeld, releaseSync;
  let arrived = 0,
    contenderSyncs = 0,
    contenderCloses = 0;
  const links = new Promise((resolve) => {
    releaseLinks = resolve;
  });
  const linked = new Promise((resolve) => {
    markLinked = resolve;
  });
  const held = new Promise((resolve) => {
    markHeld = resolve;
  });
  const syncGate = new Promise((resolve) => {
    releaseSync = resolve;
  });
  const failure = Object.assign(
    new Error('Synthetic held publisher sync failure'),
    { code: 'EIO' }
  );
  const operations = (first) => ({
    link: async (staging, canonical) => {
      if (++arrived === 2) {
        releaseLinks();
      }
      await links;
      if (first) {
        await fs.link(staging, canonical);
        markLinked();
      } else {
        await linked;
        throw Object.assign(new Error('Synthetic matching contender'), {
          code: 'EPERM',
        });
      }
    },
    open: async (name, ...options) => {
      if (name !== dirname(path)) {
        return fs.open(name, ...options);
      }
      const handle =
        process.platform === 'win32'
          ? { sync: async () => {}, close: async () => {} }
          : await fs.open(name, ...options);
      return {
        sync: async () => {
          if (first) {
            markHeld();
            await syncGate;
            throw failure;
          }
          await held;
          await handle.sync();
          contenderSyncs++;
        },
        close: async () => {
          await handle.close();
          if (!first) {
            contenderCloses++;
          }
        },
      };
    },
  });
  const first = publishContentAddressedBlob(path, original, {
    operations: operations(true),
    platform: 'linux',
  });
  const contender = publishContentAddressedBlob(path, original, {
    operations: operations(false),
    platform: 'linux',
  });
  t.after(async () => {
    releaseLinks();
    markLinked();
    markHeld();
    releaseSync();
    await Promise.allSettled([first, contender]);
  });
  await held;
  await contender;
  assert.equal(contenderSyncs, 1);
  assert.equal(contenderCloses, 1);
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
  releaseSync();
  await assert.rejects(first, (error) => error === failure);
  assert.deepEqual(await fs.readFile(path), original);
});

test('putBlob revalidates a corrupt canonical file appearing immediately after its initial verified lookup', async (t) => {
  const { directory, path } = await fixture(t);
  const store = new AssociativeStore({ directory });
  const corrupt = Buffer.from('new corrupt competitor');
  store.blob = async () => {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, corrupt);
    return undefined;
  };
  await assert.rejects(store.putBlob(original), /Corrupt evidence blob/u);
  assert.deepEqual(await fs.readFile(path), corrupt);
  await noStaging(path);
});

test('same-digest writes across real store instances preserve original bytes, references and empty blobs without record locks', async (t) => {
  const { directory, path, id } = await fixture(t);
  const stores = Array.from(
    { length: 4 },
    () => new AssociativeStore({ directory })
  );
  for (const store of stores) {
    store.locked = () => {
      throw new Error('Blob publication must not use a record lock');
    };
  }
  const refs = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      stores[index % 4].putBlob(original)
    )
  );
  assert.ok(
    refs.every((ref) => ref.sha256 === id && ref.bytes === original.length)
  );
  assert.deepEqual(await stores[0].blob(id), original);
  await noStaging(path);
  const empty = await Promise.all(
    stores.map((store) => store.putBlob(Buffer.alloc(0)))
  );
  assert.ok(
    empty.every(
      (ref) => ref.sha256 === sha256(Buffer.alloc(0)) && ref.bytes === 0
    )
  );
  assert.deepEqual(await stores[0].blob(empty[0].sha256), Buffer.alloc(0));
});

test('putBlob snapshots mutable inputs and reuses exact private fallback originals without copying', async (t) => {
  const { directory, path } = await fixture(t);
  const store = new AssociativeStore({ directory });
  const mutable = Buffer.from(original);
  const pending = store.putBlob(mutable);
  mutable.fill(17);
  const reference = await pending;
  assert.deepEqual(await store.blob(reference.sha256), original);
  const mtime = (await fs.stat(path)).mtimeMs;
  const privateStore = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: store,
  });
  assert.deepEqual(await privateStore.putBlob(original), reference);
  await assert.rejects(fs.stat(join(privateStore.directory, 'blobs')), {
    code: 'ENOENT',
  });
  assert.equal((await fs.stat(path)).mtimeMs, mtime);
});

test('separate real processes concurrently publish the same digest without replacing original bytes', async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'lazada-blob-processes-'));
  const gate = join(directory, 'gate');
  const children = [];
  t.after(async () => {
    await fs.writeFile(gate, 'release');
    await Promise.allSettled(children);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const storeUrl = new URL('../src/store.js', import.meta.url).href;
  const execute = promisify(execFile);
  for (let index = 0; index < 4; index++) {
    const source = `import {AssociativeStore} from ${JSON.stringify(storeUrl)};
      import {writeFile,stat} from 'node:fs/promises';
      import {setTimeout as delay} from 'node:timers/promises';
      const directory=${JSON.stringify(directory)};
      await writeFile(directory+'/ready-${index}','ready');
      while(!await stat(directory+'/gate').then(()=>true,()=>false))await delay(5);
      const store=new AssociativeStore({directory});
      const bytes=Buffer.from(${JSON.stringify(original.toString('base64'))},'base64');
      const references=await Promise.all(Array.from({length:6},()=>store.putBlob(bytes)));
      console.log(JSON.stringify(references));`;
    const options = process.versions.deno
      ? ['eval', '--frozen', '--cached-only', '--no-check', source]
      : ['--input-type=module', '-e', source];
    children.push(execute(process.execPath, options, { timeout: 20000 }));
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        fs.stat(join(directory, `ready-${index}`)).then(
          () => true,
          () => false
        )
      )
    );
    if (ready.every(Boolean)) {
      break;
    }
    await delay(20);
  }
  for (let index = 0; index < 4; index++) {
    await fs.stat(join(directory, `ready-${index}`));
  }
  await fs.writeFile(gate, 'release');
  const results = await Promise.all(children);
  for (const result of results) {
    assert.deepEqual(
      JSON.parse(result.stdout),
      Array.from({ length: 6 }, () => ({
        type: 'stored-blob',
        sha256: sha256(original),
        bytes: original.length,
      }))
    );
  }
  const path = join(
    directory,
    'blobs',
    sha256(original).slice(0, 2),
    sha256(original)
  );
  assert.deepEqual(await fs.readFile(path), original);
  await noStaging(path);
});
