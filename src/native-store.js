import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Parser } from 'links-notation';
import { encode } from 'lino-objects-codec';
import { atomicWrite, readOptional, sha256 } from './util.js';

const execute = promisify(execFile);
const linkKey = (link) =>
  JSON.stringify([link.id, link.values.map((value) => value.id)]);

export class NativeLinkStore {
  constructor({ command = 'clink', run = execute } = {}) {
    this.command = command;
    this.run = run;
  }

  async capabilities() {
    this.help ??= this.run(this.command, ['--help'], {
      timeout: 10000,
      maxBuffer: 1024 ** 2,
    });
    const { stdout } = await this.help;
    if (
      !['--import', '--export', '--import-binary', '--export-binary'].every(
        (flag) => stdout.includes(flag)
      )
    ) {
      throw new Error(
        'Native store requires link-cli text and binary import/export support; install Rust link-cli 1.0.0 or newer and set --clink-command'
      );
    }
  }

  async cached(target, digest, links) {
    try {
      const metadata = JSON.parse(
        await readOptional(join(target, 'manifest.json'), 'utf8')
      );
      const names = new Set(metadata.files.map((file) => file.name));
      if (
        metadata.sha256 !== digest ||
        metadata.links !== links ||
        ![
          'input.lino',
          'atoms.lino',
          'export.lino',
          'store.db',
          'data.links',
        ].every((name) => names.has(name)) ||
        !metadata.files.every(
          ({ name, hash }) =>
            /^[\w.-]+$/u.test(name) && /^[a-f\d]{64}$/u.test(hash)
        )
      ) {
        return false;
      }
      const files = await Promise.all(
        metadata.files.map(async ({ name, hash }) => {
          const bytes = await readOptional(join(target, name));
          return bytes && sha256(bytes) === hash;
        })
      );
      return files.every(Boolean);
    } catch {
      return false;
    }
  }

  async project(directory, graph) {
    const notation = graph.toNotation({ numericIds: true });
    const atoms = encode({
      obj: Object.fromEntries([...graph.names].map(([name, id]) => [id, name])),
    });
    const digest = sha256(`native-doublets-v2\n${notation}\n${atoms}`);
    const root = join(directory, '.native');
    const target = join(root, digest);
    if (await this.cached(target, digest, graph.links.length)) {
      return { directory: target, cacheHit: true, links: graph.links.length };
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(root, { recursive: true, mode: 0o700 });
    const staging = await mkdtemp(join(root, '.build-'));
    try {
      const input = join(staging, 'input.lino');
      const output = join(staging, 'export.lino');
      await atomicWrite(input, notation);
      // Numeric addresses avoid the CLI's expensive named-link sidecar.
      // Full labels remain losslessly keyed by their native atom address.
      await atomicWrite(join(staging, 'atoms.lino'), atoms);
      await this.capabilities();
      await this.run(
        this.command,
        [
          '--db',
          join(staging, 'store.db'),
          '--auto-create-missing-references',
          '--import',
          input,
          '--export-binary',
          join(staging, 'data.links'),
        ],
        { timeout: 120000, maxBuffer: 1024 ** 2 }
      );
      const verification = join(staging, '.verify');
      await mkdir(verification);
      await this.run(
        this.command,
        [
          '--db',
          join(verification, 'store.db'),
          '--import-binary',
          join(staging, 'data.links'),
          '--export',
          output,
        ],
        { timeout: 120000, maxBuffer: 1024 ** 2 }
      );
      await rm(verification, { recursive: true, force: true });
      const parser = new Parser();
      const exported = new Set(
        parser.parse(await readOptional(output, 'utf8')).map(linkKey)
      );
      const expected = new Set(parser.parse(notation).map(linkKey));
      const missing = [...expected].filter((key) => !exported.has(key));
      if (missing.length || exported.size !== expected.size) {
        throw new Error(
          `Native binary round trip changed associative links (${missing.length} missing; ${exported.size} returned, ${expected.size} expected)`
        );
      }
      const files = [];
      for (const name of await readdir(staging)) {
        files.push({
          name,
          hash: sha256(await readOptional(join(staging, name))),
        });
      }
      await atomicWrite(
        join(staging, 'manifest.json'),
        JSON.stringify({
          backend: 'link-cli',
          format: 'binary-links-notation',
          sha256: digest,
          links: graph.links.length,
          files,
        })
      );
      await rename(staging, target);
      return { directory: target, cacheHit: false, links: graph.links.length };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async mirror(store) {
    return await store.locked(async () => {
      const results = [];
      for (const kind of await store.kinds()) {
        for (const record of await store.list(kind)) {
          const { DoubletGraph } = await import('./doublets.js');
          const graph = new DoubletGraph();
          graph.addRecord(kind, record);
          results.push({
            kind,
            id: record.id,
            ...(await this.project(store.directory, graph)),
          });
        }
      }
      return {
        backend: 'link-cli',
        shards: results,
        reused: results.filter((result) => result.cacheHit).length,
      };
    });
  }
}
