import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createStoreLockDirectory,
  readStoreLockOwner,
} from '../src/store-lock-directory.js';

test('a transient Windows EPERM retries and then creates the real writer directory', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-lock-retry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, '.write-lock');
  let attempts = 0;
  await createStoreLockDirectory(path, {
    platform: 'win32',
    create: async (target) => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('Deletion pending'), { code: 'EPERM' });
      }
      return await mkdir(target);
    },
  });
  assert.equal(attempts, 3);
  assert.equal((await stat(path)).isDirectory(), true);
});

test('persistent Windows permissions fail after four attempts with the original error', async () => {
  const failure = Object.assign(new Error('Permission denied'), {
    code: 'EPERM',
  });
  let attempts = 0;
  await assert.rejects(
    createStoreLockDirectory('unused', {
      platform: 'win32',
      create: () => {
        attempts += 1;
        throw failure;
      },
    }),
    (error) => error === failure
  );
  assert.equal(attempts, 4);
});

test('other platforms and existing locks fail immediately without taking ownership', async () => {
  for (const [platform, code] of [
    ['linux', 'EPERM'],
    ['darwin', 'EPERM'],
    ['win32', 'EEXIST'],
    ['win32', 'EACCES'],
  ]) {
    const failure = Object.assign(new Error(code), { code });
    let attempts = 0;
    await assert.rejects(
      createStoreLockDirectory('unused', {
        platform,
        create: () => {
          attempts += 1;
          throw failure;
        },
      }),
      (error) => error === failure
    );
    assert.equal(attempts, 1);
  }
});

test('a transient Windows owner-read EPERM retries without changing the held writer lock', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-owner-retry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, '.write-lock');
  const path = join(lock, 'owner');
  const owner = String(process.pid);
  await mkdir(lock);
  await writeFile(path, owner);
  let attempts = 0;
  const observed = await readStoreLockOwner(path, {
    platform: 'win32',
    read: async (target, encoding) => {
      attempts += 1;
      assert.equal(target, path);
      assert.equal(encoding, 'utf8');
      if (attempts < 3) {
        throw Object.assign(new Error('Owner deletion pending'), {
          code: 'EPERM',
        });
      }
      return await readFile(target, encoding);
    },
  });
  assert.equal(attempts, 3);
  assert.equal(observed, owner);
  assert.equal(await readFile(path, 'utf8'), owner);
  assert.equal((await stat(lock)).isDirectory(), true);
});

test('persistent Windows owner-read denial retains its original error and never removes a live lock', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-owner-denied-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, '.write-lock');
  const path = join(lock, 'owner');
  const owner = String(process.pid);
  await mkdir(lock);
  await writeFile(path, owner);
  const failure = Object.assign(new Error('Owner permission denied'), {
    code: 'EPERM',
  });
  let attempts = 0;
  await assert.rejects(
    readStoreLockOwner(path, {
      platform: 'win32',
      read: () => {
        attempts += 1;
        throw failure;
      },
    }),
    (error) => error === failure
  );
  assert.equal(attempts, 4);
  assert.equal(await readFile(path, 'utf8'), owner);
  assert.equal((await stat(lock)).isDirectory(), true);
});

test('owner reads propagate other errors immediately and only an actual missing owner is optional', async (t) => {
  for (const [platform, code] of [
    ['linux', 'EPERM'],
    ['darwin', 'EPERM'],
    ['win32', 'EACCES'],
    ['win32', 'EIO'],
  ]) {
    const failure = Object.assign(new Error(code), { code });
    let attempts = 0;
    await assert.rejects(
      readStoreLockOwner('unused', {
        platform,
        read: () => {
          attempts += 1;
          throw failure;
        },
      }),
      (error) => error === failure
    );
    assert.equal(attempts, 1);
  }
  const directory = await mkdtemp(join(tmpdir(), 'lazada-owner-absent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, '.write-lock');
  await mkdir(lock);
  assert.equal(
    await readStoreLockOwner(join(lock, 'owner'), { platform: 'win32' }),
    undefined
  );
  assert.equal((await stat(lock)).isDirectory(), true);
});
