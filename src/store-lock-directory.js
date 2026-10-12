import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { readOptional } from './util.js';

// Windows can briefly deny creating/reading a lock during pending deletion.
// Retry only that platform/error; EEXIST still goes through the owner checks.
async function retryPendingDeletion(operation, platform) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (platform !== 'win32' || error.code !== 'EPERM' || attempt >= 3) {
        throw error;
      }
      await delay(25);
    }
  }
}

export async function createStoreLockDirectory(
  path,
  { create = mkdir, platform = process.platform } = {}
) {
  return await retryPendingDeletion(() => create(path), platform);
}

// A contender may observe the owner file during another writer's removal.
// Permission errors never establish an absent/dead owner or grant ownership.
export async function readStoreLockOwner(
  path,
  { read = readOptional, platform = process.platform } = {}
) {
  return await retryPendingDeletion(() => read(path, 'utf8'), platform);
}
