import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encode, decode } from 'lino-objects-codec';
import { parseHTML } from 'linkedom';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DoubletGraph } from './doublets.js';
import { atomicWrite, readOptional, sha256 } from './util.js';

export const ARCHIVE_VERSION = 1;
export const DEFAULT_ARCHIVE = 'data/cases/vietnam-nha-trang';
const codecVersion = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.resolve('lino-objects-codec'))),
      '../package.json'
    ),
    'utf8'
  )
).version;
const PRIVATE_KEY =
  /^(?:cookies?|authorization|password|access[_-]?token|refresh[_-]?token|session[_-]?(?:id|token)|csrf[_-]?token|user(?:id|name|info)|customer(?:id|info)|email|phone|address|seedCookies)$/iu;
const PRIVATE_QUERY =
  /^(?:.*(?:token|cookie|x5sec|x5step|signature|csrf).*|sign|uuid|uid|userId|session|spm|scm|laz_trackid|clickTrackInfo)$/iu;

export function sanitizePublicData(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizePublicData);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_KEY.test(key))
        .map(([key, child]) => [key, sanitizePublicData(child)])
    );
  }
  if (typeof value === 'string') {
    return value.replace(/https?:\/\/[^\s<>"'\\]+/gu, (text) => {
      try {
        const url = new URL(text);
        for (const key of [...url.searchParams.keys()]) {
          if (PRIVATE_QUERY.test(key.replace(/^amp;/u, ''))) {
            url.searchParams.delete(key);
          } else {
            const original = url.searchParams.get(key);
            const cleaned = sanitizePublicData(original);
            if (original !== cleaned) {
              url.searchParams.set(key, cleaned);
            }
          }
        }
        return url.href;
      } catch {
        return text;
      }
    });
  }
  return value;
}

// Preserve product DOM, JSON-LD and the public SKU inventory. Executable page
// scripts contain tracking/session state and are unnecessary for offline parsing.
export function sanitizePublicHtml(html) {
  const { document } = parseHTML(html);
  for (const script of document.querySelectorAll('script')) {
    if (script.type === 'application/ld+json') {
      try {
        script.textContent = JSON.stringify(
          sanitizePublicData(JSON.parse(script.textContent))
        );
      } catch {
        script.remove();
      }
    } else if (/__moduleData__\s*=/u.test(script.textContent)) {
      const match = script.textContent.match(
        /(?:var\s+|window\.)__moduleData__\s*=\s*(\{[^\n]+\});/u
      );
      try {
        const fields = JSON.parse(match?.[1]).data.root.fields;
        script.textContent = `var __moduleData__ = ${JSON.stringify({ data: { root: { fields: sanitizePublicData({ productOption: fields.productOption, skuInfos: fields.skuInfos }) } } })};`;
      } catch {
        script.remove();
      }
    } else {
      script.remove();
    }
  }
  for (const element of document.querySelectorAll(
    'input[type="password"], input[type="email"], [data-customer], [data-account], #J_Header, #lazada-header'
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (
        /^on/iu.test(attribute.name) ||
        PRIVATE_KEY.test(attribute.name.replace(/^data-/u, ''))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return sanitizePublicData(document.toString());
}

function sanitizeImportedSource(bytes, format) {
  const text = bytes.toString();
  const parsed =
    format === 'json'
      ? JSON.parse(text)
      : format === 'yaml'
        ? parseYaml(text, { maxAliasCount: 100 })
        : decode({ notation: text });
  const safe = sanitizePublicData(parsed);
  if (JSON.stringify(safe) === JSON.stringify(parsed)) {
    return bytes;
  }
  return Buffer.from(
    format === 'json'
      ? `${JSON.stringify(safe, null, 2)}\n`
      : format === 'yaml'
        ? stringifyYaml(safe)
        : encode({ obj: safe })
  );
}

function bundleGraphs(kind, records) {
  const chunks = [Buffer.from('LZARCH01')];
  for (const record of records) {
    const graph = new DoubletGraph();
    graph.addRecord(kind, record);
    const bytes = graph.toBinary();
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

export class RepositoryArchive {
  constructor({ directory = DEFAULT_ARCHIVE } = {}) {
    this.directory = resolve(directory);
    this.records = new Map();
    this.loading = new Map();
    this.indices = new Map();
  }

  async manifest() {
    if (!this.metadata) {
      const text = await readOptional(
        join(this.directory, 'manifest.json'),
        'utf8'
      );
      if (!text) {
        throw new Error(`Repository archive not found: ${this.directory}`);
      }
      this.metadata = JSON.parse(text);
      if (this.metadata.version !== ARCHIVE_VERSION) {
        throw new Error('Unsupported repository archive version');
      }
    }
    return this.metadata;
  }

  async file(file) {
    if (
      !/^(?:records|links|blobs)\/[a-z\d/.-]+$/u.test(file.path) ||
      file.path.includes('..')
    ) {
      throw new Error('Invalid archive path');
    }
    const compressed = await readOptional(join(this.directory, file.path));
    if (!compressed || sha256(compressed) !== file.sha256) {
      throw new Error(`Corrupt repository archive file: ${file.path}`);
    }
    const bytes = gunzipSync(compressed);
    if (sha256(bytes) !== file.contentSha256) {
      throw new Error(`Corrupt repository archive contents: ${file.path}`);
    }
    return bytes;
  }

  async load(kind) {
    if (!this.records.has(kind)) {
      if (!this.loading.has(kind)) {
        this.loading.set(
          kind,
          (async () => {
            const entry = (await this.manifest()).kinds[kind];
            const records = entry
              ? JSON.parse((await this.file(entry.json)).toString())
              : [];
            this.records.set(kind, records);
            this.indices.set(
              kind,
              new Map(records.map((record, index) => [record.id, index]))
            );
          })()
        );
      }
      try {
        await this.loading.get(kind);
      } finally {
        this.loading.delete(kind);
      }
    }
    return this.records.get(kind);
  }

  async list(kind) {
    return globalThis.structuredClone(await this.load(kind));
  }

  async get(kind, id) {
    const records = await this.load(kind);
    return globalThis.structuredClone(records[this.indices.get(kind).get(id)]);
  }

  async graph(kind, id) {
    await this.load(kind);
    const index = this.indices.get(kind).get(id);
    if (index === undefined) {
      return undefined;
    }
    const bytes = await this.file((await this.manifest()).kinds[kind].binary);
    if (bytes.subarray(0, 8).toString() !== 'LZARCH01') {
      throw new Error('Invalid archived binary graph');
    }
    let offset = 8;
    for (let current = 0; current <= index; current++) {
      const length = bytes.readUInt32LE(offset);
      offset += 4;
      if (current === index) {
        return DoubletGraph.fromBinary(bytes.subarray(offset, offset + length));
      }
      offset += length;
    }
  }

  async blob(hash) {
    const file = (await this.manifest()).blobs[hash];
    return file ? this.file(file) : undefined;
  }

  async verify() {
    const manifest = await this.manifest();
    let records = 0;
    for (const [kind, entry] of Object.entries(manifest.kinds)) {
      const source = await this.list(kind);
      const converted = decode({
        notation: (await this.file(entry.lino)).toString(),
      });
      if (JSON.stringify(source) !== JSON.stringify(converted)) {
        throw new Error(`JSON / Links Notation mismatch: ${kind}`);
      }
      const binary = await this.file(entry.binary);
      if (binary.subarray(0, 8).toString() !== 'LZARCH01') {
        throw new Error(`Invalid binary archive: ${kind}`);
      }
      let offset = 8;
      for (const record of source) {
        if (offset + 4 > binary.length) {
          throw new Error(`Truncated binary archive: ${kind}`);
        }
        const size = binary.readUInt32LE(offset);
        offset += 4;
        const graph = new DoubletGraph();
        graph.addRecord(kind, record);
        if (!binary.subarray(offset, offset + size).equals(graph.toBinary())) {
          throw new Error(`Binary conversion mismatch: ${kind}:${record.id}`);
        }
        offset += size;
      }
      if (offset !== binary.length) {
        throw new Error(`Trailing binary archive data: ${kind}`);
      }
      records += source.length;
    }
    for (const [hash, file] of Object.entries(manifest.blobs)) {
      if (sha256(await this.file(file)) !== hash) {
        throw new Error('Evidence blob identity mismatch');
      }
    }
    return {
      valid: true,
      records,
      blobs: Object.keys(manifest.blobs).length,
      downloads: 0,
    };
  }
}

export async function exportRepositoryArchive({
  store,
  directory = DEFAULT_ARCHIVE,
  caseMetadata = {},
}) {
  const target = resolve(directory);
  if (target === store.directory || target.startsWith(`${store.directory}/`)) {
    throw new Error('Archive must be separate from the private working store');
  }
  await mkdir(target, { recursive: true });
  const oldText = await readOptional(join(target, 'manifest.json'), 'utf8');
  const previous = oldText ? JSON.parse(oldText) : undefined;
  const manifest = {
    version: ARCHIVE_VERSION,
    conversion: `lino-objects-codec@${codecVersion};LZLINK01;LZARCH01;${sha256([encode.toString(), DoubletGraph.prototype.addRecord.toString(), DoubletGraph.prototype.toBinary.toString(), sanitizePublicHtml.toString(), sanitizePublicData.toString(), sanitizeImportedSource.toString(), bundleGraphs.toString(), PRIVATE_KEY.toString(), PRIVATE_QUERY.toString()].join('\n'))}`,
    case: sanitizePublicData(caseMetadata),
    kinds: {},
    blobs: {},
    sourceRewrites: [],
    excluded: {
      emptyTrackingResponses: 0,
      reason:
        'Empty tracking-pixel responses contain no product evidence; browser profiles, session caches and executables are not part of the public case.',
    },
  };
  let reused = 0;
  let rebuilt = 0;
  const write = async (path, bytes) => {
    const contents = Buffer.from(bytes);
    if (!path.startsWith('blobs/')) {
      path = path.replace(
        /\.(json|lino|links)\.gz$/u,
        `.${sha256(contents)}.$1.gz`
      );
    }
    const compressed = gzipSync(contents, { level: 9 });
    const file = {
      path,
      sha256: sha256(compressed),
      contentSha256: sha256(contents),
      bytes: contents.length,
      compressedBytes: compressed.length,
    };
    if ((await readOptional(join(target, path)))?.equals(compressed)) {
      reused++;
    } else {
      await atomicWrite(join(target, path), compressed);
      rebuilt++;
    }
    return file;
  };
  const rewrite = new Map();
  const copyBlob = async (reference, format) => {
    const key = `${reference.sha256}:${format || 'binary'}`;
    if (rewrite.has(key)) {
      return rewrite.get(key);
    }
    const original = await store.blob(reference.sha256);
    if (!original) {
      throw new Error(`Missing source evidence: ${reference.sha256}`);
    }
    const bytes =
      format === 'html'
        ? Buffer.from(sanitizePublicHtml(original.toString()))
        : ['json', 'yaml', 'lino'].includes(format)
          ? sanitizeImportedSource(original, format)
          : original;
    const hash = sha256(bytes);
    const updated = { sha256: hash, bytes: bytes.length };
    rewrite.set(key, updated);
    if (!manifest.blobs[hash]) {
      const old = previous?.blobs[hash];
      const compressed = old && (await readOptional(join(target, old.path)));
      if (
        old?.contentSha256 === hash &&
        compressed &&
        sha256(compressed) === old.sha256
      ) {
        manifest.blobs[hash] = old;
        reused++;
      } else {
        manifest.blobs[hash] = await write(
          `blobs/${hash.slice(0, 2)}/${hash}.gz`,
          bytes
        );
      }
    }
    if (hash !== reference.sha256) {
      manifest.sourceRewrites.push({
        originalSha256: reference.sha256,
        archivedSha256: hash,
        reason:
          'Remove private account/session fields and tracking/security URL parameters; remove executable HTML scripts while retaining product DOM and structured SKU data',
      });
    }
    return updated;
  };
  const walk = async (value, field, format) => {
    if (
      value &&
      typeof value === 'object' &&
      /^[a-f\d]{64}$/u.test(value.sha256) &&
      Number.isSafeInteger(value.bytes)
    ) {
      return copyBlob(
        value,
        field === 'html' ? 'html' : field === 'source' ? format : undefined
      );
    }
    if (Array.isArray(value)) {
      const output = [];
      for (const child of value) {
        output.push(await walk(child, undefined, format));
      }
      return output;
    }
    if (value && typeof value === 'object') {
      const output = {};
      for (const [key, child] of Object.entries(value)) {
        output[key] = await walk(child, key, format);
      }
      return output;
    }
    return value;
  };
  const localEntries = await readdir(store.directory, {
    withFileTypes: true,
  }).catch((error) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  const localKinds = localEntries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^[a-z][a-z-]*$/u.test(entry.name) &&
        !['blobs', 'browser-profile', 'tessdata', 'bin'].includes(entry.name)
    )
    .map((entry) => entry.name);
  const archivedKinds = store.archive
    ? Object.keys((await store.archive.manifest()).kinds)
    : [];
  const kinds = [...new Set([...localKinds, ...archivedKinds])].sort();
  for (const kind of kinds) {
    const recordsById = new Map();
    const originalIds = new Map();
    for (const input of await store.list(kind)) {
      if (kind === 'cache' && input.blob?.bytes === 0) {
        manifest.excluded.emptyTrackingResponses++;
        continue;
      }
      const record = sanitizePublicData(input);
      // Security/app failures are retained as outcomes, never as useful page data.
      if (
        kind === 'cache' &&
        record.status &&
        !['ok', 'unavailable'].includes(record.status)
      ) {
        delete record.html;
        delete record.screenshot;
        record.snapshot = {
          url: record.url,
          title: record.snapshot?.title || '',
          rawText: `Collection stopped: ${record.status}`,
        };
      }
      if (kind === 'cache') {
        record.repositoryReusable = true;
      }
      // A local URL may still carry parameters removed from its committed
      // alias. The local record wins over that archived alias on re-export.
      if (recordsById.has(record.id) && kind !== 'cache') {
        throw new Error(`Sanitization caused duplicate record IDs: ${kind}`);
      }
      if (recordsById.has(record.id)) {
        const oldLocal = await readOptional(
          store.recordPath(kind, originalIds.get(record.id))
        );
        const newLocal = await readOptional(store.recordPath(kind, input.id));
        if (
          (oldLocal && !newLocal) ||
          (oldLocal &&
            newLocal &&
            (recordsById.get(record.id).checkedAt || 0) >
              (record.checkedAt || 0))
        ) {
          continue;
        }
      }
      recordsById.set(record.id, record);
      originalIds.set(record.id, input.id);
    }
    const records = [];
    for (const record of recordsById.values()) {
      records.push(
        await walk(
          record,
          undefined,
          kind === 'import-source' ? record.format : undefined
        )
      );
    }
    records.sort((left, right) => left.id.localeCompare(right.id));
    const json = Buffer.from(`${JSON.stringify(records)}\n`);
    const sourceSha256 = sha256(json);
    const old = previous?.kinds[kind];
    const unchanged =
      previous?.version === manifest.version &&
      previous.conversion === manifest.conversion &&
      old?.sourceSha256 === sourceSha256;
    const intact =
      unchanged &&
      (
        await Promise.all(
          [old.json, old.lino, old.binary].map(async (file) => {
            const bytes = await readOptional(join(target, file.path));
            return bytes && sha256(bytes) === file.sha256;
          })
        )
      ).every(Boolean);
    if (intact) {
      manifest.kinds[kind] = old;
      reused += 3;
    } else {
      manifest.kinds[kind] = {
        records: records.length,
        sourceSha256,
        json: await write(`records/${kind}.json.gz`, json),
        lino: await write(`links/${kind}.lino.gz`, encode({ obj: records })),
        binary: await write(
          `links/${kind}.links.gz`,
          bundleGraphs(kind, records)
        ),
      };
    }
  }
  if (store.archive) {
    const inherited = await store.archive.manifest();
    for (const rewrite of inherited.sourceRewrites || []) {
      if (
        manifest.blobs[rewrite.archivedSha256] &&
        !manifest.sourceRewrites.some(
          (entry) => entry.originalSha256 === rewrite.originalSha256
        )
      ) {
        manifest.sourceRewrites.push(rewrite);
      }
    }
    manifest.excluded.emptyTrackingResponses = Math.max(
      manifest.excluded.emptyTrackingResponses,
      inherited.excluded?.emptyTrackingResponses || 0
    );
  }
  manifest.sourceRewrites.sort((left, right) =>
    left.originalSha256.localeCompare(right.originalSha256)
  );
  // Remove superseded content-addressed files from this snapshot. Git retains
  // the earlier versions; interrupted exports never publish a partial manifest.
  await atomicWrite(
    join(target, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  const keep = new Set(
    [
      ...Object.values(manifest.blobs),
      ...Object.values(manifest.kinds).flatMap((kind) => [
        kind.json,
        kind.lino,
        kind.binary,
      ]),
    ].map((file) => file.path)
  );
  for (const area of ['records', 'links', 'blobs']) {
    for (const file of await readdir(join(target, area), {
      recursive: true,
    }).catch((error) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    })) {
      const path = `${area}/${file}`;
      if (file.endsWith('.gz') && !keep.has(path)) {
        await rm(join(target, path), { force: true });
      }
    }
  }
  return {
    directory: target,
    records: Object.values(manifest.kinds).reduce(
      (sum, kind) => sum + kind.records,
      0
    ),
    blobs: Object.keys(manifest.blobs).length,
    reused,
    rebuilt,
    downloads: 0,
  };
}
