import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { connectPersistentBrowser } from './browser-connection.js';
import { pacePersistentHost } from './browser-pacing.js';

export const BROWSER_IDLE_MS = 30 * 60 * 1000;

async function recoveryTarget(directory, targetId) {
  try {
    const recovery = JSON.parse(
      await readFile(join(directory, 'browser-window-recovery.json'), 'utf8')
    );
    process.kill(recovery.browserPid, 0);
    const endpoint = new URL(recovery.cdpEndpoint);
    if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') {
      return false;
    }
    const response = await fetch(new URL('/json/list', endpoint), {
      signal: AbortSignal.timeout(2000),
    });
    const targets = await response.json();
    return (
      response.ok &&
      targets.some((target) => target.type === 'page' && target.id === targetId)
    );
  } catch {
    return false;
  }
}

// Read-only: checking a stopped collection must never create a window or tab.
export async function browserWindowStatus(directory, targetId) {
  const state = await descriptor(directory);
  if (!state) {
    const pageOpen = await recoveryTarget(directory, targetId);
    return { status: pageOpen ? 'page-open' : 'window-closed', pageOpen };
  }
  try {
    const status = await request(state, 'status', { targetId });
    return {
      status: status.pageOpen ? 'page-open' : 'window-closed',
      pageOpen: status.pageOpen === true,
    };
  } catch {
    if (await recoveryTarget(directory, targetId)) {
      return { status: 'page-open', pageOpen: true };
    }
    return { status: 'window-unreachable', pageOpen: false };
  }
}

async function descriptor(directory) {
  try {
    return JSON.parse(
      await readFile(join(directory, 'browser-window.json'), 'utf8')
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function request(state, action, body = {}) {
  const endpoint = new URL(state.controlEndpoint);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') {
    throw new Error('Persistent browser control must use loopback HTTP');
  }
  const response = await fetch(new URL(action, endpoint), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${state.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ pid: process.pid, ...body }),
    signal: AbortSignal.timeout(3000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Persistent browser is unavailable');
  }
  return result;
}

async function available(directory) {
  const state = await descriptor(directory);
  if (!state) {
    return undefined;
  }
  try {
    return (await request(state, 'status')).available ? state : undefined;
  } catch (error) {
    if (Number.isInteger(state.pid) && state.pid > 0) {
      try {
        process.kill(state.pid, 0);
      } catch (failure) {
        if (failure.code === 'ESRCH') {
          return undefined;
        }
      }
      throw new Error(
        'The existing persistent browser worker is unreachable; reconnect with loopback access before launching another worker',
        { cause: error }
      );
    }
    return undefined;
  }
}

async function launchWorker(directory, options) {
  const lock = join(directory, 'browser-window-starting');
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    if (Date.now() - (await stat(lock)).mtimeMs > 45000) {
      await rm(lock, { recursive: true, force: true });
      return launchWorker(directory, options);
    }
    return;
  }
  try {
    const config = join(directory, 'browser-window-options.json');
    await rm(join(directory, 'browser-window-error.txt'), { force: true });
    await writeFile(config, JSON.stringify({ debug: false, ...options }), {
      mode: 0o600,
    });
    const worker = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('./persistent-browser-worker.js', import.meta.url)
        ),
        directory,
      ],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      }
    );
    worker.unref();
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
}

async function prepareAcquisition(directory, options) {
  if (options.existingOnly && !options.targetId) {
    throw new Error('Resuming requires the original challenge tab identity');
  }
  const idleMs = options.idleTimeoutMs ?? BROWSER_IDLE_MS;
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new Error('Browser idle timeout must be positive');
  }
  if (!options.existingOnly) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return idleMs;
}

export async function acquireBrowserWindow(directory, options = {}) {
  const idleMs = await prepareAcquisition(directory, options);
  let state = await available(directory);
  if (
    options.existingOnly &&
    !state &&
    !(await recoveryTarget(directory, options.targetId))
  ) {
    throw new Error('The original challenge window is no longer available');
  }
  if (!state) {
    await launchWorker(directory, { ...options, idleTimeoutMs: idleMs });
  }
  const deadline = Date.now() + 45000;
  while (!state && Date.now() < deadline) {
    await delay(100);
    state = await available(directory);
    if (!state) {
      const failure = await readFile(
        join(directory, 'browser-window-error.txt'),
        'utf8'
      ).catch(() => undefined);
      if (failure) {
        throw new Error(failure);
      }
    }
  }
  if (!state) {
    throw new Error('Persistent browser did not become ready');
  }
  const lease = await request(state, 'acquire', { idleMs });
  try {
    const runtime = await connectPersistentBrowser({
      engine: 'playwright',
      cdpEndpoint: lease.cdpEndpoint,
      timeout: 30000,
      ...(options.existingOnly
        ? { targetId: options.targetId, fallback: false }
        : {}),
    });
    runtime.persistent = true;
    runtime.touch = () => request(state, 'touch');
    runtime.pace = (url, intervalMs) =>
      pacePersistentHost(directory, url, intervalMs, { touch: runtime.touch });
    const disconnect = runtime.browser.close.bind(runtime.browser);
    runtime.release = async () => {
      await disconnect();
      await request(state, 'release').catch(() => {});
    };
    return runtime;
  } catch (error) {
    await request(state, 'release').catch(() => {});
    throw error;
  }
}

export async function closeBrowserWindow(directory) {
  const state = await descriptor(directory);
  if (state) {
    await request(state, 'shutdown');
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && (await descriptor(directory))) {
      await delay(100);
    }
    if (await descriptor(directory)) {
      throw new Error('The persistent browser did not close');
    }
  }
}
