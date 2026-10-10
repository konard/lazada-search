import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  startPhoneLogin,
  submitPhoneCode,
  phoneLoginState,
} from '../../src/index.js';

const execute = promisify(execFile);
const fixture = await readFile(
  new URL('../fixtures/login.html', import.meta.url),
  'utf8'
);

test('phone sign-in requests one code, saves session cookies, and merges private CLI data after restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-login-e2e-'));
  const shared = new AssociativeStore({ directory });
  const store = new AssociativeStore({
    directory: join(directory, 'accounts', 'default'),
    fallback: shared,
    visibility: 'private',
  });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({ store }),
    browserOptions: {
      launch: 'engine',
      args: ['--disable-features=Translate'],
      extraArgs: ['--disable-features=MediaRouter'],
    },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const featureSwitches = collector.runtime.args.filter((argument) =>
    argument.startsWith('--disable-features=')
  );
  assert.equal(featureSwitches.length, 1);
  for (const feature of ['Translate', 'MediaRouter', 'SessionRestoreInfobar']) {
    assert.ok(featureSwitches[0].includes(feature));
  }
  let requests = 0;
  const route = async (request) => {
    if (['/sms', '/zalo'].includes(new URL(request.request().url()).pathname)) {
      requests++;
      await request.fulfill({
        contentType: 'application/json',
        body: '{"sent":true}',
      });
    } else {
      await request.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: fixture,
      });
    }
  };
  await collector.runtime.page.route('https://cart.lazada.vn/**', route);
  const state = await startPhoneLogin(collector, {
    phone: '+84901234567',
    url: 'https://cart.lazada.vn/cart',
  });
  assert.deepEqual(state, { status: 'otp-required' });
  assert.equal(requests, 1);
  assert.deepEqual(await submitPhoneCode(collector, '123456'), {
    status: 'authenticated',
  });
  assert.deepEqual(await phoneLoginState(collector.runtime.page), {
    status: 'authenticated',
  });
  await collector.close();
  await collector.start();
  await collector.runtime.page.route('https://cart.lazada.vn/**', route);
  assert.deepEqual(
    await startPhoneLogin(collector, {
      phone: '+84901234567',
      url: 'https://cart.lazada.vn/cart',
    }),
    { status: 'authenticated' }
  );
  assert.equal(requests, 1);
  await shared.put('offer', { id: 'public-SKU', price: 300000 });
  await store.put('offer', {
    id: 'private-SKU',
    price: 280000,
    shipping: 25000,
  });
  const { stdout } = await execute(process.execPath, [
    'bin/lazada-search.js',
    'inspect',
    'offer',
    '--account',
    'default',
    '--data-dir',
    directory,
    '--no-archive',
    '--offline',
    '--no-ocr',
  ]);
  const records = JSON.parse(stdout);
  assert.equal(records.length, 2);
  assert.equal(
    records.find((record) => record.id === 'private-SKU').visibility,
    'private'
  );
  assert.equal((await shared.list('offer')).length, 1);
});

test('hidden logout templates never prove a session, and verification challenges stop phone requests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-login-challenge-'));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({ store }),
    browserOptions: { launch: 'engine' },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  await collector.runtime.page.setContent(fixture);
  assert.deepEqual(await phoneLoginState(collector.runtime.page), {
    status: 'pending',
  });
  await collector.runtime.page.route('https://cart.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Security verification</h1>',
    })
  );
  assert.deepEqual(
    await startPhoneLogin(collector, {
      phone: '+84901234567',
      url: 'https://cart.lazada.vn/cart',
    }),
    { status: 'challenge' }
  );
});

test('SMS sign-in uses its own channel and preserves leading zeros in verification codes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-login-sms-'));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({ store }),
    browserOptions: { launch: 'engine' },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const channels = [];
  await collector.runtime.page.route(
    'https://cart.lazada.vn/**',
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (['/sms', '/zalo'].includes(path)) {
        channels.push(path);
        await route.fulfill({
          contentType: 'application/json',
          body: '{"sent":true}',
        });
      } else {
        await route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: fixture.replaceAll('123456', '012345'),
        });
      }
    }
  );
  assert.deepEqual(
    await startPhoneLogin(collector, {
      phone: '+84901234567',
      channel: 'sms',
      url: 'https://cart.lazada.vn/cart',
    }),
    { status: 'otp-required' }
  );
  assert.deepEqual(channels, ['/sms']);
  assert.deepEqual(await submitPhoneCode(collector, '012345'), {
    status: 'authenticated',
  });
});
