import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');
export const clone = (value) => JSON.parse(JSON.stringify(value));
export { normalizeText, fold, canonicalUrl, listingKey } from './text.js';

export { positive } from './values.js';

export async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    // Windows does not support opening a directory for fsync. The file
    // itself is synced on every platform before its atomic rename.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function readOptional(path, encoding) {
  try {
    return await readFile(path, encoding);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function valueAt(object, path) {
  return path
    .split('/')
    .filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}
