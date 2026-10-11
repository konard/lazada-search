import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Windows can briefly deny recreation of a directory whose deletion is pending.
// Retry only that platform/error; EEXIST still goes through the owner checks.
export async function createStoreLockDirectory(
  path,
  { create = mkdir, platform = process.platform } = {}
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await create(path);
    } catch (error) {
      if (platform !== 'win32' || error.code !== 'EPERM' || attempt >= 3) {
        throw error;
      }
      await delay(25);
    }
  }
}
