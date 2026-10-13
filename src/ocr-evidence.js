import { isDeepStrictEqual } from 'node:util';
import { sha256 } from './util.js';
import { parseTsv } from './ocr.js';

async function preservedBytes(store, reference, label) {
  const bytes = reference?.sha256 ? await store.blob(reference.sha256) : null;
  if (
    !bytes ||
    !/^[a-f\d]{64}$/u.test(reference.sha256) ||
    sha256(bytes) !== reference.sha256 ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes !== bytes.length
  ) {
    throw new Error(
      `OCR ${label} bytes, length or SHA-256 do not match their original`
    );
  }
  return bytes;
}

function modelProvenance(ocr) {
  const manifest = ocr.modelProvenance;
  if (!manifest) {
    return;
  }
  const { fingerprint, ...original } = manifest;
  if (
    manifest.version !== 'tesseract-traineddata-v1' ||
    manifest.requestedLanguages !== ocr.languages ||
    !['native', 'explicit'].includes(manifest.directorySelection) ||
    !Array.isArray(manifest.models) ||
    !manifest.models.length ||
    manifest.models.length > 16 ||
    fingerprint !== sha256(JSON.stringify(original))
  ) {
    throw new Error('OCR native model provenance is malformed or changed');
  }
  let total = 0;
  for (const model of manifest.models) {
    if (
      !/^[a-z_]+$/u.test(model.language || '') ||
      !['language', 'orientation'].includes(model.role) ||
      !/^[a-f\d]{64}$/u.test(model.sha256 || '') ||
      !Number.isSafeInteger(model.bytes) ||
      model.bytes < 1 ||
      model.bytes > 64 * 1024 ** 2
    ) {
      throw new Error(
        'OCR trained-model fingerprint or byte length is invalid'
      );
    }
    total += model.bytes;
  }
  const requested = [...new Set(String(ocr.languages).split('+'))].sort();
  const supplied = manifest.models
    .filter((model) => model.role === 'language')
    .map((model) => model.language)
    .sort();
  if (
    total > 128 * 1024 ** 2 ||
    !isDeepStrictEqual(requested, supplied) ||
    (ocr.psm === 12 &&
      !manifest.models.some((model) => model.language === 'osd'))
  ) {
    throw new Error(
      'OCR model manifest does not cover the declared language/segmentation recipe'
    );
  }
}

function recipeShape(transform) {
  const recipe = transform.transform;
  const dimensions = transform.originalDimensions;
  const crop = recipe?.crop;
  const resize = recipe?.resize;
  const positive = (value) =>
    Number.isSafeInteger(value) && value > 0 && value <= 8192;
  if (
    !dimensions ||
    !positive(dimensions.width) ||
    !positive(dimensions.height) ||
    !crop ||
    !positive(crop.width) ||
    !positive(crop.height) ||
    !Number.isSafeInteger(crop.left) ||
    !Number.isSafeInteger(crop.top) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.left + crop.width > dimensions.width ||
    crop.top + crop.height > dimensions.height ||
    !resize ||
    !positive(resize.width) ||
    !positive(resize.height) ||
    resize.width * resize.height > 16000000 ||
    !['lanczos3', 'nearest'].includes(resize.kernel) ||
    typeof recipe.grayscale !== 'boolean' ||
    recipe.alphaBackground !== '#ffffff' ||
    recipe.format !== 'png' ||
    !isDeepStrictEqual(recipe.png, {
      compressionLevel: 9,
      adaptiveFiltering: false,
      palette: false,
    }) ||
    !transform.renderer?.sharp ||
    !transform.renderer?.vips
  ) {
    throw new Error(
      'OCR image transformation renderer/recipe is incomplete or unsupported'
    );
  }
}

function persistedOcr(ocr) {
  const result = { ...ocr };
  delete result.cacheHit;
  delete result.transformCacheHit;
  delete result.visibility;
  return result;
}

async function checkedOcr(store, ocr) {
  if (
    !ocr?.id ||
    !ocr.engine ||
    ocr.invalidated ||
    ocr.invalidatedAt ||
    !/^[a-z_]+(?:\+[a-z_]+)*$/u.test(ocr.languages || '') ||
    ![3, 6, 7, 11, 12].includes(ocr.psm)
  ) {
    throw new Error(
      'OCR record needs original engine/language/segmentation provenance'
    );
  }
  const stored = await store.get('ocr', ocr.id);
  if (!stored || !isDeepStrictEqual(persistedOcr(stored), persistedOcr(ocr))) {
    throw new Error('OCR evidence differs from its preserved record');
  }
  modelProvenance(stored);
  const tsv = await preservedBytes(store, stored.rawTsv, 'TSV');
  const parsed = parseTsv(tsv.toString('utf8'));
  if (
    parsed.text !== stored.text ||
    parsed.confidence !== stored.confidence ||
    !isDeepStrictEqual(parsed.words, stored.words)
  ) {
    throw new Error(
      'OCR transcription, confidence or word geometry differs from its original TSV'
    );
  }
  return { stored, text: parsed.text };
}

async function checkedTransform(store, ocr, original) {
  const transform = await store.get('image-transform', ocr.imageTransform?.id);
  if (
    !transform ||
    !isDeepStrictEqual(transform, ocr.imageTransform) ||
    transform.originalImage?.sha256 !== original.sha256 ||
    ocr.originalImageHash !== original.sha256 ||
    transform.originalImage.bytes !== original.bytes ||
    transform.derivedImage?.sha256 !== ocr.imageHash ||
    ocr.derivedImage?.sha256 !== ocr.imageHash ||
    !isDeepStrictEqual(transform.derivedImage, ocr.derivedImage) ||
    transform.id !==
      sha256(
        JSON.stringify([
          'ocr-image-transform-v1',
          original.sha256,
          transform.transform,
          transform.renderer,
          transform.sourceOcr || null,
        ])
      )
  ) {
    throw new Error(
      'OCR transformation is not bound to the preserved original and derived images'
    );
  }
  recipeShape(transform);
  await preservedBytes(store, transform.originalImage, 'original image');
  await preservedBytes(store, transform.derivedImage, 'derived image');
  if (transform.sourceOcr) {
    const originalOcr = await store.get('ocr', transform.sourceOcr.id);
    if (
      !originalOcr ||
      originalOcr.imageHash !== original.sha256 ||
      originalOcr.rawTsv?.sha256 !== transform.sourceOcr.rawTsv?.sha256 ||
      originalOcr.rawTsv?.bytes !== transform.sourceOcr.rawTsv?.bytes ||
      transform.sourceOcr.imageHash !== original.sha256
    ) {
      throw new Error(
        'OCR image transform lost its original OCR/TSV provenance'
      );
    }
    await checkedOcr(store, originalOcr);
  }
}

/** Check archived evidence only; no engine, renderer or model downloads run. */
export async function verifyOriginalBoundOcr(store, original, input) {
  await preservedBytes(store, original, 'source image');
  const ocr = typeof input === 'string' ? await store.get('ocr', input) : input;
  if (!ocr || (ocr.imageHash !== original.sha256 && !ocr.imageTransform)) {
    throw new Error(
      'Label review requires OCR bound to the original image; derived OCR needs its preserved transformation'
    );
  }
  const checked = await checkedOcr(store, ocr);
  if (checked.stored.imageTransform) {
    await checkedTransform(store, checked.stored, original);
  } else if (checked.stored.imageHash === original.sha256) {
    if (
      checked.stored.originalImageHash &&
      checked.stored.originalImageHash !== original.sha256
    ) {
      throw new Error('OCR declares a different original image');
    }
  } else {
    throw new Error(
      'Derived OCR is missing its preserved original-image transform'
    );
  }
  return {
    text: checked.text,
    ocrId: checked.stored.id,
    originalImageSha256: original.sha256,
    physicalImageSha256: checked.stored.imageHash,
    rawTsvSha256: checked.stored.rawTsv.sha256,
    transformationId: checked.stored.imageTransform?.id || null,
    modelFingerprint: checked.stored.modelProvenance?.fingerprint || null,
  };
}
