import { readFile, writeFile } from 'node:fs/promises';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/decimal-ocr';
const replay = JSON.parse(await readFile(`${directory}/replay.json`, 'utf8'));
const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const original = await readFile(replay.sourceOriginalPath);
const originalTsv = await readFile(`${directory}/original-psm11.tsv`);
if (
  sha256(original) !== replay.sourceOriginalSha256 ||
  sha256(originalTsv) !== replay.sourceRawTsvSha256
) {
  throw new Error('Decimal OCR original image or TSV digest mismatch');
}
const source = await store.get('ocr', replay.sourceOcrId);
if (
  source?.imageHash !== replay.sourceOriginalSha256 ||
  source.rawTsv?.sha256 !== replay.sourceRawTsvSha256
) {
  throw new Error('Decimal OCR replay requires its original full-image OCR');
}
const records = [];
for (const row of replay.rows) {
  const image = await readFile(`${directory}/${row.role}-crop.png`);
  const tsv = await readFile(`${directory}/${row.role}-crop.tsv`);
  const result = row.result;
  if (
    sha256(image) !== result.imageHash ||
    sha256(tsv) !== result.rawTsv?.sha256 ||
    result.imageTransform?.originalImage.sha256 !==
      replay.sourceOriginalSha256 ||
    result.imageTransform.sourceOcr?.id !== source.id ||
    result.imageTransform.sourceOcr.rawTsv.sha256 !== source.rawTsv.sha256 ||
    result.requiresReview !== true ||
    row.factAppliedToProduct !== false
  ) {
    throw new Error('Decimal OCR derivation or review-only receipt mismatch');
  }
  records.push({ result, image, tsv });
}

// Validate every source before importing. This replays committed bytes only;
// it never invokes an OCR engine, requests a URL or approves product facts.
await store.putBlob(original);
await store.putBlob(originalTsv);
for (const { result, image, tsv } of records) {
  await store.putBlob(image);
  await store.putBlob(tsv);
  await store.put('image-transform', result.imageTransform);
  const ocr = { ...result };
  delete ocr.cacheHit;
  delete ocr.transformCacheHit;
  await store.put('ocr', ocr);
}
const receipt = {
  replayedAt: new Date().toISOString(),
  sourceOriginalSha256: replay.sourceOriginalSha256,
  sourceOcrId: source.id,
  importedDerivedOcr: records.map(({ result }) => result.id),
  importedTransforms: records.map(({ result }) => result.imageTransform.id),
  downloads: 0,
  ocrEngineInvocations: 0,
  newProductFacts: 0,
  identityMatched: false,
};
await writeFile(
  `${directory}/archive-replay.json`,
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
