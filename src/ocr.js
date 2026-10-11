import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './util.js';

const run = promisify(execFile);
const IMAGE_LIMITS = {
  bytes: 25 * 1024 ** 2,
  pixels: 16000000,
  dimension: 8192,
};
const OCR_MODES = [3, 6, 7, 11, 12];

function animatedPng(bytes) {
  if (
    bytes.length < 8 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return false;
  }
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) {
      return false;
    }
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') {
      return true;
    }
    offset += length + 12;
  }
  return false;
}

function allowedKeys(value, keys, name) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`Unsupported OCR ${name} options`);
  }
}

function imageDimension(value, name, minimum = 1) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > IMAGE_LIMITS.dimension
  ) {
    throw new Error(`OCR ${name} must be a bounded integer`);
  }
  return value;
}

function normalizeTransform(input, metadata) {
  allowedKeys(input, ['crop', 'resize', 'grayscale'], 'transform');
  const crop =
    input.crop === undefined
      ? {
          left: 0,
          top: 0,
          width: metadata.width,
          height: metadata.height,
        }
      : input.crop;
  allowedKeys(crop, ['left', 'top', 'width', 'height'], 'crop');
  const region = {
    left: imageDimension(crop.left, 'crop left', 0),
    top: imageDimension(crop.top, 'crop top', 0),
    width: imageDimension(crop.width, 'crop width'),
    height: imageDimension(crop.height, 'crop height'),
  };
  if (
    region.left + region.width > metadata.width ||
    region.top + region.height > metadata.height
  ) {
    throw new Error('OCR crop is outside the original image');
  }
  const resize =
    input.resize === undefined
      ? { width: region.width, height: region.height }
      : input.resize;
  allowedKeys(resize, ['width', 'height', 'kernel'], 'resize');
  const output = {
    width: imageDimension(resize.width, 'resize width'),
    height: imageDimension(resize.height, 'resize height'),
    kernel: resize.kernel === undefined ? 'lanczos3' : resize.kernel,
  };
  if (
    !['lanczos3', 'nearest'].includes(output.kernel) ||
    output.width * output.height > IMAGE_LIMITS.pixels
  ) {
    throw new Error('Unsupported or oversized OCR resize');
  }
  if (input.grayscale !== undefined && typeof input.grayscale !== 'boolean') {
    throw new Error('OCR grayscale must be boolean');
  }
  return {
    version: 'sharp-region-v1',
    crop: region,
    resize: output,
    grayscale: input.grayscale ?? false,
    alphaBackground: '#ffffff',
    format: 'png',
    png: { compressionLevel: 9, adaptiveFiltering: false, palette: false },
  };
}

async function storedImageBytes(store, image) {
  return image?.sha256 ? await store.blob(image.sha256) : undefined;
}

function physicalIdentity(blob, prepared) {
  return prepared
    ? ['tsv-transform-v1', prepared.blob.sha256, prepared.derivation.id]
    : ['tsv-v2', blob.sha256];
}

function transformFields(prepared, blob, tessdataDir) {
  if (!prepared) {
    return {};
  }
  return {
    originalImageHash: blob.sha256,
    derivedImage: prepared.blob,
    imageTransform: prepared.derivation,
    parameters: {
      tessdataDir: tessdataDir || 'system',
      tessedit_create_tsv: 1,
    },
    requiresReview: true,
  };
}

function returnedOcr(result, cacheHit, prepared) {
  return {
    ...result,
    cacheHit,
    ...(prepared ? { transformCacheHit: prepared.cacheHit } : {}),
  };
}

function validateOcrOptions(psm, transform, sourceOcrId) {
  if (!OCR_MODES.includes(psm)) {
    throw new Error('Unsupported OCR page segmentation mode');
  }
  if (
    sourceOcrId !== undefined &&
    (typeof sourceOcrId !== 'string' || !sourceOcrId.trim())
  ) {
    throw new Error('OCR source context must be a nonempty evidence ID');
  }
  if (sourceOcrId && transform === undefined) {
    throw new Error('OCR source context requires an image transform');
  }
}

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
    if (!OCR_MODES.includes(psm)) {
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

  async originalOcrSource(blob, sourceOcrId) {
    if (!sourceOcrId) {
      return undefined;
    }
    const original = await this.store.get('ocr', sourceOcrId);
    if (
      !original ||
      original.imageHash !== blob.sha256 ||
      !original.rawTsv?.sha256
    ) {
      throw new Error(
        'OCR crop source must refer to OCR of the original image'
      );
    }
    const tsv = await this.store.blob(original.rawTsv.sha256);
    if (!tsv || sha256(tsv) !== original.rawTsv.sha256) {
      throw new Error('Missing or corrupted original OCR TSV');
    }
    return {
      id: original.id,
      imageHash: original.imageHash,
      rawTsv: original.rawTsv,
    };
  }

  async prepareImage(blob, input, sourceOcrId) {
    const bytes = await this.store.blob(blob.sha256);
    if (!bytes || sha256(bytes) !== blob.sha256) {
      throw new Error('Missing or corrupted original image for OCR transform');
    }
    if (bytes.length > IMAGE_LIMITS.bytes) {
      throw new Error('Original OCR image exceeds byte limit');
    }
    if (animatedPng(bytes)) {
      throw new Error(
        'OCR transformations require a static image, not animated PNG'
      );
    }
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, {
      limitInputPixels: IMAGE_LIMITS.pixels,
      failOn: 'error',
    });
    const metadata = await image.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(metadata.format) ||
      (metadata.pages || 1) !== 1
    ) {
      throw new Error(
        'OCR transformations require a static PNG, JPEG or WebP image'
      );
    }
    imageDimension(metadata.width, 'original width');
    imageDimension(metadata.height, 'original height');
    const transform = normalizeTransform(input, metadata);
    const sourceOcr = await this.originalOcrSource(blob, sourceOcrId);
    const renderer = { ...sharp.versions };
    const id = sha256(
      JSON.stringify([
        'ocr-image-transform-v1',
        blob.sha256,
        transform,
        renderer,
        sourceOcr || null,
      ])
    );
    const cached = await this.store.get('image-transform', id);
    if (cached) {
      const derived = await storedImageBytes(this.store, cached.derivedImage);
      if (!derived || sha256(derived) !== cached.derivedImage.sha256) {
        throw new Error('Missing or corrupted cached OCR transform image');
      }
      return { blob: cached.derivedImage, derivation: cached, cacheHit: true };
    }
    image
      .extract(transform.crop)
      .flatten({ background: transform.alphaBackground });
    if (transform.grayscale) {
      image.grayscale();
    }
    const output = await image
      .resize({ ...transform.resize, fit: 'fill' })
      .png(transform.png)
      .toBuffer();
    if (output.length > IMAGE_LIMITS.bytes) {
      throw new Error('Derived OCR image exceeds byte limit');
    }
    const derivedImage = await this.store.putBlob(output);
    const derivation = await this.store.put('image-transform', {
      id,
      originalImage: {
        type: 'stored-blob',
        sha256: blob.sha256,
        bytes: bytes.length,
      },
      originalDimensions: { width: metadata.width, height: metadata.height },
      originalFormat: metadata.format,
      sourceOcr,
      transform,
      renderer,
      derivedImage,
      createdAt: new Date().toISOString(),
      requiresReview: true,
    });
    return { blob: derivedImage, derivation, cacheHit: false };
  }

  async recognize(blob, { psm = this.psm, transform, sourceOcrId } = {}) {
    validateOcrOptions(psm, transform, sourceOcrId);
    const prepared =
      transform !== undefined
        ? await this.prepareImage(blob, transform, sourceOcrId)
        : undefined;
    const physicalImage = prepared?.blob || blob;
    const version = await this.version();
    const id = sha256(
      JSON.stringify([
        ...physicalIdentity(blob, prepared),
        version,
        this.languages,
        psm,
        this.tessdataDir || 'system',
      ])
    );
    const cached = await this.store.get('ocr', id);
    if (cached) {
      return returnedOcr(cached, true, prepared);
    }
    const bytes = await this.store.blob(physicalImage.sha256);
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
        imageHash: physicalImage.sha256,
        ...transformFields(prepared, blob, this.tessdataDir),
        engine: version,
        languages: this.languages,
        psm,
        ...parseTsv(stdout),
        observedAt: new Date().toISOString(),
        rawTsv: await this.store.putBlob(Buffer.from(stdout)),
      };
      await this.store.put('ocr', result);
      return returnedOcr(result, false, prepared);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
