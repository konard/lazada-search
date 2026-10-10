import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from './util.js';

export const BROWSER_IDLE_MS = 30 * 60 * 1000;

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
    await writeFile(config, JSON.stringify(options), { mode: 0o600 });
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

export async function acquireBrowserWindow(directory, options = {}) {
  const idleMs = options.idleTimeoutMs ?? BROWSER_IDLE_MS;
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new Error('Browser idle timeout must be positive');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let state = await available(directory);
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
    const { connectBrowser } = await import('browser-commander');
    const runtime = await connectBrowser({
      engine: 'playwright',
      cdpEndpoint: lease.cdpEndpoint,
      timeout: 30000,
    });
    runtime.persistent = true;
    runtime.touch = () => request(state, 'touch');
    runtime.pace = async (url, intervalMs) => {
      const file = join(directory, 'browser-request-times.json');
      const times = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
      const host = new URL(url).hostname;
      const waitMs = Math.max(
        0,
        (times[host] ?? -Infinity) + intervalMs - Date.now()
      );
      if (waitMs) {
        await delay(waitMs);
      }
      times[host] = Date.now();
      await atomicWrite(file, JSON.stringify(times));
      await runtime.touch();
    };
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
  const state = await available(directory);
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
