import { Link, formatLinks } from 'links-notation';

const MAGIC = Buffer.from('LZLINK01');

// Every id addresses a doublet. Named atoms are self-links; facts are
// (record, (field-path, typed-value)). Equal pairs share one id.
export class DoubletGraph {
  constructor() {
    this.links = [];
    this.names = new Map();
    this.pairs = new Map();
  }

  atom(name) {
    if (this.names.has(name)) {
      return this.names.get(name);
    }
    const id = this.links.length + 1;
    this.links.push({ id, source: id, target: id, name });
    this.names.set(name, id);
    return id;
  }

  pair(source, target) {
    const key = `${source}:${target}`;
    if (this.pairs.has(key)) {
      return this.pairs.get(key);
    }
    const id = this.links.length + 1;
    this.links.push({ id, source, target });
    this.pairs.set(key, id);
    return id;
  }

  addRecord(kind, record) {
    const owner = this.atom(`record:${kind}:${record.id}`);
    const walk = (value, path) => {
      const type =
        value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const name = ['object', 'array', 'null'].includes(type)
        ? type
        : `${type}:${value}`;
      this.pair(owner, this.pair(this.atom(`field:${path}`), this.atom(name)));
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          walk(
            child,
            `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
          );
        }
      }
    };
    walk(record, '');
    for (const [relation, references] of Object.entries({
      product: record.productId ? [record.productId] : [],
      evidence: [
        ...(record.evidenceIds || []),
        ...(record.evidenceId ? [record.evidenceId] : []),
      ],
      cache: record.cacheId ? [record.cacheId] : [],
      ocr: record.ocrId ? [record.ocrId] : [],
    })) {
      for (const reference of references) {
        this.pair(
          owner,
          this.pair(
            this.atom(`relation:${relation}`),
            this.atom(`record:${relation}:${reference}`)
          )
        );
      }
    }
    return owner;
  }

  query({ source, target } = {}) {
    return this.links.filter(
      (link) =>
        (source === undefined || link.source === source) &&
        (target === undefined || link.target === target)
    );
  }

  toNotation({ numericIds = false } = {}) {
    const safeAtom = (name) =>
      encodeURIComponent(name).replace(
        /[!'()*]/gu,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      );
    const reference = (id) =>
      numericIds
        ? String(id)
        : this.links[id - 1].name === undefined
          ? `link-${id}`
          : `atom-${safeAtom(this.links[id - 1].name)}`;
    return formatLinks(
      this.links.map(
        ({ id, source, target }) =>
          new Link(reference(id), [
            new Link(reference(source)),
            new Link(reference(target)),
          ])
      )
    );
  }

  toBinary() {
    const chunks = [MAGIC, Buffer.alloc(4)];
    chunks[1].writeUInt32LE(this.links.length);
    for (const { source, target, name } of this.links) {
      const bytes = name === undefined ? Buffer.alloc(0) : Buffer.from(name);
      const header = Buffer.alloc(12);
      header.writeUInt32LE(source, 0);
      header.writeUInt32LE(target, 4);
      header.writeUInt32LE(bytes.length, 8);
      chunks.push(header, bytes);
    }
    return Buffer.concat(chunks);
  }

  static fromBinary(bytes) {
    if (bytes.length < 12 || !bytes.subarray(0, 8).equals(MAGIC)) {
      throw new Error('Invalid Lazada doublet store header');
    }
    const graph = new DoubletGraph();
    const count = bytes.readUInt32LE(8);
    let offset = 12;
    for (let index = 0; index < count; index += 1) {
      if (offset + 12 > bytes.length) {
        throw new Error('Truncated doublet store');
      }
      const source = bytes.readUInt32LE(offset);
      const target = bytes.readUInt32LE(offset + 4);
      const length = bytes.readUInt32LE(offset + 8);
      offset += 12;
      if (
        offset + length > bytes.length ||
        source < 1 ||
        target < 1 ||
        source > count ||
        target > count
      ) {
        throw new Error('Invalid doublet address or atom');
      }
      const id = index + 1;
      const name = length
        ? bytes.subarray(offset, offset + length).toString()
        : undefined;
      graph.links.push({
        id,
        source,
        target,
        ...(name === undefined ? {} : { name }),
      });
      if (name !== undefined) {
        graph.names.set(name, id);
      } else {
        graph.pairs.set(`${source}:${target}`, id);
      }
      offset += length;
    }
    if (offset !== bytes.length) {
      throw new Error('Trailing doublet store data');
    }
    return graph;
  }
}
