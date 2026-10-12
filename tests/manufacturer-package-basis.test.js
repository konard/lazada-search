import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { ManufacturerSourceCache } from '../src/manufacturer-source-cache.js';
import { reviewManufacturerResearch } from '../src/manufacturer-research.js';
import { parseTsv } from '../src/ocr.js';
import { sha256 } from '../src/util.js';

const identity = {
  brand: 'Factory',
  name: 'Chocolate bottle',
  flavour: 'chocolate',
  coreFlavour: 'chocolate',
  market: 'VN',
  packageType: 'bottle',
  variantCode: 'test-chocolate-130ml',
  netVolumeMl: 130,
  innerPackCount: 1,
  currentFormula: true,
};

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'package-basis-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

function cache(store, brand = 'Factory', domain = 'factory.example') {
  return new ManufacturerSourceCache({
    store,
    offline: true,
    registry: [{ brand, domains: [domain.replace(/^www\./u, '')] }],
  });
}

async function source(store, text) {
  const bytes = Buffer.from(text);
  return cache(store).importOriginal(
    {
      brand: 'Factory',
      url: 'https://factory.example/chocolate',
      observedAt: '2026-10-11T06:00:00Z',
      contentType: 'text/html',
      sourceSha256: sha256(bytes),
    },
    bytes
  );
}

function reviewed(original, excerpt, changes = {}) {
  return {
    reviewedBy: 'Negative and positive source-basis regression',
    reason: 'Exact inner package is independently matched for this fixture.',
    identity: { listing: { ...identity }, manufacturer: { ...identity } },
    sourceIdentities: { [original.id]: { ...identity } },
    requiredFields: ['proteinPerPackageG'],
    facts: {
      proteinPerPackageG: {
        value: 2,
        unit: 'g/package',
        basis: 'per one package',
        basisExcerpt: 'per package',
        excerpt,
        valueExcerpt: '2g',
        sourceId: original.id,
        sourceSha256: original.blob.sha256,
        ...changes,
      },
    },
  };
}

test('100g, 100ml and serving values cannot be relabelled as package protein', async (t) => {
  const store = await temporary(t);
  for (const basis of ['per 100g', 'per 100ml', 'per serving']) {
    const text = `Protein 2g ${basis}`;
    const original = await source(store, text);
    await assert.rejects(
      reviewManufacturerResearch(
        store,
        reviewed(original, text, { basisExcerpt: basis })
      ),
      /Package nutrition basis must be explicitly stated/u,
      basis
    );
  }
  assert.equal((await store.list('manufacturer-research-review')).length, 0);
});

test('package basis must occur in the original source and reviewed nutrient excerpt', async (t) => {
  const store = await temporary(t);
  const original = await source(store, 'Protein 2g per package');
  for (const change of [
    { basisExcerpt: undefined },
    { basisExcerpt: 'per bottle' },
    { excerpt: 'Protein 2g' },
  ]) {
    await assert.rejects(
      reviewManufacturerResearch(
        store,
        reviewed(original, 'Protein 2g per package', change)
      ),
      /Package nutrition basis must be explicitly stated/u
    );
  }
});

test('servings per package is a count, not a package nutrient column', async (t) => {
  const store = await temporary(t);
  const text = 'Servings per package: 4; Protein 2g per serving';
  const original = await source(store, text);
  await assert.rejects(
    reviewManufacturerResearch(store, reviewed(original, text)),
    /Package nutrition basis must be explicitly stated/u
  );
});

test('direct protein grams per inner package remain independent of seller cartons', async (t) => {
  const store = await temporary(t);
  for (const basis of ['per package', 'per bottle', 'Mỗi chai']) {
    const text = `Protein 2g ${basis}`;
    const original = await source(store, text);
    const review = reviewed(original, text, { basisExcerpt: basis });
    review.identity.listing.sellingPackCount = 24;
    const result = await reviewManufacturerResearch(store, review);
    assert.equal(result.facts.proteinPerPackageG.value, 2);
    assert.equal(result.identityMatched, true);
    assert.deepEqual(result.blockingEvidenceGaps, []);
  }
});

test('package protein cannot use ambiguous, missing or aggregate package identity', async (t) => {
  const store = await temporary(t);
  const text = 'Protein 2g per package';
  const original = await source(store, text);
  for (const key of ['listing', 'manufacturer', 'source']) {
    const review = reviewed(original, text);
    const target =
      key === 'source'
        ? review.sourceIdentities[original.id]
        : review.identity[key];
    delete target.innerPackCount;
    await assert.rejects(
      reviewManufacturerResearch(store, review),
      /exact matched single-inner-package quantity/u,
      key
    );
  }
  const aggregate = reviewed(original, text);
  for (const item of [
    aggregate.identity.listing,
    aggregate.identity.manufacturer,
    aggregate.sourceIdentities[original.id],
  ]) {
    item.innerPackCount = 24;
  }
  await assert.rejects(
    reviewManufacturerResearch(store, aggregate),
    /exact matched single-inner-package quantity/u
  );
  const missing = reviewed(original, text);
  for (const item of [
    missing.identity.listing,
    missing.identity.manufacturer,
    missing.sourceIdentities[original.id],
  ]) {
    delete item.netVolumeMl;
  }
  await assert.rejects(
    reviewManufacturerResearch(store, missing),
    /exact matched single-inner-package quantity/u
  );
});

test('milligrams and inferred serving multiplication cannot approve package grams', async (t) => {
  const store = await temporary(t);
  let original = await source(store, 'Protein 2mg per package');
  await assert.rejects(
    reviewManufacturerResearch(
      store,
      reviewed(original, 'Protein 2mg per package', { valueExcerpt: '2mg' })
    ),
    /original gram unit/u
  );
  original = await source(
    store,
    'Protein 2g per serving; 4 servings per package'
  );
  await assert.rejects(
    reviewManufacturerResearch(
      store,
      reviewed(original, 'Protein 2g per serving; 4 servings per package', {
        value: 8,
        sourceValue: 2,
      })
    ),
    /cannot infer a different quantity/u
  );
});

test('original cached Häagen-Dazs image and TSV cannot promote density or a serving count to package protein', async (t) => {
  const store = await temporary(t);
  const plan = JSON.parse(
    await readFile(
      'docs/acceptance/manufacturer-research/cached-primary-plan.json',
      'utf8'
    )
  );
  const request = plan.imports.find(
    (item) =>
      item.sourceSha256 ===
      '67907ce23aa9ff33a8431ad6ebe68289d842ab83f14586abf9d5ac7a5ab3c9e8'
  );
  const originalCache = cache(
    store,
    request.brand,
    new URL(request.url).hostname
  );
  const parentBytes = Buffer.from(`<img src="${request.url}">`);
  const parent = await originalCache.importOriginal(
    {
      brand: request.brand,
      url: 'https://www.haagendazs.com.sg/products/belgian-chocolate-pint',
      captureTimeUnknown: true,
      contentType: 'text/html',
      sourceSha256: sha256(parentBytes),
    },
    parentBytes
  );
  const original = await originalCache.importOriginal(
    { ...request, parentSourceId: parent.id },
    await readFile(request.artifact)
  );
  const bytes = await readFile(
    'docs/acceptance/decimal-ocr/original-psm11.tsv'
  );
  assert.equal(
    sha256(bytes),
    '0ce3ceffc726fd6299cfad3a7ced6d9166fe5f7e93600f5f03dce533a6e416c3'
  );
  const preservedOcr = JSON.parse(
    await readFile(
      'docs/acceptance/manufacturer-research/second-ocr-pass.json',
      'utf8'
    )
  ).find(
    (entry) =>
      entry.imageHash === original.blob.sha256 &&
      entry.rawTsv?.sha256 === sha256(bytes)
  );
  assert.ok(preservedOcr, 'Original label OCR metadata must be archived');
  const parsed = parseTsv(bytes.toString('utf8'));
  assert.equal(preservedOcr.text, parsed.text);
  assert.equal(preservedOcr.confidence, parsed.confidence);
  assert.deepEqual(preservedOcr.words, parsed.words);
  const ocr = { ...preservedOcr, rawTsv: await store.putBlob(bytes) };
  await store.put('ocr', ocr);
  for (const basis of ['Per 100g', 'Per Package']) {
    const review = reviewed(original, ocr.text, {
      value: 45,
      valueExcerpt: '45g',
      basisExcerpt: basis,
      ocrId: ocr.id,
    });
    // This optimistic fixture identity deliberately exercises the source
    // guard. It does not establish a real marketplace/formula match.
    for (const item of [
      review.identity.listing,
      review.identity.manufacturer,
      review.sourceIdentities[original.id],
    ]) {
      item.brand = request.brand;
    }
    await assert.rejects(
      reviewManufacturerResearch(store, review),
      /Package nutrition basis must be explicitly stated/u,
      basis
    );
  }
});
