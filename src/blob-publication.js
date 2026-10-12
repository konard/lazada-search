import { randomUUID } from 'node:crypto';
import { mkdir, open, link, readFile, rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { sha256 } from './util.js';

const filesystem = { mkdir, open, link, readFile, rm };

async function existingBlob(path, bytes, digest, io) {
  let existing;
  try {
    existing = await io.readFile(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (sha256(existing) !== digest || !Buffer.from(existing).equals(bytes)) {
    throw new Error('Corrupt evidence blob');
  }
  return true;
}

/** Publishes complete immutable bytes with an exclusive canonical name. */
export async function publishContentAddressedBlob(
  path,
  contents,
  { operations, platform = process.platform } = {}
) {
  const bytes = Buffer.from(contents);
  const digest = sha256(bytes);
  if (basename(path) !== digest) {
    throw new Error('Blob destination does not match its content digest');
  }
  const io = { ...filesystem, ...operations };
  if (await existingBlob(path, bytes, digest, io)) {
    return;
  }
  const parent = dirname(path);
  await io.mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let owned = false;
  try {
    const file = await io.open(temporary, 'wx', 0o600);
    owned = true;
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await io.link(temporary, path);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) {
        throw error;
      }
      // A competing writer must have committed the exact complete bytes.
      // Permissions without that winner remain a genuine publication failure.
      if (!(await existingBlob(path, bytes, digest, io))) {
        throw error;
      }
    }
  } finally {
    if (owned) {
      await io.rm(temporary, { force: true });
    }
  }
  if (platform !== 'win32') {
    const directory = await io.open(parent, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
