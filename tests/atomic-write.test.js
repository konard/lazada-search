import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { atomicWrite } from '../src/util.js';

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-atomic-write-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('atomic replacement commits exact Unicode and binary bytes without leftover temporary files', async (t) => {
  const directory = await temporary(t);
  const parent = join(directory, 'records');
  const path = join(parent, 'record.lino');
  const first = Buffer.from('Sô cô la\nNhà sản xuất 🥛');
  const replacement = Buffer.from([0, 255, 1, 127, 0, 240]);
  await atomicWrite(path, first);
  assert.deepEqual(await readFile(path), first);
  await atomicWrite(path, replacement, { directoryPrepared: true });
  assert.deepEqual(await readFile(path), replacement);
  assert.deepEqual(await readdir(parent), ['record.lino']);
  if (process.platform !== 'win32') {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});

test('a batch-prepared directory removed before open is recreated once and commits the original bytes', async (t) => {
  const directory = await temporary(t);
  const parent = join(directory, 'records');
  await mkdir(parent);
  await rm(parent, { recursive: true });
  const path = join(parent, 'record.lino');
  const bytes = Buffer.from('Original selected SKU\n40g/cây');
  await atomicWrite(path, bytes, { directoryPrepared: true });
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await readdir(parent), ['record.lino']);
});

test('failed content writes remove their temporary file and preserve the earlier canonical bytes', async (t) => {
  const directory = await temporary(t);
  const path = join(directory, 'record.lino');
  const original = Buffer.from('previous durable record');
  await atomicWrite(path, original);
  await assert.rejects(
    atomicWrite(path, Symbol('invalid byte contents'), {
      directoryPrepared: true,
    })
  );
  assert.deepEqual(await readFile(path), original);
  assert.deepEqual(await readdir(directory), ['record.lino']);
});

test('failed atomic rename removes the new temporary file without changing the protected destination', async (t) => {
  const directory = await temporary(t);
  const destination = join(directory, 'protected');
  await mkdir(destination);
  await writeFile(join(destination, 'original'), 'protected directory');
  await assert.rejects(
    atomicWrite(destination, 'replacement', { directoryPrepared: true })
  );
  assert.equal(
    await readFile(join(destination, 'original'), 'utf8'),
    'protected directory'
  );
  assert.deepEqual(await readdir(directory), ['protected']);
});
