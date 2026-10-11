import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import {
  redactPublicSecrets,
  sanitizePublicData,
  sanitizePublicHtml,
} from '../src/archive.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/ice-current-primary-followup';
const draftDirectory = '.lazada-search/drafts/ice-current-primary-followup';
const selectedSkus = [
  '1880785864_VNAMZ-8527716006',
  '1880785864_VNAMZ-8527716007',
  '3047790409_VNAMZ-14661118301',
];
const originals = [
  {
    prefix: 'happy-trade-association',
    originalSha256:
      '0b5a69acfe244a27f3586d80f19558db2d2b26e0716654a0ebe5c1469c81f705',
    excerpt: 'Công ty TNHH TM-DV Happy Durian',
  },
  {
    prefix: 'lotte-manufacturer-index',
    originalSha256:
      '1b8edab8db1e0319f686723fefb81187ecbdfd7b0b800df7bd41b19ee74a119c',
    excerpt: '빵빠레',
  },
];
const supportingFiles = [
  'search-receipt.json',
  'web-extract-provenance.json',
  'happy-trade-association-receipt.json',
  'happy-trade-association-original-receipt.json',
  'lotte-manufacturer-index-original-receipt.json',
  'happy-trade-association.web-extract.txt',
  'lotte-manufacturer-index.web-extract.txt',
];

const normalizeText = (text) => text.replace(/\s+/gu, ' ').trim();

function safeHtml(bytes) {
  const { document } = parseHTML(sanitizePublicHtml(bytes.toString()));
  for (const element of document.querySelectorAll('input[type="hidden"]')) {
    element.remove();
  }
  return Buffer.from(redactPublicSecrets(document.toString()));
}

function assertPublicHtml(bytes, expected) {
  assert.equal(redactPublicSecrets(bytes.toString()), bytes.toString());
  assert.deepEqual(
    safeHtml(bytes),
    bytes,
    'HTML must be sanitized before replay'
  );
  const { document } = parseHTML(bytes.toString());
  assert.equal(
    document.querySelectorAll('script:not([type="application/ld+json"])')
      .length,
    0
  );
  assert.equal(document.querySelectorAll('input[type="hidden"]').length, 0);
  assert.ok(
    normalizeText(document.body.textContent).includes(expected.excerpt)
  );
  if (expected.prefix === 'lotte-manufacturer-index') {
    assert.ok(
      document.querySelector('form[action="/contact-us"][method="POST"]')
    );
    assert.ok(document.body.textContent.includes('Contact Us'));
  }
}

function rebasePublicData(value, sources) {
  if (Array.isArray(value)) {
    return value.map((child) => rebasePublicData(child, sources));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const publicKey =
        key === 'phone'
          ? 'publicCompanyTelephone'
          : key === 'address'
            ? 'publicCompanyLocation'
            : key;
      output[publicKey] = rebasePublicData(child, sources);
    }
    const source = sources.find(
      (candidate) => candidate.originalSourceSha256 === output.sourceSha256
    );
    if (source) {
      output.originalSourceSha256 = source.originalSourceSha256;
      output.sourceSha256 = source.sourceSha256;
    }
    return sanitizePublicData(output);
  }
  if (typeof value === 'string') {
    let output = value.replaceAll(draftDirectory, directory);
    for (const source of sources) {
      output = output.replaceAll(
        `${directory}/${source.prefix}-curl-original.html`,
        source.artifact
      );
    }
    return sanitizePublicData(output);
  }
  return value;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function publishSource(expected) {
  const bytes = await readFile(
    join(draftDirectory, `${expected.prefix}-curl-original.html`)
  );
  const receipt = JSON.parse(
    await readFile(join(draftDirectory, `${expected.prefix}-curl-receipt.json`))
  );
  assert.equal(sha256(bytes), expected.originalSha256);
  assert.equal(receipt.sha256, expected.originalSha256);
  assert.equal(receipt.bytes, bytes.length);
  assert.equal(receipt.curlExitCode, 0);
  assert.equal(receipt.httpResult.split(' ')[0], '200');
  assert.equal(receipt.tlsVerification, true);
  assert.equal(receipt.challengeSuspected, false);
  const publicBytes = safeHtml(bytes);
  assertPublicHtml(publicBytes, expected);
  const artifact = join(directory, `${expected.prefix}.public.html`);
  await writeFile(artifact, publicBytes);
  const source = {
    prefix: expected.prefix,
    url: receipt.url,
    finalUrl: receipt.httpResult.slice(4),
    observedAt: receipt.observedAt,
    artifact,
    sourceSha256: sha256(publicBytes),
    byteLength: publicBytes.length,
    originalSourceSha256: expected.originalSha256,
    originalByteLength: bytes.length,
    originalDigestCheckedBeforeRedaction: true,
    originalResponsePrivate: true,
    originalResponsePublished: false,
    redactionApplied: !publicBytes.equals(bytes),
    redactionMethod:
      'public HTML and embedded-secret sanitizers; hidden controls removed',
    executableScriptsRemoved: true,
    rawResponseHeadersPublished: false,
    httpStatus: 200,
    tlsVerification: true,
    credentialsSent: false,
    authority:
      expected.prefix === 'lotte-manufacturer-index'
        ? 'manufacturer-family-index'
        : 'trade-association-member-list',
    exactCurrentProductIdentityMatched: false,
    reviewOnly: true,
  };
  await writeJson(
    join(directory, `${expected.prefix}-capture-receipt.json`),
    source
  );
  return source;
}

function assertReviewOnly(review) {
  assert.deepEqual(
    review.rows.map((row) => row.sku),
    selectedSkus
  );
  assert.equal(review.numericApprovals, 0);
  assert.equal(review.newLazadaRequests, 0);
  assert.equal(review.outreachMessages, 0);
  for (const row of review.rows) {
    assert.deepEqual(row.approvedNewFields, {});
    assert.equal(row.storeUpdatesApplied, false);
    assert.equal(row.currentFormulaIdentityMatched, false);
  }
}

async function publishDraft() {
  await mkdir(directory, { recursive: true });
  const sources = [];
  for (const original of originals) {
    sources.push(await publishSource(original));
  }
  const originalReview = JSON.parse(
    await readFile(join(draftDirectory, 'review.json'))
  );
  assertReviewOnly(originalReview);
  const review = rebasePublicData(originalReview, sources);
  delete review.primaryOriginals;
  review.primarySources = sources;
  review.transportReceipts = [
    ...supportingFiles.filter((name) => name.endsWith('.json')),
    ...sources.map((source) => `${source.prefix}-capture-receipt.json`),
  ].map((name) => join(directory, name));
  review.publication = {
    safePublicDerivativesOnly: true,
    rawOriginalsRemainPrivate: true,
    rawResponseHeadersPublished: false,
    sourceFactApprovals: 0,
    preserveExistingSellingUnits: true,
  };
  assert.deepEqual(
    review.rows.map(
      ({ sku, existingSellingUnit, strictChocolateEligible }) => ({
        sku,
        existingSellingUnit,
        strictChocolateEligible,
      })
    ),
    originalReview.rows.map(
      ({ sku, existingSellingUnit, strictChocolateEligible }) => ({
        sku,
        existingSellingUnit,
        strictChocolateEligible,
      })
    )
  );
  await writeJson(join(directory, 'review.json'), review);
  await writeJson(join(directory, 'public-source-provenance.json'), {
    schemaVersion: 1,
    reviewedAt: review.reviewedAt,
    rawOriginalsPublished: false,
    sources,
  });
  for (const name of supportingFiles) {
    const text = await readFile(join(draftDirectory, name), 'utf8');
    if (name.endsWith('.json')) {
      await writeJson(
        join(directory, name),
        rebasePublicData(JSON.parse(text), sources)
      );
    } else {
      await writeFile(join(directory, name), rebasePublicData(text, sources));
    }
  }
}

if (process.argv.includes('--publish-draft')) {
  await publishDraft();
}
const options = parseArguments(
  process.argv
    .slice(2)
    .filter((argument) => argument !== '--publish-draft')
    .concat(['--offline', '--no-ocr', '--account', ''])
);
assert.ok(!options.account, 'Only a public store can receive source reviews');
const store = configuredStore(options);
const reviewBytes = await readFile(join(directory, 'review.json'));
const review = JSON.parse(reviewBytes);
assertReviewOnly(review);
assert.equal(review.publication.rawOriginalsRemainPrivate, true);
assert.equal(reviewBytes.toString().includes('.lazada-search/'), false);
assert.equal(review.primarySources.length, originals.length);
const validated = [];
for (const [index, source] of review.primarySources.entries()) {
  const bytes = await readFile(source.artifact);
  assert.equal(source.originalSourceSha256, originals[index].originalSha256);
  assert.equal(source.originalResponsePublished, false);
  assert.equal(sha256(bytes), source.sourceSha256);
  assert.equal(bytes.length, source.byteLength);
  assertPublicHtml(bytes, originals[index]);
  validated.push({ bytes, source });
}
const documentFiles = [
  ...supportingFiles,
  ...originals.map(({ prefix }) => `${prefix}-capture-receipt.json`),
  'public-source-provenance.json',
  'README.md',
];
for (const name of documentFiles) {
  const bytes = await readFile(join(directory, name));
  assert.equal(redactPublicSecrets(bytes.toString()), bytes.toString());
  assert.equal(bytes.toString().includes('.lazada-search/'), false);
  validated.push({
    bytes,
    source: {
      artifact: join(directory, name),
      sourceSha256: sha256(bytes),
      byteLength: bytes.length,
      authority: 'source-review-supporting-evidence',
      reviewOnly: true,
    },
  });
}

// Everything is validated before writing. This imports public evidence only;
// it never requests a URL, runs OCR, sends outreach or changes product facts.
const sourceArtifactIds = [];
for (const { bytes, source } of validated) {
  const blob = await store.putBlob(bytes);
  const record = {
    id: `ice-current-primary-source:${sha256(source.artifact)}`,
    ...source,
    blob,
    visibility: 'public',
    reviewOnly: true,
    factoryFactsApplied: 0,
  };
  await store.put('source-artifact', record);
  sourceArtifactIds.push(record.id);
}
await store.put('source-review', {
  id: `ice-current-primary-followup:${sha256(reviewBytes)}`,
  reviewedAt: review.reviewedAt,
  source: await store.putBlob(reviewBytes),
  format: 'json',
  sourceArtifactIds,
  reviewOnly: true,
  factoryFactsApplied: 0,
  visibility: 'public',
});
const replay = {
  replayedAt: new Date().toISOString(),
  sourceReviewSha256: sha256(reviewBytes),
  sourceArtifacts: sourceArtifactIds,
  originalSourceHashMetadataVerified: originals.map(
    ({ originalSha256 }) => originalSha256
  ),
  originalSourceBytesValidatedDuringThisRun:
    process.argv.includes('--publish-draft'),
  safePublicSourceHashesVerified: review.primarySources.map(
    ({ sourceSha256 }) => sourceSha256
  ),
  sourceOriginalsPublished: false,
  responseHeadersPublished: false,
  selectedSkuRows: selectedSkus,
  downloads: 0,
  ocrEngineInvocations: 0,
  outreachMessages: 0,
  newProductFacts: 0,
};
await writeJson(join(directory, 'archive-replay.json'), replay);
console.log(JSON.stringify(replay));
