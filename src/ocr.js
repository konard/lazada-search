import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './util.js';

const run = promisify(execFile);

export function parseTsv(tsv) {
  const lines = tsv.trim().split(/\r?\n/u);
  if (
    !lines[0]?.startsWith('level\tpage_num\tblock_num\t') ||
    !lines[0].endsWith('\tconf\ttext')
  ) {
    throw new Error(
      'Tesseract did not return TSV; OCR evidence was not parsed'
    );
  }
  const words = lines
    .slice(1)
    .map((line) => {
      const columns = line.split('\t');
      return {
        line: columns.slice(1, 5).join(':'),
        confidence: Number(columns[10]) / 100,
        text: columns.slice(11).join('\t'),
        box: columns.slice(6, 10).map(Number),
      };
    })
    .filter((word) => word.text?.trim() && word.confidence >= 0);
  const groups = new Map();
  for (const word of words) {
    if (!groups.has(word.line)) {
      groups.set(word.line, []);
    }
    groups.get(word.line).push(word.text);
  }
  return {
    text: [...groups.values()].map((group) => group.join(' ')).join('\n'),
    confidence: words.length
      ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
      : 0,
    words,
  };
}

export class TesseractOcr {
  constructor({
    store,
    languages = 'eng',
    command = 'tesseract',
    psm = 6,
    tessdataDir,
    execute = run,
  } = {}) {
    if (!/^[a-z_]+(?:\+[a-z_]+)*$/u.test(languages)) {
      throw new Error('Invalid OCR languages');
    }
    if (![3, 6, 11, 12].includes(psm)) {
      throw new Error('Unsupported OCR page segmentation mode');
    }
    this.store = store;
    this.languages = languages;
    this.command = command;
    this.psm = psm;
    this.tessdataDir = tessdataDir;
    this.execute = execute;
  }

  async version() {
    if (!this.engineVersion) {
      this.engineVersion = (
        await this.execute(this.command, ['--version'], { timeout: 10000 })
      ).stdout.split('\n')[0];
    }
    return this.engineVersion;
  }

  async recognize(blob, { psm = this.psm } = {}) {
    if (![3, 6, 11, 12].includes(psm)) {
      throw new Error('Unsupported OCR page segmentation mode');
    }
    const version = await this.version();
    const id = sha256(
      JSON.stringify([
        'tsv-v2',
        blob.sha256,
        version,
        this.languages,
        psm,
        this.tessdataDir || 'system',
      ])
    );
    const cached = await this.store.get('ocr', id);
    if (cached) {
      return { ...cached, cacheHit: true };
    }
    const bytes = await this.store.blob(blob.sha256);
    if (!bytes) {
      throw new Error('Missing image for OCR');
    }
    const directory = await mkdtemp(join(tmpdir(), 'lazada-ocr-'));
    try {
      const image = join(directory, 'image');
      await writeFile(image, bytes);
      const { stdout } = await this.execute(
        this.command,
        [
          image,
          'stdout',
          ...(this.tessdataDir ? ['--tessdata-dir', this.tessdataDir] : []),
          '-l',
          this.languages,
          '--psm',
          String(psm),
          '-c',
          'tessedit_create_tsv=1',
        ],
        { timeout: 60000, maxBuffer: 20 * 1024 ** 2 }
      );
      const result = {
        id,
        imageHash: blob.sha256,
        engine: version,
        languages: this.languages,
        psm,
        ...parseTsv(stdout),
        observedAt: new Date().toISOString(),
        rawTsv: await this.store.putBlob(Buffer.from(stdout)),
      };
      await this.store.put('ocr', result);
      return { ...result, cacheHit: false };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
