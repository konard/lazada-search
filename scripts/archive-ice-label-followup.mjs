import { readFile, writeFile } from 'node:fs/promises';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/ice-exact-label-followup';
const provenance = JSON.parse(
  await readFile(`${directory}/public-source-provenance.json`, 'utf8')
);
const reviewBytes = await readFile(`${directory}/review.json`);
const review = JSON.parse(reviewBytes);
const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const sources = [];
for (const source of provenance.sources) {
  const bytes = await readFile(source.path);
  if (sha256(bytes) !== source.publicDerivativeSha256) {
    throw new Error('Public selected ice source derivative digest mismatch');
  }
  sources.push({ ...source, bytes, role: 'redacted-selected-page' });
}
for (const source of review.publication.originalImageCopies) {
  const bytes = await readFile(source.path);
  if (sha256(bytes) !== source.sha256) {
    throw new Error('Original ice package-front image digest mismatch');
  }
  sources.push({ ...source, bytes, role: 'original-package-front' });
}
if (
  review.rows.length !== 14 ||
  review.counts.newManufacturerApprovals !== 0 ||
  review.counts.newExactNumericalFieldsResolved !== 0
) {
  throw new Error(
    'Follow-up must retain every candidate without fact approvals'
  );
}

// Validate first, then replay repository bytes. Source reviews add provenance;
// they never approve current nutrition, alter prices or invoke a browser/OCR.
const records = [];
for (const { bytes, ...source } of sources) {
  const blob = await store.putBlob(bytes);
  const record = {
    id: `ice-label-source:${blob.sha256}`,
    ...source,
    ...(source.role === 'redacted-selected-page' ? { html: blob } : { blob }),
    reviewOnly: true,
    visibility: 'public',
  };
  await store.put('source-artifact', record);
  records.push(record.id);
}
await store.put('source-review', {
  id: `ice-label-followup:${sha256(reviewBytes)}`,
  reviewedAt: review.reviewedAt,
  source: await store.putBlob(reviewBytes),
  format: 'json',
  sourceArtifactIds: records,
  reviewOnly: true,
  factoryFactsApplied: 0,
  visibility: 'public',
});
const receipt = {
  replayedAt: new Date().toISOString(),
  sourceReviewSha256: sha256(reviewBytes),
  sourceArtifacts: records,
  downloads: 0,
  ocrEngineInvocations: 0,
  newProductFacts: 0,
  privateOriginalsPublished: false,
};
await writeFile(
  `${directory}/archive-replay.json`,
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
