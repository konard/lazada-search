import { isDeepStrictEqual } from 'node:util';
import { parseHTML } from 'linkedom';
import { extractPage } from './browser.js';
import { sanitizePublicData } from './archive.js';
import { canonicalUrl, sha256 } from './util.js';
import { verifyOriginalBoundOcr } from './ocr-evidence.js';
import { workflowSourceInvalidated } from './source-invalidation.js';

const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]])
  );
const OCR_FIELDS = [
  'id',
  'imageHash',
  'originalImageHash',
  'engine',
  'modelProvenance',
  'languages',
  'psm',
  'text',
  'confidence',
  'words',
  'observedAt',
  'rawTsv',
  'derivedImage',
];
const TRANSFORM_FIELDS = [
  'id',
  'originalImage',
  'originalDimensions',
  'originalFormat',
  'sourceOcr',
  'transform',
  'renderer',
  'derivedImage',
  'createdAt',
  'requiresReview',
];

async function checkedBytes(store, reference) {
  noExtraFields(reference, ['type', 'sha256', 'bytes']);
  if (
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes < 0 ||
    reference.bytes > 25 * 1024 ** 2
  ) {
    throw new Error(
      'Product-image OCR artifact exceeds its supported byte bounds'
    );
  }
  const bytes = await store.blob(reference?.sha256);
  if (
    !bytes ||
    sha256(bytes) !== reference.sha256 ||
    bytes.length !== reference.bytes
  ) {
    throw new Error(
      'Public product-image OCR original bytes or length do not match'
    );
  }
  return bytes;
}

function sourceImageUsable(source, imageHashes, invalidations) {
  return Boolean(
    source?.blob &&
    imageHashes.has(source.blob.sha256) &&
    source.status !== 'failed' &&
    (!source.sourceSha256 || source.sourceSha256 === source.blob.sha256) &&
    !source.challenge?.detected &&
    !source.redirectChainUnverified &&
    /^image\//u.test(source.contentType || '') &&
    !workflowSourceInvalidated(source, [], invalidations)
  );
}

async function matchedPublicImage(publicStore, accountStore, source, url) {
  const cached = await publicStore.get('cache', `image:${canonicalUrl(url)}`);
  if (
    !cached?.blob ||
    cached.visibility === 'private' ||
    cached.status === 'failed' ||
    cached.challenge?.detected ||
    cached.invalidatedAt ||
    cached.blob.sha256 !== source.blob.sha256
  ) {
    return;
  }
  const original = await checkedBytes(accountStore, source.blob);
  return (await checkedBytes(publicStore, cached.blob)).equals(original)
    ? cached.blob
    : undefined;
}

function noExtraFields(value, allowed) {
  if (!value || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Product-image OCR provenance contains unsupported fields');
  }
}

function publicOcr(record, transform) {
  if (
    !/^[a-f\d]{64}$/u.test(record.id || '') ||
    !/^tesseract \d[\w.+() -]{0,119}$/u.test(record.engine || '')
  ) {
    throw new Error('Product-image OCR engine provenance is unsupported');
  }
  if (record.modelProvenance) {
    noExtraFields(record.modelProvenance, [
      'version',
      'requestedLanguages',
      'directorySelection',
      'models',
      'fingerprint',
    ]);
    for (const model of record.modelProvenance.models) {
      noExtraFields(model, ['language', 'role', 'sha256', 'bytes']);
    }
  }
  const result = { ...pick(record, OCR_FIELDS), requiresReview: true };
  if (transform) {
    result.imageTransform = transform;
  }
  if (record.parameters) {
    result.parameters = {
      tessedit_create_tsv: record.parameters.tessedit_create_tsv,
    };
    result.sourceParametersSha256 =
      record.sourceParametersSha256 ||
      sha256(JSON.stringify(record.parameters));
  }
  return result;
}

function publicTransform(record) {
  if (
    record.transform?.version !== 'sharp-region-v1' ||
    !['png', 'jpeg', 'webp'].includes(record.originalFormat)
  ) {
    throw new Error('Product-image OCR transformation schema is unsupported');
  }
  noExtraFields(record.transform, [
    'version',
    'crop',
    'resize',
    'grayscale',
    'alphaBackground',
    'format',
    'png',
  ]);
  noExtraFields(record.transform.crop, ['left', 'top', 'width', 'height']);
  noExtraFields(record.transform.resize, ['width', 'height', 'kernel']);
  noExtraFields(record.originalDimensions, ['width', 'height']);
  if (record.sourceOcr) {
    noExtraFields(record.sourceOcr, ['id', 'imageHash', 'rawTsv']);
  }
  return { ...pick(record, TRANSFORM_FIELDS), requiresReview: true };
}

async function replayTransform(store, record) {
  const { default: sharp } = await import('sharp');
  noExtraFields(record.renderer, Object.keys(sharp.versions));
  if (
    !Object.values(record.renderer).every(
      (version) =>
        typeof version === 'string' && /^[\w.+-]{1,64}$/u.test(version)
    )
  ) {
    throw new Error('Product-image OCR renderer versions are malformed');
  }
  const original = await checkedBytes(store, record.originalImage);
  const image = sharp(original, {
    limitInputPixels: 16000000,
    failOn: 'error',
  });
  const dimensions = await image.metadata();
  if (
    !['png', 'jpeg', 'webp'].includes(dimensions.format) ||
    (dimensions.pages || 1) !== 1 ||
    dimensions.width !== record.originalDimensions.width ||
    dimensions.height !== record.originalDimensions.height
  ) {
    throw new Error('Public OCR transform original image dimensions differ');
  }
  const recipe = record.transform;
  image.extract(recipe.crop).flatten({ background: recipe.alphaBackground });
  if (recipe.grayscale) {
    image.grayscale();
  }
  const derived = await image
    .resize({ ...recipe.resize, fit: 'fill' })
    .png(recipe.png)
    .toBuffer();
  if (
    derived.length > 25 * 1024 ** 2 ||
    sha256(derived) !== record.derivedImage.sha256 ||
    derived.length !== record.derivedImage.bytes
  ) {
    throw new Error(
      'Public OCR derived image does not reproduce from its public original'
    );
  }
}

function privateViewportHashes(records) {
  return new Set(
    records
      .flatMap((record) => [
        record.screenshot?.sha256,
        ...(record.screenshots || []).map((view) => view.blob?.sha256),
      ])
      .filter(Boolean)
  );
}

async function publicImageRoots(
  publicStore,
  accountStore,
  publications,
  sources,
  imageHashes
) {
  const roots = new Map();
  const invalidations = await accountStore.list('invalidation');
  const privateImages = new Map(
    sources
      .filter((source) => source.id?.startsWith('image:'))
      .map((source) => [canonicalUrl(sanitizePublicData(source.url)), source])
  );
  for (const publication of publications) {
    if (
      publication.visibility === 'private' ||
      publication.exactSkuConfirmed !== true
    ) {
      continue;
    }
    const html = await checkedBytes(publicStore, publication.html);
    const { document } = parseHTML(html.toString('utf8'));
    for (const url of extractPage({ document, url: publication.sourceUrl })
      .productImages || []) {
      const source = privateImages.get(canonicalUrl(url));
      if (!sourceImageUsable(source, imageHashes, invalidations)) {
        continue;
      }
      if (roots.has(source.blob.sha256)) {
        continue;
      }
      const original = await matchedPublicImage(
        publicStore,
        accountStore,
        source,
        url
      );
      if (original) {
        roots.set(original.sha256, original);
      }
    }
  }
  return roots;
}

async function transformOriginal(context, raw, trail) {
  const original = context.roots.get(raw.originalImage.sha256);
  if (original) {
    return original;
  }
  const parent = context.transforms.get(raw.originalImage.sha256);
  if (!parent) {
    throw new Error('OCR transform has no public product-image ancestry');
  }
  const parentOcr = context.byImage
    .get(parent.derivedImage.sha256)
    ?.find((item) => item.imageTransform?.id === parent.id);
  await stageOcr(context, parentOcr, trail);
  return parent.derivedImage;
}

async function stageOcr(context, record, trail = new Set()) {
  if (
    !record ||
    trail.has(record.id) ||
    trail.size >= 8 ||
    context.screenshots.has(record.imageHash) ||
    context.screenshots.has(record.originalImageHash)
  ) {
    throw new Error(
      'OCR image chain is missing, cyclic or bound to an account viewport'
    );
  }
  if (context.stagedOcr.has(record.id)) {
    return;
  }
  const next = new Set([...trail, record.id]);
  let original = context.roots.get(record.imageHash);
  let transform;
  if (record.imageTransform) {
    const raw = await context.account.get(
      'image-transform',
      record.imageTransform.id
    );
    if (!raw || !isDeepStrictEqual(raw, record.imageTransform)) {
      throw new Error('OCR image transform differs from the preserved record');
    }
    original = await transformOriginal(context, raw, next);
    if (
      context.screenshots.has(raw.derivedImage.sha256) ||
      context.screenshots.has(raw.originalImage.sha256)
    ) {
      throw new Error('OCR transform references an account viewport');
    }
    await verifyOriginalBoundOcr(context.account, original, record);
    await replayTransform(context.account, raw);
    transform = publicTransform(raw);
    if (raw.sourceOcr) {
      await stageOcr(context, context.byId.get(raw.sourceOcr.id), next);
    }
    context.stagedTransforms.set(transform.id, transform);
    context.blobs.set(
      raw.derivedImage.sha256,
      await checkedBytes(context.account, raw.derivedImage)
    );
  } else {
    if (!original) {
      throw new Error('OCR source is not a published product image');
    }
    await verifyOriginalBoundOcr(context.account, original, record);
  }
  const safe = publicOcr(record, transform);
  context.blobs.set(
    record.rawTsv.sha256,
    await checkedBytes(context.account, record.rawTsv)
  );
  context.stagedOcr.set(record.id, safe);
}

function ocrContext(account, roots, records, transforms, sourceRecords) {
  const byImage = new Map();
  for (const record of records) {
    const values = byImage.get(record.imageHash) || [];
    values.push(record);
    byImage.set(record.imageHash, values);
  }
  return {
    account,
    roots,
    byImage,
    screenshots: privateViewportHashes(sourceRecords),
    transforms: new Map(
      transforms.map((record) => [record.derivedImage?.sha256, record])
    ),
    byId: new Map(records.map((record) => [record.id, record])),
    stagedOcr: new Map(),
    stagedTransforms: new Map(),
    blobs: new Map(),
  };
}

async function stageCandidates(context, records) {
  const rejected = [];
  for (const record of records) {
    if (
      !context.roots.has(record.imageHash) &&
      !context.roots.has(record.originalImageHash) &&
      !record.imageTransform
    ) {
      continue;
    }
    const planned = {
      ...context,
      stagedOcr: new Map(),
      stagedTransforms: new Map(),
      blobs: new Map(),
    };
    try {
      await stageOcr(planned, record);
      for (const field of ['stagedOcr', 'stagedTransforms', 'blobs']) {
        for (const [key, value] of planned[field]) {
          context[field].set(key, value);
        }
      }
    } catch (error) {
      rejected.push({ ocrId: record.id, reason: error.message });
    }
  }
  return rejected;
}

async function saveArtifacts(publicStore, context) {
  for (const [kind, records] of [
    ['ocr', context.stagedOcr],
    ['image-transform', context.stagedTransforms],
  ]) {
    for (const record of records.values()) {
      const previous = await publicStore.get(kind, record.id);
      if (previous) {
        await assertReusableArtifact(
          publicStore,
          context,
          kind,
          previous,
          record
        );
      }
    }
  }
  for (const [hash, bytes] of context.blobs) {
    if ((await publicStore.putBlob(bytes)).sha256 !== hash) {
      throw new Error('OCR artifact publication digest changed');
    }
  }
  for (const record of context.stagedTransforms.values()) {
    await publicStore.put('image-transform', record);
  }
  let published = 0,
    reused = 0;
  for (const record of context.stagedOcr.values()) {
    if (await publicStore.get('ocr', record.id)) {
      reused++;
    } else {
      await publicStore.put('ocr', record);
      published++;
    }
  }
  return { published, reused };
}

async function assertReusableArtifact(
  store,
  context,
  kind,
  previous,
  expected
) {
  if (previous.visibility === 'private') {
    throw new Error(
      'Private OCR artifacts cannot be reused as public provenance'
    );
  }
  const normalized =
    kind === 'ocr'
      ? publicOcr(
          previous,
          previous.imageTransform && publicTransform(previous.imageTransform)
        )
      : publicTransform(previous);
  if (!isDeepStrictEqual(normalized, expected)) {
    throw new Error(
      'Public OCR artifact conflicts with its original cached provenance'
    );
  }
  if (kind === 'ocr') {
    const original =
      previous.imageTransform?.originalImage ||
      context.roots.get(previous.imageHash);
    await verifyOriginalBoundOcr(store, original, previous);
  }
}

/** Publish cached label artifacts only; no recognition, source fetch or facts change. */
export async function publishPublicProductImageOcr(
  publicStore,
  accountStore,
  { publications = [], sourceRecords = [] } = {}
) {
  if (
    publicStore.visibility !== 'public' ||
    accountStore.visibility !== 'private'
  ) {
    throw new Error(
      'Cached product-image OCR publication needs public output and private source stores'
    );
  }
  const originals = await accountStore.list('ocr');
  const records = originals.filter((record) => record.visibility === 'private');
  const transforms = await accountStore.list('image-transform');
  const imageHashes = new Set(
    records.flatMap((record) => [record.imageHash, record.originalImageHash])
  );
  for (const transform of transforms) {
    imageHashes.add(transform.originalImage?.sha256);
  }
  const roots = await publicImageRoots(
    publicStore,
    accountStore,
    publications,
    sourceRecords,
    imageHashes
  );
  const context = ocrContext(
    accountStore,
    roots,
    originals,
    transforms,
    sourceRecords
  );
  const rejected = await stageCandidates(context, records);
  const { published, reused } = await saveArtifacts(publicStore, context);
  return {
    published,
    reused,
    transforms: context.stagedTransforms.size,
    artifacts: context.blobs.size,
    rejected,
  };
}
