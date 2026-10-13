import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pacePersistentHost } from '../src/browser-pacing.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-pacing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, 'browser-request-times.json') };
}

test('an early timer cannot shorten persistent request spacing across client restarts', async (t) => {
  const { directory, file } = await fixture(t);
  let clock = 1000;
  const now = () => clock;
  await pacePersistentHost(
    directory,
    'https://www.lazada.vn/local-fixture',
    0,
    { now }
  );
  const waits = [];
  let touches = 0;
  const at = await pacePersistentHost(
    directory,
    'https://www.lazada.vn/next-fixture',
    1500,
    {
      now,
      wait: async (ms) => {
        waits.push(ms);
        clock += waits.length === 1 ? ms - 1 : ms;
      },
      touch: () => {
        touches += 1;
      },
    }
  );
  assert.deepEqual(waits, [1500, 1]);
  assert.equal(at, 2500);
  assert.equal(JSON.parse(await readFile(file, 'utf8'))['www.lazada.vn'], 2500);
  assert.equal(touches, 1);
});

test('different hosts retain independent clocks while a future persisted slot is honoured', async (t) => {
  const { directory, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ 'factory.example': 2000 }));
  let clock = 1000;
  let waits = 0;
  const options = {
    now: () => clock,
    wait: async (ms) => {
      waits += 1;
      clock += ms;
    },
  };
  await pacePersistentHost(
    directory,
    'https://www.lazada.vn/local-fixture',
    500,
    options
  );
  assert.equal(waits, 0);
  await pacePersistentHost(
    directory,
    'https://factory.example/local-fixture',
    500,
    options
  );
  assert.equal(waits, 1);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    'factory.example': 2500,
    'www.lazada.vn': 1000,
  });
});

test('malformed persistent spacing evidence fails before a request slot is written', async (t) => {
  const { directory, file } = await fixture(t);
  await writeFile(file, '{broken');
  await assert.rejects(
    pacePersistentHost(directory, 'https://factory.example/fixture', 500),
    SyntaxError
  );
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeFile(file, JSON.stringify({ 'factory.example': 'invalid' }));
  await assert.rejects(
    pacePersistentHost(directory, 'https://factory.example/fixture', 500),
    /timestamp/u
  );
  await assert.rejects(
    pacePersistentHost(directory, 'https://factory.example/fixture', -1),
    /interval/u
  );
});
