import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AssociativeStore,
  RepositoryArchive,
  exportRepositoryArchive,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/urgent-icecream';
const original = new RepositoryArchive({
  directory: 'data/cases/vietnam-nha-trang',
});
const store = new AssociativeStore({
  directory: '/private/tmp/urgent-icecream-targeted-evidence',
});
const images = [
  {
    hash: 'c5801c68d08c5fe8c9c655c47f0877073b16b1729831f9336428190d3654bad9',
    purpose: 'laboratory-report-sample-identity',
  },
  {
    hash: '8bf6231701201cd92ddaee3cf38887262c7b88d1333982a4562cae8e9e9a6e61',
    purpose: 'laboratory-report-first-page',
  },
  {
    hash: '189a68860572709367700e60d87bf477806f54ad27565369bc60daefa92eb622',
    purpose: 'laboratory-report-nutrition-results',
  },
  {
    hash: '6583224988823985367b40e065aa6617fcbf984e30e3b2b5b9f0994d75a77ec2',
    purpose: 'marketplace-475ml-package-front',
  },
  {
    hash: 'ffec6f1c8b12f91819fd18e8f5c94505f948cd67674ceeee55762a8a14c3c774',
    purpose: 'marketplace-125ml-package-front',
  },
];
const evidence = await original.list('evidence');
const ocr = await original.list('ocr');
await mkdir(`${directory}/targeted-labels`, { recursive: true });
for (const image of images) {
  const attached = evidence.find(
    (record) => record.role === 'ocr' && record.image?.sha256 === image.hash
  );
  assert(attached, `Missing cached original: ${image.hash}`);
  const bytes = await original.blob(image.hash);
  assert.equal(sha256(bytes), image.hash);
  const blob = await store.putBlob(bytes);
  const path = `${directory}/targeted-labels/${image.hash}.webp`;
  await writeFile(path, bytes);
  await store.put('evidence', {
    id: `targeted-image:${image.hash}`,
    role: image.purpose,
    sourceAuthority: 'marketplace-published-image',
    url: attached.url,
    image: blob,
    originalEvidenceIds: evidence
      .filter((record) => record.image?.sha256 === image.hash)
      .map((record) => record.id),
    originalOcr: ocr
      .filter((record) => record.imageHash === image.hash)
      .map(({ id, text, confidence, engine }) => ({
        id,
        text,
        confidence,
        engine,
      })),
    path,
    manuallyReviewed: true,
  });
}

const review = JSON.parse(
  await readFile(`${directory}/targeted-spec-review.json`, 'utf8')
);
await store.put('spec-review', review);

const attemptsFile = `${directory}/targeted-source-cache.json`;
let attempts = [];
try {
  attempts = JSON.parse(await readFile(attemptsFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
const targets = [
  'https://happydurian.vn/',
  'http://kidofoods.vn/kem/merino',
  'https://www.kdc.vn/',
];
let manufacturerRequestsPerformed = 0;
if (process.argv.includes('--online')) {
  for (const url of targets) {
    if (attempts.some((attempt) => attempt.url === url)) {
      continue;
    }
    let attempt;
    try {
      manufacturerRequestsPerformed++;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const hash = sha256(bytes);
      const path = `${directory}/sources/${hash}.html.gz`;
      await writeFile(path, gzipSync(bytes));
      attempt = {
        url,
        finalUrl: response.url,
        status: response.status,
        observedAt: new Date().toISOString(),
        sha256: hash,
        bytes: bytes.length,
        path,
      };
    } catch (error) {
      attempt = {
        url,
        observedAt: new Date().toISOString(),
        error: error.message,
        causeCode: error.cause?.code,
      };
    }
    attempts.push(attempt);
    await writeFile(attemptsFile, `${JSON.stringify(attempts, null, 2)}\n`);
    if (url !== targets.at(-1)) {
      await delay(10000);
    }
  }
}
for (const attempt of attempts) {
  const { sha256: contentSha256, bytes: byteLength, ...capture } = attempt;
  const record = {
    id: `research-attempt:${sha256(attempt.url)}`,
    ...capture,
    ...(contentSha256 ? { contentSha256, byteLength } : {}),
  };
  if (attempt.path) {
    record.source = await store.putBlob(
      gunzipSync(await readFile(attempt.path))
    );
    record.format = 'html';
  }
  await store.put('research-attempt', record);
}
const exported = await exportRepositoryArchive({
  store,
  directory: `${directory}/targeted-evidence-archive`,
  caseMetadata: {
    status: 'partial-manufacturer-evidence-pending-current-label',
    scope: 'Strict chocolate ice cream; isolated from purchase ranking',
    downloadsFromLazada: 0,
  },
});
const replay = new RepositoryArchive({
  directory: `${directory}/targeted-evidence-archive`,
});
const verification = await replay.verify();
assert.equal(verification.valid, true);
assert.deepEqual(await replay.get('spec-review', review.id), review);
for (const image of images) {
  assert.equal(sha256(await replay.blob(image.hash)), image.hash);
  assert(
    (await replay.graph('evidence', `targeted-image:${image.hash}`)).names.has(
      `string:${image.hash}`
    )
  );
}
const validation = {
  review: review.id,
  isolatedArchive: exported,
  verification,
  validatedOriginalImages: images.length,
  sharedStoreWrites: 0,
  lazadaDownloads: 0,
  manufacturerRequestsRecorded: attempts.length,
  manufacturerRequestsPerformed,
};
await writeFile(
  `${directory}/targeted-validation.json`,
  `${JSON.stringify(validation, null, 2)}\n`
);
console.log(JSON.stringify(validation));
