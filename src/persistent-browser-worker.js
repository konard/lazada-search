import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchBrowser, saveStorageState } from 'browser-commander';
import { connectPersistentBrowser } from './browser-connection.js';
import { AssociativeStore } from './store.js';
import { COLLECTION_STOP_ID } from './page-challenge.js';
import { atomicWrite } from './util.js';

const directory = process.argv[2];
const stateFile = join(directory, 'browser-window.json');
const errorFile = join(directory, 'browser-window-error.txt');
const recoveryFile = join(directory, 'browser-window-recovery.json');
const lock = join(directory, 'browser-window-starting');
const store = new AssociativeStore({ directory });
let runtime;
let server;
let stopping;
let lastUsed = Date.now();
let owner;
let idleMs;
let adopted = false;
let sessionFile;
let releasingSupervisor = false;
let reconnectOnly = false;

async function removeOwnedState(path) {
  const state = JSON.parse(await readFile(path, 'utf8').catch(() => 'null'));
  if (state?.pid === process.pid) {
    await rm(path, { force: true });
  }
}

async function openWindow(options) {
  const recovery = JSON.parse(
    await readFile(recoveryFile, 'utf8').catch(() => 'null')
  );
  if (!recovery || !alive(recovery.browserPid)) {
    if (options.existingOnly) {
      throw new Error('The original challenge window is no longer available');
    }
    return launchBrowser(options);
  }
  if (alive(recovery.pid)) {
    throw new Error(
      'An existing browser worker still owns the recovery window'
    );
  }
  const endpoint = new URL(recovery.cdpEndpoint);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') {
    throw new Error('Browser recovery requires a loopback CDP endpoint');
  }
  const connected = await connectPersistentBrowser({
    engine: 'playwright',
    cdpEndpoint: endpoint.href,
    timeout: 30000,
    ...(options.existingOnly
      ? { targetId: options.targetId, fallback: false }
      : {}),
  });
  adopted = true;
  connected.browserPid = recovery.browserPid;
  connected.cdpEndpoint = endpoint.href;
  return connected;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shutdown() {
  stopping ??= (async () => {
    server?.close();
    if (adopted) {
      if (sessionFile) {
        const state = await saveStorageState(runtime.page).catch(() => null);
        if (state) {
          await atomicWrite(
            sessionFile,
            JSON.stringify({
              cookies: state.cookies.filter((cookie) => !(cookie.expires > 0)),
              origins: [],
            })
          );
        }
      }
      await runtime.browser
        .newBrowserCDPSession()
        .then((session) => session.send('Browser.close'))
        .catch(() => {});
    }
    if (runtime?.close) {
      await runtime.close().catch(() => {});
    } else {
      await runtime?.detach?.().catch(() => {});
    }
    await removeOwnedState(stateFile);
    await removeOwnedState(recoveryFile);
    await rm(lock, { recursive: true, force: true });
  })();
  return stopping;
}

async function windowStatus(targetId) {
  const browser = runtime.page.context().browser();
  const available = !stopping && browser?.isConnected();
  const session = available ? await browser.newBrowserCDPSession() : null;
  try {
    const targets = session
      ? (await session.send('Target.getTargets')).targetInfos
      : [];
    return {
      available: available && targets.some((target) => target.type === 'page'),
      pageOpen: targets.some(
        (target) => target.type === 'page' && target.targetId === targetId
      ),
    };
  } finally {
    await session?.detach();
  }
}

function handle(action, input) {
  if (action === 'status') {
    return windowStatus(input.targetId);
  }
  if (stopping) {
    throw new Error('The persistent browser is closing');
  }
  if (action === 'acquire') {
    if (owner && owner !== input.pid && alive(owner)) {
      throw new Error('The persistent browser is busy in another collector');
    }
    owner = input.pid;
    idleMs = input.idleMs;
    lastUsed = Date.now();
    return { cdpEndpoint: runtime.cdpEndpoint };
  }
  if (action === 'touch' || action === 'release') {
    if (owner !== input.pid) {
      throw new Error('The browser lease belongs to another collector');
    }
    lastUsed = Date.now();
    if (action === 'release') {
      owner = undefined;
    }
    return { ok: true };
  }
  if (action === 'shutdown') {
    if (owner && owner !== input.pid && alive(owner)) {
      throw new Error('The browser is still in use');
    }
    return { closing: true };
  }
  throw new Error('Unknown browser control action');
}

async function challengePagePending() {
  const stop = await store.get('collection-stop', COLLECTION_STOP_ID);
  return stop?.active &&
    stop.browser?.mode === 'persistent' &&
    stop.browser.targetId
    ? (await handle('status', { targetId: stop.browser.targetId })).pageOpen
    : false;
}

async function stopSupervisor() {
  if (!(await challengePagePending())) {
    await shutdown();
    return;
  }
  // A graceful supervisor restart detaches, preserving the original browser.
  // Explicit shutdown/manual browser closure still use the owned closer.
  releasingSupervisor = true;
  server?.close();
  await removeOwnedState(stateFile);
  await runtime.detach?.();
  process.exit(0);
}

async function serve(token, req, res) {
  res.setHeader('content-type', 'application/json');
  if (
    req.method !== 'POST' ||
    req.headers.authorization !== `Bearer ${token}`
  ) {
    res.writeHead(403).end('{"error":"Unauthorized"}');
    return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2048) {
        throw new Error('Control request is too large');
      }
    }
    const action = req.url.slice(1);
    res.end(JSON.stringify(await handle(action, JSON.parse(body))));
    if (action === 'shutdown') {
      await shutdown();
    }
  } catch (error) {
    res.writeHead(409).end(JSON.stringify({ error: error.message }));
  }
}

try {
  await rm(errorFile, { force: true });
  const options = JSON.parse(
    await readFile(join(directory, 'browser-window-options.json'), 'utf8')
  );
  reconnectOnly = options.existingOnly === true;
  idleMs = options.idleTimeoutMs;
  delete options.idleTimeoutMs;
  delete options.persistentWindow;
  if (options.persistSessionCookies && options.userDataDir) {
    sessionFile =
      typeof options.persistSessionCookies === 'string'
        ? options.persistSessionCookies
        : join(options.userDataDir, 'browser-commander-session.json');
  }
  const existingInterruptHandlers = new Set(process.listeners('SIGINT'));
  runtime = await openWindow(options);
  // Browser Commander's managed launch installs child SIGINT forwarding.
  // This dedicated supervisor owns cancellation and must decide whether to
  // close the browser or detach from a pending challenge before any forwarding.
  for (const handler of process.listeners('SIGINT')) {
    if (!existingInterruptHandlers.has(handler)) {
      process.removeListener('SIGINT', handler);
    }
  }
  if (!runtime.cdpEndpoint) {
    throw new Error(
      'Persistent windows require Browser Commander real-browser launch'
    );
  }
  // Real user interaction keeps the window alive; background polling does not.
  const context = runtime.page.context();
  await context.exposeBinding('__lazadaWindowActivity', () => {
    lastUsed = Date.now();
  });
  const activity = () => {
    for (const event of ['pointerdown', 'keydown', 'wheel']) {
      globalThis.addEventListener(
        event,
        () => {
          globalThis.__lazadaWindowActivity();
        },
        { passive: true }
      );
    }
  };
  await context.addInitScript(activity);
  for (const page of context.pages()) {
    await page.evaluate(activity).catch(() => {});
  }
  const token = randomBytes(32).toString('hex');
  server = createServer((req, res) => {
    void serve(token, req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Recovery must be complete before publishing readiness. Readers may poll
  // these files while a worker starts or replaces a stopped supervisor.
  await atomicWrite(
    recoveryFile,
    JSON.stringify({
      pid: process.pid,
      browserPid: runtime.browserProcess?.pid || runtime.browserPid,
      cdpEndpoint: runtime.cdpEndpoint,
    })
  );
  await atomicWrite(
    stateFile,
    JSON.stringify({
      pid: process.pid,
      token,
      controlEndpoint: `http://127.0.0.1:${server.address().port}/`,
    })
  );
  await rm(lock, { recursive: true, force: true });
  runtime.browserProcess?.once('exit', () => {
    void shutdown();
  });
  if (adopted) {
    runtime.browser.once('disconnected', () => {
      if (!releasingSupervisor) {
        void shutdown();
      }
    });
  }
  process.once('SIGTERM', () => {
    void stopSupervisor();
  });
  process.once('SIGINT', () => {
    void stopSupervisor();
  });
  while (!stopping && !releasingSupervisor) {
    await delay(Math.min(1000, idleMs));
    if (
      !releasingSupervisor &&
      Date.now() - lastUsed >= idleMs &&
      !(await challengePagePending()) &&
      !releasingSupervisor
    ) {
      await shutdown();
    }
  }
} catch (error) {
  await atomicWrite(errorFile, error.message).catch(() => {});
  if (reconnectOnly && adopted) {
    // A failed supervisor attach does not own the borrowed challenge window.
    releasingSupervisor = true;
    server?.close();
    await runtime?.detach?.().catch(() => {});
    await removeOwnedState(stateFile);
    await rm(lock, { recursive: true, force: true });
  } else {
    await shutdown();
  }
  process.exitCode = 1;
}
