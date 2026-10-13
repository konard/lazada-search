import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AssociativeStore, BrowserCollector } from '../src/index.js';
import { stopForChallenge } from '../src/page-challenge.js';
import {
  collectionStatus,
  retainChallengePage,
} from '../src/browser-challenge-handoff.js';
import {
  acquireBrowserWindow,
  browserWindowStatus,
} from '../src/persistent-browser.js';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-challenge-handoff-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({ store });
  return { directory, store, collector };
}

test('an archived HTTP challenge is stopped, without claiming a browser awaits the person', async (t) => {
  const { directory, store, collector } = await fixture(t);
  await stopForChallenge(store, {
    url: 'https://factory.example/label?token=private',
    signals: ['visible-cloudflare-interstitial'],
  });
  const original = await store.get('collection-stop', 'browser-collection');
  assert.deepEqual((await collector.collectionStatus()).handoff, {
    status: 'no-browser-page',
    pageOpen: false,
  });
  const status = JSON.parse(
    (
      await execute(process.execPath, [
        'bin/lazada-search.js',
        'collection-status',
        '--data-dir',
        directory,
        '--no-archive',
        '--offline',
        '--no-ocr',
      ])
    ).stdout
  );
  assert.deepEqual(status.handoff, {
    status: 'no-browser-page',
    pageOpen: false,
  });
  await assert.rejects(
    execute(process.execPath, [
      'bin/lazada-search.js',
      'resume-collection',
      '--data-dir',
      directory,
      '--no-archive',
      '--no-headless',
      '--no-ocr',
    ]),
    /no window or tab was opened/u
  );
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    original
  );
  assert.doesNotMatch(JSON.stringify(status), /token=|private/u);
  for (const file of [
    'browser-window.json',
    'browser-window-options.json',
    'browser-window-starting',
    'browser-profile',
  ]) {
    assert.equal(
      await stat(join(directory, file)).catch(() => undefined),
      undefined
    );
  }
});

test('resume without a stop is read-only and does not start a browser', async (t) => {
  const { collector } = await fixture(t);
  collector.start = () => {
    throw Error('No window may start');
  };
  assert.deepEqual(await collector.resumeCollection(), {
    id: 'browser-collection',
    active: false,
  });
});

test('existing-only acquisition never creates a profile, worker, tab or directory when unavailable', async (t) => {
  const { directory } = await fixture(t);
  const missing = join(directory, 'missing');
  await assert.rejects(
    acquireBrowserWindow(missing, { existingOnly: true }),
    /original challenge tab identity/u
  );
  await assert.rejects(
    acquireBrowserWindow(missing, {
      existingOnly: true,
      targetId: 'original-target',
    }),
    /no longer available/u
  );
  assert.equal(await stat(missing).catch(() => undefined), undefined);
  assert.deepEqual(await browserWindowStatus(missing, 'original-target'), {
    status: 'window-closed',
    pageOpen: false,
  });
});

test('a retained headed target reports awaiting-user; closed and headless pages never do', async (t) => {
  const { store, collector } = await fixture(t);
  let closed = false;
  let headless = false;
  let targetReads = 0;
  const page = {
    isClosed: () => closed,
    url: () => 'https://factory.example/label?token=private',
    evaluate: async () => headless,
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          targetReads++;
          return { targetInfo: { targetId: 'same-target' } };
        },
        detach: async () => {},
      }),
    }),
  };
  collector.runtime = { page, browser: { isConnected: () => true } };
  collector.persistent = true;
  const challenge = { url: page.url(), signals: ['challenge-instructions'] };
  await retainChallengePage(collector, challenge);
  assert.equal(targetReads, 1);
  assert.deepEqual((await collectionStatus(store, collector)).handoff, {
    status: 'awaiting-user',
    pageOpen: true,
  });
  headless = true;
  await retainChallengePage(collector, challenge);
  assert.deepEqual((await collectionStatus(store, collector)).handoff, {
    status: 'headless-page',
    pageOpen: true,
  });
  closed = true;
  assert.deepEqual((await collectionStatus(store, collector)).handoff, {
    status: 'window-closed',
    pageOpen: false,
  });
  const stop = await store.get('collection-stop', 'browser-collection');
  assert.equal(stop.browser.targetId, 'same-target');
  assert.doesNotMatch(JSON.stringify(stop), /token=|private/u);
});

test('a stopped collection whose persistent window disappeared reports closed without launching', async (t) => {
  const { directory, store, collector } = await fixture(t);
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
    origin: 'https://factory.example',
    browser: { mode: 'persistent', targetId: 'closed-target', headless: false },
  });
  assert.deepEqual((await collector.collectionStatus()).handoff, {
    status: 'window-closed',
    pageOpen: false,
  });
  await assert.rejects(collector.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  await assert.rejects(
    readFile(join(directory, 'browser-window-options.json')),
    { code: 'ENOENT' }
  );
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
});

test('concurrent challenge observations keep the original stop and origin', async (t) => {
  const { store } = await fixture(t);
  const observed = await Promise.all([
    stopForChallenge(store, {
      url: 'https://first.factory.example/label',
      signals: ['first-challenge'],
    }),
    stopForChallenge(store, {
      url: 'https://second.factory.example/label',
      signals: ['second-challenge'],
    }),
  ]);
  assert.deepEqual(observed[0], observed[1]);
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    observed[0]
  );
});

test('an open stale collector page cannot report a newer closed target as awaiting-user', async (t) => {
  const { directory, store, collector } = await fixture(t);
  const original = {
    id: 'browser-collection',
    active: true,
    origin: 'https://factory.example',
    browser: { mode: 'persistent', targetId: 'new-target', headless: false },
  };
  await store.put('collection-stop', original);
  const page = {
    isClosed: () => false,
    context: () => ({
      newCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: 'old-target' } }),
        detach: async () => {},
      }),
    }),
  };
  collector.runtime = { page, browser: { isConnected: () => true } };
  collector.challengePage = page;
  assert.deepEqual((await collector.collectionStatus()).handoff, {
    status: 'window-closed',
    pageOpen: false,
  });
  assert.deepEqual(
    await store.get('collection-stop', 'browser-collection'),
    original
  );
  await assert.rejects(
    readFile(join(directory, 'browser-window-options.json')),
    { code: 'ENOENT' }
  );
});

test('unsupported headed engine retention fails before any browser/profile launch', async (t) => {
  const { directory, store } = await fixture(t);
  const collector = new BrowserCollector({
    store,
    browserOptions: { launch: 'engine', headless: false },
  });
  await assert.rejects(collector.start(), /headed engine mode is unsupported/u);
  assert.equal(collector.runtime, undefined);
  assert.equal(
    await stat(join(directory, 'browser-profile')).catch(() => undefined),
    undefined
  );
});

test('closing an unused offline collector does not read or rewrite a removed archive', async () => {
  const collector = new BrowserCollector({
    store: {
      get: () => {
        throw Error('No offline cleanup reads');
      },
    },
  });
  await collector.close();
});

test('normal-close preference preserves a different retained challenge target in the same owned window', async (t) => {
  const { directory, collector } = await fixture(t);
  const state = {
    pid: process.pid,
    token: 'fixture-only',
    controlEndpoint: 'http://127.0.0.1:1/',
  };
  await writeFile(
    join(directory, 'browser-window.json'),
    JSON.stringify(state)
  );
  collector.browserOptions.persistentWindow = false;
  collector.persistent = true;
  let releases = 0;
  collector.runtime = {
    release: async () => {
      releases++;
    },
  };
  collector.collectionStatus = async () => ({
    active: true,
    handoff: { pageOpen: true, status: 'awaiting-user' },
  });
  await collector.close();
  assert.equal(releases, 1);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'browser-window.json'), 'utf8')),
    state
  );
  assert.equal(
    await stat(join(directory, 'browser-window-options.json')).catch(
      () => undefined
    ),
    undefined
  );
});
