import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { encode, decode } from 'lino-objects-codec';
import { DoubletGraph } from './doublets.js';
import { atomicWrite, clone, readOptional, sha256, valueAt } from './util.js';

const validKind = (kind) => {
  if (!/^[a-z][a-z-]*$/u.test(kind)) {
    throw new Error('Invalid record kind');
  }
  return kind;
};

export class AssociativeStore {
  constructor({ directory = '.lazada-search' } = {}) {
    this.directory = resolve(directory);
  }

  recordPath(kind, id) {
    return join(this.directory, validKind(kind), `${sha256(String(id))}.lino`);
  }

  async locked(action) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, '.write-lock');
    const deadline = Date.now() + 30000;
    for (;;) {
      try {
        await mkdir(lock);
        await atomicWrite(join(lock, 'owner'), String(process.pid));
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
        const owner = Number(await readOptional(join(lock, 'owner'), 'utf8'));
        let dead = false;
        if (Number.isSafeInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (failure) {
            dead = failure.code === 'ESRCH';
          }
        } else {
          try {
            dead = Date.now() - (await stat(lock)).mtimeMs > 1000;
          } catch {
            /* Another process released the lock. */
          }
        }
        if (dead) {
          await rm(lock, { recursive: true, force: true });
        } else if (Date.now() > deadline) {
          throw new Error('Timed out waiting for store writer');
        } else {
          await delay(25);
        }
      }
    }
    try {
      return await action();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }

  async put(kind, input) {
    const record = clone(input);
    if (typeof record.id !== 'string' || !record.id) {
      throw new Error('Records require a nonempty string id');
    }
    const path = this.recordPath(kind, record.id);
    const notation = encode({ obj: record });
    await this.locked(async () => {
      if ((await readOptional(path, 'utf8')) === notation) {
        return;
      }
      // Canonical text commits first. A failed or interrupted binary write is
      // rebuilt on read from the exact canonical file and its digest.
      await atomicWrite(path, notation);
      await this.project(kind, record, notation, path);
    });
    return record;
  }

  async project(kind, record, notation, path) {
    const graph = new DoubletGraph();
    graph.addRecord(kind, record);
    const bytes = graph.toBinary();
    await atomicWrite(path.replace(/\.lino$/u, '.links'), bytes);
    await atomicWrite(`${path}.sha256`, `${sha256(notation)}:${sha256(bytes)}`);
    return graph;
  }

  async get(kind, id) {
    const text = await readOptional(this.recordPath(kind, id), 'utf8');
    return text === undefined ? undefined : decode({ notation: text });
  }

  async graph(kind, id) {
    return await this.locked(async () => {
      const path = this.recordPath(kind, id);
      const notation = await readOptional(path, 'utf8');
      if (notation === undefined) {
        return undefined;
      }
      const bytes = await readOptional(path.replace(/\.lino$/u, '.links'));
      const digest = await readOptional(`${path}.sha256`, 'utf8');
      if (bytes && digest === `${sha256(notation)}:${sha256(bytes)}`) {
        try {
          return DoubletGraph.fromBinary(bytes);
        } catch {
          /* Repair projection. */
        }
      }
      return this.project(kind, decode({ notation }), notation, path);
    });
  }

  async list(kind, { path, value } = {}) {
    let files;
    try {
      files = await readdir(join(this.directory, validKind(kind)));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const records = [];
    for (const file of files.sort().filter((name) => name.endsWith('.lino'))) {
      const record = decode({
        notation: await readOptional(join(this.directory, kind, file), 'utf8'),
      });
      if (path === undefined || valueAt(record, path) === value) {
        records.push(record);
      }
    }
    return records;
  }

  async putBlob(contents) {
    const bytes = Buffer.from(contents);
    const id = sha256(bytes);
    const path = join(this.directory, 'blobs', id.slice(0, 2), id);
    if (!(await readOptional(path))) {
      await atomicWrite(path, bytes);
    }
    return { sha256: id, bytes: bytes.length };
  }

  async blob(id) {
    if (!/^[a-f\d]{64}$/u.test(id)) {
      throw new Error('Invalid blob hash');
    }
    const bytes = await readOptional(
      join(this.directory, 'blobs', id.slice(0, 2), id)
    );
    if (bytes && sha256(bytes) !== id) {
      throw new Error('Corrupt evidence blob');
    }
    return bytes;
  }

  async exportGraph() {
    const graph = new DoubletGraph();
    for (const kind of (await readdir(this.directory)).filter(
      (entry) =>
        /^[a-z][a-z-]*$/u.test(entry) &&
        entry !== 'blobs' &&
        entry !== 'browser-profile'
    )) {
      for (const record of await this.list(kind)) {
        graph.addRecord(kind, record);
      }
    }
    return graph;
  }
}
