import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import {
  AssociativeStore,
  BrowserCollector,
  DomainScheduler,
  EvidenceCache,
  COLLECTION_STOP_ID,
  phoneLoginState,
} from '../../src/index.js';
import { closeBrowserWindow } from '../../src/persistent-browser.js';
import { pageTargetId } from '../../src/browser-challenge-handoff.js';

const execute = promisify(execFile);
const fixtureUrl =
  'https://www.lazada.vn/products/synthetic-challenge-i100.html';
const browserOptions = {
  channel: 'chrome',
  headless: true,
  persistentWindow: true,
  idleTimeoutMs: 2000,
};
const documentHtml = `<html><head><title>Synthetic retained page</title>
<link rel="icon" href="data:,"></head><body><h1>Static intercepted fixture</h1>
<div id="challenge" data-security-challenge="true">Verify you are human</div>
<script>globalThis.retentionMarker='original-synthetic-target';</script></body></html>`;

// The runner stays alive until its deadline while CDP operations await peers.
test.beforeEach((t) => {
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
});

async function cleanupWithinBudget(operation) {
  return Promise.race([
    operation.catch(() => null),
    delay(3000).then(() => null),
  ]);
}

function collectorFor(store, overrides = {}) {
  const cache = new EvidenceCache({
    store,
    offline: true,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const options = { ...browserOptions, ...overrides };
  if (options.persistentWindow === undefined) {
    delete options.persistentWindow;
  }
  return new BrowserCollector({
    store,
    cache,
    browserOptions: options,
    settleMs: 0,
    maxScrolls: 0,
  });
}

async function recovery(directory) {
  return JSON.parse(
    await readFile(join(directory, 'browser-window-recovery.json'), 'utf8')
  );
}

async function targets(observer) {
  const session = await observer.newBrowserCDPSession();
  try {
    return (await session.send('Target.getTargets')).targetInfos
      .filter((entry) => entry.type === 'page')
      .map(({ targetId, url }) => ({ targetId, url }))
      .sort((left, right) => left.targetId.localeCompare(right.targetId));
  } finally {
    await session.detach();
  }
}

async function fixture(t, { challenged = true, browserOverrides = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-retained-challenge-'));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  const collector = collectorFor(store, browserOverrides);
  const clients = [collector];
  const monitoring = {};
  t.after(async () => {
    for (const client of clients) {
      await client.close().catch(() => {});
    }
    const supervisor = await readFile(
      join(directory, 'browser-window.json'),
      'utf8'
    )
      .then(JSON.parse)
      .catch(() => null);
    await closeBrowserWindow(directory).catch(() => {});
    if (monitoring.browser?.isConnected()) {
      const session = await cleanupWithinBudget(
        monitoring.browser.newBrowserCDPSession()
      );
      if (session) {
        await cleanupWithinBudget(session.send('Browser.close'));
        await cleanupWithinBudget(session.detach());
      }
    }
    if (monitoring.browser) {
      await cleanupWithinBudget(monitoring.browser.close());
    }
    if (monitoring.browserPid) {
      await waitProcessExit(monitoring.browserPid);
    }
    if (supervisor?.pid) {
      await waitProcessExit(supervisor.pid);
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });
  try {
    await collector.start();
  } catch (error) {
    error.message += `; underlying control error: ${error.cause?.message || 'none'}`;
    throw error;
  }
  const page = collector.runtime.page;
  const navigations = [];
  const requests = [];
  await page.route('**/*', (route) => {
    const request = route.request();
    requests.push(request.url());
    if (request.isNavigationRequest() && request.url() === fixtureUrl) {
      navigations.push(request.url());
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: documentHtml,
      });
    }
    return route.abort();
  });
  await page.goto(fixtureUrl);
  if (!challenged) {
    await page.locator('#challenge').evaluate((node) => node.remove());
  }
  const original = await recovery(directory);
  monitoring.browserPid = original.browserPid;
  const targetId = await pageTargetId(page);
  const observer = await chromium.connectOverCDP(original.cdpEndpoint, {
    noDefaults: true,
  });
  monitoring.browser = observer;
  const observedPage = observer
    .contexts()[0]
    .pages()
    .find((candidate) => candidate.url() === fixtureUrl);
  assert.ok(observedPage);
  assert.equal(await pageTargetId(observedPage), targetId);
  return {
    directory,
    store,
    collector,
    clients,
    page,
    observer,
    observedPage,
    original,
    targetId,
    navigations,
    requests,
  };
}

async function assertSameWindow(record) {
  const current = await recovery(record.directory);
  assert.equal(current.browserPid, record.original.browserPid);
  assert.equal(current.pid, record.original.pid);
  assert.equal(current.cdpEndpoint, record.original.cdpEndpoint);
  process.kill(current.browserPid, 0);
}

async function assertOriginalDocument(page, targetId) {
  assert.equal(await pageTargetId(page), targetId);
  assert.equal(page.url(), fixtureUrl);
  assert.equal(
    await page.evaluate(() => globalThis.retentionMarker),
    'original-synthetic-target'
  );
  assert.equal(
    await page.evaluate(
      () => globalThis.performance.getEntriesByType('navigation').length
    ),
    1
  );
  assert.equal(
    await page.evaluate(
      () =>
        globalThis.performance
          .getEntriesByType('resource')
          .filter((entry) => /^https?:/u.test(entry.name)).length
    ),
    0
  );
}

async function assertHeadlessStop(collector) {
  const status = await collector.collectionStatus();
  assert.equal(status.active, true);
  assert.equal(status.handoff.status, 'headless-page');
  assert.equal(status.handoff.pageOpen, true);
}

test('native challenge target survives close, independent client restart and idle; resume selects it behind another tab without navigation', async (t) => {
  const record = await fixture(t);
  const { collector, store, observedPage, observer, targetId, directory } =
    record;
  await assert.rejects(collector.assertCollecting(), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).browser.targetId,
    targetId
  );
  await assertHeadlessStop(collector);
  const foreground = await observer.contexts()[0].newPage();
  await foreground.setContent(
    '<html><head><title>Different foreground fixture</title></head><body>Unrelated local tab</body></html>'
  );
  await foreground.bringToFront();
  const before = await targets(observer);
  await collector.close();
  await delay(3500);
  await assertSameWindow(record);
  await assertHeadlessStop(collector);
  await assertOriginalDocument(observedPage, targetId);

  const imports = new URL('../../src/index.js', import.meta.url).href;
  const handoff = new URL(
    '../../src/browser-challenge-handoff.js',
    import.meta.url
  ).href;
  const source = `import {AssociativeStore,BrowserCollector,EvidenceCache,DomainScheduler} from ${JSON.stringify(imports)};
import {pageTargetId} from ${JSON.stringify(handoff)};
const store=new AssociativeStore({directory:process.argv[1],visibility:'private'});
const cache=new EvidenceCache({store,offline:true,scheduler:new DomainScheduler({intervalMs:0})});
const collector=new BrowserCollector({store,cache,browserOptions:JSON.parse(process.argv[2])});
try {
  const before=await collector.collectionStatus();
  let code;try {await collector.resumeCollection();}catch(error){code=error.code;}
  console.log(JSON.stringify({before,code,targetId:await pageTargetId(collector.runtime.page),url:collector.runtime.page.url()}));
}finally {await collector.close();}`;
  const child = await execute(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      source,
      directory,
      JSON.stringify(browserOptions),
    ],
    { timeout: 20000 }
  );
  const restarted = JSON.parse(child.stdout);
  assert.equal(restarted.before.handoff.status, 'headless-page');
  assert.equal(restarted.code, 'COLLECTION_STOPPED');
  assert.equal(restarted.targetId, targetId);
  assert.equal(restarted.url, fixtureUrl);
  assert.deepEqual(await targets(observer), before);
  await assertSameWindow(record);
  const resumedClient = collectorFor(store);
  record.clients.push(resumedClient);
  await assert.rejects(resumedClient.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  await assertOriginalDocument(resumedClient.runtime.page, targetId);
  assert.deepEqual(await targets(observer), before);
  assert.deepEqual(record.navigations, [fixtureUrl]);
  assert.deepEqual(record.requests, [fixtureUrl]);

  // Clearing is a fixture DOM edit, never solving a real CAPTCHA.
  await observedPage.locator('#challenge').evaluate((node) => node.remove());
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.equal((await resumedClient.resumeCollection()).active, false);
  await assertOriginalDocument(resumedClient.runtime.page, targetId);
  await resumedClient.close();
  const deadline = Date.now() + 8000;
  while (
    Date.now() < deadline &&
    (await readFile(join(directory, 'browser-window.json')).catch(() => null))
  ) {
    await delay(100);
  }
  await assert.rejects(readFile(join(directory, 'browser-window.json')), {
    code: 'ENOENT',
  });
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    false
  );
});

test('manual closure of the challenge target makes resume fail without creating any page or window and preserves the active stop', async (t) => {
  const record = await fixture(t);
  await assert.rejects(record.collector.assertCollecting(), {
    code: 'COLLECTION_STOPPED',
  });
  const other = await record.observer.contexts()[0].newPage();
  await other.setContent('<body>Retained unrelated fixture</body>');
  await record.observedPage.close();
  await record.collector.close();
  const before = await targets(record.observer);
  assert.equal(before.length, 1);
  const client = collectorFor(record.store);
  record.clients.push(client);
  await assert.rejects(client.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  assert.deepEqual(await targets(record.observer), before);
  await assertSameWindow(record);
  assert.equal(
    (await record.store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.equal(client.runtime, undefined);
  assert.deepEqual(record.navigations, [fixtureUrl]);
});

test('attached collector retains its own challenged tab when closing the client and leaves the owned browser untouched', async (t) => {
  const record = await fixture(t, { challenged: false });
  const attachedDirectory = await mkdtemp(
    join(tmpdir(), 'lazada-attached-challenge-')
  );
  t.after(() => rm(attachedDirectory, { recursive: true, force: true }));
  const attachedStore = new AssociativeStore({
    directory: attachedDirectory,
    visibility: 'private',
  });
  const attached = collectorFor(attachedStore, {
    cdpEndpoint: record.original.cdpEndpoint,
  });
  record.clients.push(attached);
  await attached.start();
  const owned = attached.runtime.page;
  assert.notEqual(await pageTargetId(owned), record.targetId);
  await owned.route('**/*', (route) =>
    route.request().url() === fixtureUrl
      ? route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: documentHtml,
        })
      : route.abort()
  );
  await owned.goto(fixtureUrl);
  await record.collector.runtime.touch();
  await assert.rejects(attached.assertCollecting(), {
    code: 'COLLECTION_STOPPED',
  });
  const ownedId = await pageTargetId(owned);
  const before = await targets(record.observer);
  await attached.close();
  assert.deepEqual(await targets(record.observer), before);
  assert.ok(before.some((target) => target.targetId === ownedId));
  await assertSameWindow(record);
  assert.equal(
    (await attachedStore.get('collection-stop', COLLECTION_STOP_ID)).browser
      .mode,
    'attached'
  );
  assert.equal(
    (await attachedStore.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

test('capture timeout detecting an actual native challenge preserves that same target and browser beyond idle', async (t) => {
  const record = await fixture(t, { challenged: false });
  await record.page.evaluate(() => {
    const challenge = globalThis.document.createElement('div');
    challenge.setAttribute('data-security-challenge', 'true');
    challenge.textContent = 'Verify you are human';
    globalThis.document.body.append(challenge);
  });
  record.collector.captureTimeoutMs = 75;
  let finish;
  record.collector.capture = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const before = await targets(record.observer);
  await assert.rejects(record.collector.captureWithBudget(fixtureUrl, {}), {
    code: 'COLLECTION_STOPPED',
  });
  finish();
  assert.deepEqual(await targets(record.observer), before);
  await assertOriginalDocument(record.page, record.targetId);
  await record.collector.close();
  await delay(3500);
  await assertSameWindow(record);
  await assertHeadlessStop(record.collector);
  assert.deepEqual(await targets(record.observer), before);
  assert.deepEqual(record.navigations, [fixtureUrl]);
  assert.deepEqual(record.requests, [fixtureUrl]);
});

async function waitProcessExit(pid) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    await delay(50);
  }
  assert.fail('Isolated test supervisor did not exit');
}

for (const signal of ['SIGKILL', 'SIGTERM', 'SIGINT']) {
  test(`active native challenge survives supervisor ${signal} and resume replaces only that supervisor while retaining the exact foreground-independent target`, async (t) => {
    const record = await fixture(t);
    await assert.rejects(record.collector.assertCollecting(), {
      code: 'COLLECTION_STOPPED',
    });
    const foreground = await record.observer.contexts()[0].newPage();
    await foreground.setContent(
      '<body>Local foreground tab during recovery</body>'
    );
    await foreground.bringToFront();
    const before = await targets(record.observer);
    await record.collector.close();
    process.kill(record.original.pid, signal);
    await waitProcessExit(record.original.pid);
    process.kill(record.original.browserPid, 0);

    const client = collectorFor(record.store);
    record.clients.push(client);
    await assertHeadlessStop(client);
    assert.equal((await recovery(record.directory)).pid, record.original.pid);
    assert.deepEqual(await targets(record.observer), before);
    await assertOriginalDocument(record.observedPage, record.targetId);
    let resumeError;
    await assert.rejects(client.resumeCollection(), (error) => {
      resumeError = error;
      assert.equal(error.code, 'COLLECTION_STOPPED');
      return true;
    });
    assert.ok(
      client.runtime,
      `Original target was not reattached: ${resumeError.cause?.stack || resumeError.stack}`
    );
    const replacement = await recovery(record.directory);
    assert.notEqual(replacement.pid, record.original.pid);
    assert.equal(replacement.browserPid, record.original.browserPid);
    assert.equal(
      new URL(replacement.cdpEndpoint).href,
      new URL(record.original.cdpEndpoint).href
    );
    assert.deepEqual(await targets(record.observer), before);
    await assertOriginalDocument(client.runtime.page, record.targetId);
    assert.equal(
      (await record.store.get('collection-stop', COLLECTION_STOP_ID)).active,
      true
    );
    assert.equal(
      (await record.store.get('collection-stop', COLLECTION_STOP_ID)).browser
        .targetId,
      record.targetId
    );
    assert.deepEqual(record.navigations, [fixtureUrl]);
    assert.deepEqual(record.requests, [fixtureUrl]);
    await client.close();
    await delay(3500);
    const retained = await recovery(record.directory);
    assert.equal(retained.pid, replacement.pid);
    assert.equal(retained.browserPid, record.original.browserPid);
    await assertHeadlessStop(client);
    assert.deepEqual(await targets(record.observer), before);
    if (signal === 'SIGTERM') {
      // The replacement supervisor adopts an existing CDP browser. Its later
      // graceful detach must preserve that browser as well as the first one.
      process.kill(replacement.pid, 'SIGINT');
      await waitProcessExit(replacement.pid);
      process.kill(record.original.browserPid, 0);
      const adoptedClient = collectorFor(record.store);
      record.clients.push(adoptedClient);
      await assertHeadlessStop(adoptedClient);
      await assert.rejects(adoptedClient.resumeCollection(), {
        code: 'COLLECTION_STOPPED',
      });
      const adoptedReplacement = await recovery(record.directory);
      assert.notEqual(adoptedReplacement.pid, replacement.pid);
      assert.notEqual(adoptedReplacement.pid, record.original.pid);
      assert.equal(adoptedReplacement.browserPid, record.original.browserPid);
      await assertOriginalDocument(adoptedClient.runtime.page, record.targetId);
      assert.deepEqual(await targets(record.observer), before);
      assert.equal(
        (await record.store.get('collection-stop', COLLECTION_STOP_ID)).active,
        true
      );
      assert.deepEqual(record.navigations, [fixtureUrl]);
      assert.deepEqual(record.requests, [fixtureUrl]);
    }
  });
}

test('a pre-started collector on another clear same-origin target cannot resume the original challenge or change any targets/navigation', async (t) => {
  const record = await fixture(t);
  await assert.rejects(record.collector.assertCollecting(), {
    code: 'COLLECTION_STOPPED',
  });
  const clearUrl = new URL('synthetic-clear-i101.html', fixtureUrl).href;
  const clearPage = await record.observer.contexts()[0].newPage();
  const clearNavigations = [];
  await clearPage.route('**/*', (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url() === clearUrl
    ) {
      clearNavigations.push(route.request().url());
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<html><head><title>Clear same-origin fixture</title><link rel="icon" href="data:,"></head><body>This synthetic tab has no challenge</body></html>',
      });
    }
    return route.abort();
  });
  await clearPage.goto(clearUrl);
  await clearPage.bringToFront();
  const clearTarget = await pageTargetId(clearPage);
  const client = collectorFor(record.store);
  record.clients.push(client);
  await client.start({ existingOnly: true, targetId: clearTarget });
  assert.equal(await pageTargetId(client.runtime.page), clearTarget);
  assert.notEqual(clearTarget, record.targetId);
  assert.equal(
    new URL(client.runtime.page.url()).origin,
    new URL(fixtureUrl).origin
  );
  const before = await targets(record.observer);
  const beforeStop = await record.store.get(
    'collection-stop',
    COLLECTION_STOP_ID
  );
  await assert.rejects(client.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  assert.deepEqual(await targets(record.observer), before);
  assert.deepEqual(
    await record.store.get('collection-stop', COLLECTION_STOP_ID),
    beforeStop
  );
  assert.equal(beforeStop.active, true);
  assert.equal(beforeStop.browser.targetId, record.targetId);
  assert.equal(client.challengePage, undefined);
  assert.equal(await pageTargetId(client.runtime.page), clearTarget);
  await assertOriginalDocument(record.observedPage, record.targetId);
  await assertSameWindow(record);
  assert.deepEqual(record.navigations, [fixtureUrl]);
  assert.deepEqual(clearNavigations, [clearUrl]);
});

test('a second registered same-origin challenged tab cannot replace the saved original target through phone-login retention', async (t) => {
  const record = await fixture(t);
  await assert.rejects(record.collector.assertCollecting(), {
    code: 'COLLECTION_STOPPED',
  });
  const beforeStop = await record.store.get(
    'collection-stop',
    COLLECTION_STOP_ID
  );
  const secondUrl = new URL('synthetic-second-challenge-i102.html', fixtureUrl)
    .href;
  const second = await record.observer.contexts()[0].newPage();
  const secondNavigations = [];
  await second.route('**/*', (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url() === secondUrl
    ) {
      secondNavigations.push(route.request().url());
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: documentHtml,
      });
    }
    return route.abort();
  });
  await second.goto(secondUrl);
  await second.bringToFront();
  const secondTarget = await pageTargetId(second);
  const client = collectorFor(record.store);
  record.clients.push(client);
  await client.start({ existingOnly: true, targetId: secondTarget });
  assert.equal(await pageTargetId(client.runtime.page), secondTarget);
  const before = await targets(record.observer);
  assert.equal(
    (await phoneLoginState(client.runtime.page)).status,
    'challenge'
  );
  assert.deepEqual(
    await record.store.get('collection-stop', COLLECTION_STOP_ID),
    beforeStop
  );
  if (client.challengePage) {
    assert.equal(await pageTargetId(client.challengePage), record.targetId);
  }
  await client.runtime.page
    .locator('#challenge')
    .evaluate((node) => node.remove());
  await assert.rejects(client.resumeCollection(), {
    code: 'COLLECTION_STOPPED',
  });
  assert.deepEqual(
    await record.store.get('collection-stop', COLLECTION_STOP_ID),
    beforeStop
  );
  assert.equal(
    (await phoneLoginState(record.observedPage)).status,
    'challenge'
  );
  assert.deepEqual(await targets(record.observer), before);
  await assertOriginalDocument(record.observedPage, record.targetId);
  await assertSameWindow(record);
  assert.deepEqual(record.navigations, [fixtureUrl]);
  assert.deepEqual(secondNavigations, [secondUrl]);
});

async function waitWindowClosed(directory) {
  const path = join(directory, 'browser-window.json');
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && (await readFile(path).catch(() => null))) {
    await delay(100);
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' });
}

for (const [name, value] of [
  ['missing default', undefined],
  ['explicit false', false],
]) {
  test(`real Chrome ${name} persistentWindow retains a challenge on close and permits normal close only after explicit fixture resume`, async (t) => {
    const overrides = { persistentWindow: value };
    const record = await fixture(t, { browserOverrides: overrides });
    assert.equal(record.collector.persistent, true);
    if (value === undefined) {
      assert.equal(
        Object.hasOwn(record.collector.browserOptions, 'persistentWindow'),
        false
      );
    }
    await assert.rejects(record.collector.assertCollecting(), {
      code: 'COLLECTION_STOPPED',
    });
    const before = await targets(record.observer);
    await record.collector.close();
    await delay(3500);
    await assertSameWindow(record);
    await assertHeadlessStop(record.collector);
    assert.deepEqual(await targets(record.observer), before);
    const client = collectorFor(record.store, overrides);
    record.clients.push(client);
    await assert.rejects(client.resumeCollection(), {
      code: 'COLLECTION_STOPPED',
    });
    await assertOriginalDocument(client.runtime.page, record.targetId);
    await record.observedPage
      .locator('#challenge')
      .evaluate((node) => node.remove());
    assert.equal((await client.resumeCollection()).active, false);
    await client.close();
    await waitWindowClosed(record.directory);
    assert.equal(
      (await record.store.get('collection-stop', COLLECTION_STOP_ID)).active,
      false
    );
    assert.deepEqual(record.navigations, [fixtureUrl]);
  });
}

test('explicit persistentWindow false closes an unchallenged real Chrome supervisor and browser normally', async (t) => {
  const record = await fixture(t, {
    challenged: false,
    browserOverrides: { persistentWindow: false },
  });
  assert.equal(record.collector.persistent, true);
  await record.collector.close();
  await waitWindowClosed(record.directory);
  await waitProcessExit(record.original.browserPid);
  assert.equal(
    await record.store.get('collection-stop', COLLECTION_STOP_ID),
    undefined
  );
  assert.deepEqual(record.navigations, [fixtureUrl]);
});
