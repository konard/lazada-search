import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreLockDirectory } from '../src/store-lock-directory.js';

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
