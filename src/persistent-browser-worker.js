import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  launchBrowser,
  connectBrowser,
  saveStorageState,
} from 'browser-commander';

const directory = process.argv[2];
const stateFile = join(directory, 'browser-window.json');
const errorFile = join(directory, 'browser-window-error.txt');
const recoveryFile = join(directory, 'browser-window-recovery.json');
const lock = join(directory, 'browser-window-starting');
let runtime;
let server;
let stopping;
let lastUsed = Date.now();
let owner;
let idleMs;
let adopted = false;
let sessionFile;

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
  const connected = await connectBrowser({
    engine: 'playwright',
    cdpEndpoint: endpoint.href,
    timeout: 30000,
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
          await writeFile(
            sessionFile,
            JSON.stringify({
              cookies: state.cookies.filter((cookie) => !(cookie.expires > 0)),
              origins: [],
            }),
            { mode: 0o600 }
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

function handle(action, input) {
  if (action === 'status') {
    return { available: !stopping };
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
    res.end(JSON.stringify(handle(action, JSON.parse(body))));
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
  idleMs = options.idleTimeoutMs;
  delete options.idleTimeoutMs;
  delete options.persistentWindow;
  if (options.persistSessionCookies && options.userDataDir) {
    sessionFile =
      typeof options.persistSessionCookies === 'string'
        ? options.persistSessionCookies
        : join(options.userDataDir, 'browser-commander-session.json');
  }
  runtime = await openWindow(options);
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
  await writeFile(
    stateFile,
    JSON.stringify({
      pid: process.pid,
      token,
      controlEndpoint: `http://127.0.0.1:${server.address().port}/`,
    }),
    { mode: 0o600 }
  );
  await writeFile(
    recoveryFile,
    JSON.stringify({
      pid: process.pid,
      browserPid: runtime.browserProcess?.pid || runtime.browserPid,
      cdpEndpoint: runtime.cdpEndpoint,
    }),
    { mode: 0o600 }
  );
  await rm(lock, { recursive: true, force: true });
  runtime.browserProcess?.once('exit', () => {
    void shutdown();
  });
  if (adopted) {
    runtime.browser.once('disconnected', () => {
      void shutdown();
    });
  }
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
  while (!stopping) {
    await delay(Math.min(1000, idleMs));
    if (Date.now() - lastUsed >= idleMs) {
      await shutdown();
    }
  }
} catch (error) {
  await writeFile(errorFile, error.message, { mode: 0o600 }).catch(() => {});
  await shutdown();
  process.exitCode = 1;
}
