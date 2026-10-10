import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { acquireBrowserWindow } from '../src/persistent-browser.js';

test('an unreachable live worker is retained without launching a replacement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-worker-unreachable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'browser-window.json');
  const state = {
    pid: process.pid,
    token: 'fixture-only',
    controlEndpoint: 'http://127.0.0.1:1/',
  };
  await writeFile(file, JSON.stringify(state));
  await assert.rejects(
    acquireBrowserWindow(directory),
    /existing persistent browser worker is unreachable/u
  );
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), state);
  await assert.rejects(
    readFile(join(directory, 'browser-window-options.json')),
    {
      code: 'ENOENT',
    }
  );
});

test('a failed replacement worker cannot remove another worker state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-worker-owner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { pid: process.pid, token: 'fixture-only' };
  await writeFile(
    join(directory, 'browser-window.json'),
    JSON.stringify(state)
  );
  await writeFile(
    join(directory, 'browser-window-recovery.json'),
    JSON.stringify(state)
  );
  await writeFile(
    join(directory, 'browser-window-options.json'),
    JSON.stringify({ engine: 'invalid-fixture-engine', idleTimeoutMs: 1000 })
  );
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      new URL('../src/persistent-browser-worker.js', import.meta.url).pathname,
      directory,
    ])
  );
  for (const name of ['browser-window.json', 'browser-window-recovery.json']) {
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, name), 'utf8')),
      state
    );
  }
});
