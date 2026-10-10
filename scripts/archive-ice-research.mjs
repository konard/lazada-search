import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import {
  AssociativeStore,
  RepositoryArchive,
  exportRepositoryArchive,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

const root = 'docs/acceptance/ice-dual-units';
const directory = `${root}/evidence-archive`;
const store = new AssociativeStore({
  directory: '/private/tmp/lazada-ice-dual-units-public',
});
const seen = new Set();
const sources = [];
const sourceAuthority = (value) =>
  value.sourceAuthority ||
  value.authority ||
  value.kind ||
  'Reviewed source capture';
async function archiveArtifact(value) {
  const path = value.artifactPath || value.artifact || value.path;
  const expected = value.artifactSha256 || value.sourceSha256 || value.sha256;
  if (
    typeof path === 'string' &&
    /^[a-f\d]{64}$/u.test(expected || '') &&
    !seen.has(path)
  ) {
    assert.ok(path.startsWith('docs/') || path.startsWith('data/'));
    seen.add(path);
    const saved = await readFile(path);
    const bytes = path.endsWith('.gz') ? gunzipSync(saved) : saved;
    assert.equal(sha256(bytes), expected, path);
    const original = await store.putBlob(bytes);
    const capture = {
      id: `ice-source:${expected}`,
      sourceUrl: value.sourceUrl || value.url || null,
      path,
      contentSha256: expected,
      original,
      sourceAuthority: sourceAuthority(value),
      publicEvidenceOnly: true,
    };
    await store.put('ice-source', capture);
    sources.push(capture);
  }
}

async function archiveArtifacts(value) {
  if (!value || typeof value !== 'object') {
    return;
  }
  await archiveArtifact(value);
  for (const child of Object.values(value)) {
    await archiveArtifacts(child);
  }
}

// Capture digests describe provenance; only stored blob references carry bytes.
function provenanceMetadata(value) {
  if (Array.isArray(value)) {
    return value.map(provenanceMetadata);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      provenanceMetadata(child),
    ])
  );
  if (
    /^[a-f\d]{64}$/u.test(result.sha256 || '') &&
    Number.isSafeInteger(result.bytes)
  ) {
    result.contentSha256 = result.sha256;
    result.byteLength = result.bytes;
    delete result.sha256;
    delete result.bytes;
  }
  return result;
}
for (const group of ['merino', 'korean', 'gelato-thai']) {
  const path = `${root}/${group}-review.json`;
  const bytes = await readFile(path);
  const review = JSON.parse(bytes);
  await archiveArtifacts(review);
  await store.put('ice-review', {
    id: `ice-review:${group}`,
    path,
    original: await store.putBlob(bytes),
    review: provenanceMetadata(review),
  });
}
const rankings = JSON.parse(
  await readFile('docs/tables/ice-unit-rankings.json', 'utf8')
);
await store.put('ice-report', { id: 'ice-report:unit-rankings', ...rankings });
const exported = await exportRepositoryArchive({
  store,
  directory,
  caseMetadata: {
    scope:
      'Ten exact selected chocolate-ice-cream candidates; independent unit rankings and manufacturer research',
    market: 'Vietnam',
    deliveryArea: 'Nha Trang',
    publicEvidenceOnly: true,
    complete: false,
    lazadaDownloads: 0,
  },
});
const replay = new RepositoryArchive({ directory });
const verification = await replay.verify();
assert.equal(verification.valid, true);
for (const source of sources) {
  assert.equal(
    sha256(await replay.blob(source.contentSha256)),
    source.contentSha256
  );
}
const receipt = {
  validatedAt: new Date().toISOString(),
  sourceArtifacts: sources.length,
  lazadaDownloads: 0,
  exporterDownloads: 0,
  exported,
  verification,
};
await writeFile(
  `${root}/archive-validation.json`,
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
