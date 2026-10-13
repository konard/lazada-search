import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite } from './util.js';

export async function pacePersistentHost(
  directory,
  url,
  intervalMs,
  options = {}
) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new Error('Persistent host interval must be finite and nonnegative');
  }
  const now = options.now || Date.now;
  const wait = options.wait || delay;
  const file = join(directory, 'browser-request-times.json');
  const times = JSON.parse(
    await readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') {
        return '{}';
      }
      throw error;
    })
  );
  const host = new URL(url).hostname;
  const previous = times[host];
  if (previous !== undefined && !Number.isFinite(previous)) {
    throw new Error('Persistent host timestamp must be finite');
  }
  const allowedAt = (previous ?? -Infinity) + intervalMs;
  while (now() < allowedAt) {
    await wait(Math.max(1, Math.ceil(allowedAt - now())));
  }
  times[host] = now();
  await atomicWrite(file, JSON.stringify(times));
  await options.touch?.();
  return times[host];
}
