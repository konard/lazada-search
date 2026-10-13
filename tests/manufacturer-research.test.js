import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler } from '../src/cache.js';
import {
  ManufacturerSourceCache,
  manufacturerRequest,
  manufacturerSourceId,
} from '../src/manufacturer-source-cache.js';
import {
  ManufacturerResearch,
  manufacturerIdentityGaps,
  reviewManufacturerResearch,
} from '../src/manufacturer-research.js';
import { sha256 } from '../src/util.js';
import { LazadaSearch } from '../src/application.js';
import { parseTsv } from '../src/ocr.js';

const registry = [
  {
    brand: 'Factory',
    domains: ['factory.example'],
    assetDomains: ['images.factory.example'],
  },
  { brand: 'Other owned brand', domains: ['factory.example'] },
];
const request = { brand: 'Factory', url: 'https://factory.example/chocolate' };
const originalDate = '2026-10-10T12:00:00.000Z';
const identity = {
  brand: 'Factory',
  name: 'Belgian chocolate',
  flavour: 'chocolate',
  coreFlavour: 'chocolate',
  market: 'VN import FR',
  packageType: 'pint',
  gtin: '3415581113181',
  netVolumeMl: 473,
  innerPackCount: 1,
  currentFormula: true,
};

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'manufacturer-research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}

function sources(store, options = {}) {
  return new ManufacturerSourceCache({
    store,
    registry,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    ...options,
  });
}

async function imported(
  cache,
  input = request,
  html = '473ml; Protein 4g per 100ml'
) {
  const bytes = Buffer.from(html);
  return await cache.importOriginal(
    {
      ...input,
      sourceSha256: sha256(bytes),
      contentType: 'text/html',
      observedAt: originalDate,
      originalArtifact: 'committed/original.html',
    },
    bytes
  );
}

function reviewed(source, changes = {}) {
  return {
    reviewedBy: 'Exact label reviewer',
    reason: 'EAN, export market, flavour and selected package match.',
    identity: { listing: { ...identity }, manufacturer: { ...identity } },
    sourceIdentities: { [source.id]: { ...identity } },
    requiredFields: ['netMassG', 'netVolumeMl', 'proteinPer100ml'],
    facts: {
      netVolumeMl: {
        value: 473,
        unit: 'ml',
        basis: 'one inner pint',
        excerpt: '473ml',
        valueExcerpt: '473ml',
        sourceId: source.id,
        sourceSha256: source.blob.sha256,
      },
      proteinPer100ml: {
        value: 4,
        unit: 'g/100ml',
        basis: 'per 100 ml',
        excerpt: 'Protein 4g per 100ml',
        valueExcerpt: '4g',
        basisExcerpt: 'per 100ml',
        sourceId: source.id,
        sourceSha256: source.blob.sha256,
      },
    },
    ...changes,
  };
}

test('public POST bodies, methods and representation headers isolate exact variants at a shared endpoint', async (t) => {
  const store = await temporary(t);
  const calls = [];
  const cache = sources(store, {
    fetchSource: async (url, options) => {
      calls.push({ url, ...options });
      return new globalThis.Response(
        JSON.stringify({ requested: options.body }),
        { headers: { 'content-type': 'application/json' } }
      );
    },
  });
  const chocolate = {
    ...request,
    url: 'https://factory.example/get_volume_list',
    method: 'POST',
    body: 'prod_idx=774&lang=EN',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
  const vanilla = { ...chocolate, body: 'prod_idx=773&lang=EN' };
  const [one, two] = await Promise.all([
    cache.capture(chocolate),
    cache.capture(vanilla),
  ]);
  assert.notEqual(one.id, two.id);
  assert.notEqual(one.blob.sha256, two.blob.sha256);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].redirect, 'manual');
  assert.equal((await cache.capture(chocolate)).cacheHit, true);
  assert.equal(calls.length, 2);
  assert.equal(
    manufacturerRequest(chocolate).fingerprint,
    manufacturerRequest({
      ...chocolate,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }).fingerprint
  );
  assert.notEqual(
    manufacturerRequest(chocolate).fingerprint,
    manufacturerRequest({
      ...chocolate,
      headers: { accept: 'application/json' },
    }).fingerprint
  );
});

test('shared owner domains reuse bytes while preserving separate brand provenance records', async (t) => {
  const store = await temporary(t);
  let downloads = 0;
  const cache = sources(store, {
    fetchSource: async () => {
      downloads++;
      return new globalThis.Response('Family catalogue');
    },
  });
  const one = await cache.capture(request);
  const two = await cache.capture({ ...request, brand: 'Other owned brand' });
  assert.notEqual(one.id, two.id);
  assert.equal(one.blob.sha256, two.blob.sha256);
  assert.equal(
    (await store.get('manufacturer-source', one.id)).brand,
    'Factory'
  );
  assert.equal(downloads, 1);
});

test('completed originals replay across collector restarts and retain actual dates without a download', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const restarted = sources(store, {
    offline: true,
    fetchSource: () => {
      throw new Error('Must not download');
    },
  });
  const replay = await restarted.capture(request);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.blob.sha256, source.blob.sha256);
  assert.equal(replay.observedAt, originalDate);
  assert.deepEqual(restarted.cache.stats, {
    hits: 1,
    misses: 0,
    downloads: 0,
    revalidated: 0,
  });
  const graph = await store.graph('manufacturer-source', source.id);
  assert.ok(graph.links.length > 20);
  const lino = await readFile(
    store.recordPath('manufacturer-source', source.id),
    'utf8'
  );
  assert.ok(lino.includes(source.blob.sha256));
});

test('failed HTTP and transport requests are negatively cached until expiry or explicit refresh', async (t) => {
  const store = await temporary(t);
  let now = 10000,
    calls = 0;
  const cache = sources(store, {
    now: () => now,
    failureTtlMs: 1000,
    fetchSource: async () => {
      calls++;
      return new globalThis.Response('Unavailable', { status: 503 });
    },
  });
  const failed = await cache.capture(request);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.httpStatus, 503);
  assert.equal((await cache.capture(request)).cacheHit, true);
  assert.equal(calls, 1);
  now = 11001;
  assert.equal((await cache.capture(request)).cacheHit, false);
  assert.equal(calls, 2);
  await cache.capture({ ...request, refresh: true });
  assert.equal(calls, 3);
  const throwing = sources(store, {
    fetchSource: async () => {
      calls++;
      throw new Error('CERT_HAS_EXPIRED');
    },
  });
  const separate = { ...request, url: 'https://factory.example/tls' };
  assert.equal((await throwing.capture(separate)).status, 'failed');
  assert.equal((await throwing.capture(separate)).cacheHit, true);
  assert.equal(calls, 4);
});

test('original import rejects byte mismatches and untrusted redirects before storing anything', async (t) => {
  const store = await temporary(t);
  const cache = sources(store);
  await assert.rejects(
    cache.importOriginal(
      { ...request, sourceSha256: '0'.repeat(64), observedAt: originalDate },
      Buffer.from('different')
    ),
    /SHA-256 mismatch/u
  );
  const bytes = Buffer.from('valid original');
  await assert.rejects(
    cache.importOriginal(
      {
        ...request,
        sourceSha256: sha256(bytes),
        observedAt: originalDate,
        finalUrl: 'https://retailer.example/product',
      },
      bytes
    ),
    /Unregistered manufacturer domain/u
  );
  assert.equal((await store.list('cache')).length, 0);
  assert.equal((await store.list('manufacturer-source')).length, 0);
});

test('a redirect away from official domains is recorded without requesting the destination', async (t) => {
  const store = await temporary(t);
  const urls = [];
  const cache = sources(store, {
    fetchSource: async (url) => {
      urls.push(url);
      return new globalThis.Response(null, {
        status: 302,
        headers: { location: 'https://retailer.example/related-flavour' },
      });
    },
  });
  const source = await cache.capture(request);
  assert.equal(source.status, 'failed');
  assert.match(source.error, /Unregistered manufacturer domain/u);
  assert.deepEqual(urls, [request.url]);
});

test('labels require original publication links and a registered CDN, not arbitrary gallery URLs', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, {
    fetchSource: async () =>
      new globalThis.Response(Buffer.from([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      }),
  });
  const parent = await imported(
    cache,
    request,
    '<img alt="Chocolate label" src="https://images.factory.example/chocolate.png"><img src="https://unreviewed.example/advert.jpg">'
  );
  const candidates = await cache.images(parent.id);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].identityVerified, false);
  const label = await cache.capture({
    brand: 'Factory',
    kind: 'label',
    url: candidates[0].url,
    parentSourceId: parent.id,
  });
  assert.equal(label.parentSourceSha256, parent.blob.sha256);
  assert.equal(label.status, 'captured');
  await assert.rejects(
    cache.capture({
      brand: 'Factory',
      kind: 'label',
      url: 'https://images.factory.example/vanilla.png',
      parentSourceId: parent.id,
    }),
    /not published/u
  );
  await assert.rejects(
    cache.capture({
      brand: 'Factory',
      kind: 'label',
      url: candidates[1].url,
      parentSourceId: parent.id,
    }),
    /explicit source registry/u
  );
});

test('label bytes and POST responses remain content-addressed independently of their URLs', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, {
    fetchSource: async () => new globalThis.Response('same catalogue'),
  });
  const a = await cache.capture(request);
  const b = await cache.capture({
    ...request,
    url: 'https://factory.example/mirror',
  });
  assert.notEqual(a.id, b.id);
  assert.equal(a.blob.sha256, b.blob.sha256);
  assert.equal((await store.blob(a.blob.sha256)).toString(), 'same catalogue');
});

test('exact per-ml nutrition can be verified with package volume while missing grams remain explicit', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const result = await reviewManufacturerResearch(store, reviewed(source));
  assert.equal(result.identityMatched, true);
  assert.equal(result.facts.proteinPer100ml.value, 4);
  assert.equal(result.facts.netVolumeMl.value, 473);
  assert.equal(result.facts.netMassG, undefined);
  assert.deepEqual(result.blockingEvidenceGaps, [
    'missing-current-fact:netMassG',
  ]);
  assert.equal(result.strictChocolateEligible, true);
});

test('same GTIN does not override conflicting volume, region, core flavour or revision', () => {
  for (const [field, value] of [
    ['netVolumeMl', 170],
    ['market', 'US'],
    ['coreFlavour', 'vanilla'],
    ['flavour', 'chocolate hazelnut'],
  ]) {
    const gaps = manufacturerIdentityGaps(identity, {
      ...identity,
      [field]: value,
    });
    assert.ok(gaps.length > 0, field);
  }
  assert.ok(
    manufacturerIdentityGaps(
      { ...identity, formulaRevision: 'old' },
      { ...identity, formulaRevision: 'new' }
    ).includes('identity-conflict:formulaRevision')
  );
  assert.ok(
    manufacturerIdentityGaps(
      { ...identity, variantCode: 'white' },
      { ...identity, variantCode: 'yellow' }
    ).includes('identity-conflict:variantCode')
  );
});

test('a family page and historical laboratory sample never approve an exact formula', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const historical = reviewed(source, {
    identity: {
      listing: identity,
      manufacturer: { ...identity, currentFormula: false },
    },
  });
  const result = await reviewManufacturerResearch(store, historical);
  assert.equal(result.identityMatched, false);
  assert.deepEqual(result.facts, {});
  assert.ok(
    result.blockingEvidenceGaps.includes('current-formula-unconfirmed')
  );
  assert.deepEqual(result.withheldFacts, ['netVolumeMl', 'proteinPer100ml']);
  assert.ok(
    manufacturerIdentityGaps(identity, {
      brand: 'Factory',
      name: 'Ice cream',
      currentFormula: true,
    }).includes('identity:gtin-or-manufacturer-variant-code')
  );
});

test('known vanilla cores are excluded and unknown chocolate cores stay unconfirmed', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const vanilla = await reviewManufacturerResearch(
    store,
    reviewed(source, {
      identity: {
        listing: identity,
        manufacturer: { ...identity, coreFlavour: 'vanilla' },
      },
    })
  );
  assert.equal(vanilla.strictChocolateEligible, false);
  const unknown = await reviewManufacturerResearch(
    store,
    reviewed(source, {
      identity: {
        listing: { ...identity, coreFlavour: undefined },
        manufacturer: { ...identity, coreFlavour: undefined },
      },
    })
  );
  assert.equal(unknown.strictChocolateEligible, null);
});

test('each fact source has an independent identity gate and immutable original SHA', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const input = reviewed(source);
  input.sourceIdentities[source.id] = { ...identity, netVolumeMl: 460 };
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /Claimed source identity is incomplete/u
  );
  input.sourceIdentities[source.id] = identity;
  input.facts.proteinPer100ml.sourceSha256 = '0'.repeat(64);
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /SHA-256 does not match/u
  );
  input.facts.proteinPer100ml.sourceSha256 = source.blob.sha256;
  delete input.sourceIdentities;
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /own exact identity/u
  );
});

test('inner units are matched independently of seller carton quantity, avoiding duplicated pack factors', () => {
  const carton = { ...identity, sellingPackCount: 24 };
  assert.deepEqual(manufacturerIdentityGaps(carton, identity), []);
  assert.ok(
    manufacturerIdentityGaps(carton, {
      ...identity,
      innerPackCount: 24,
    }).includes('identity-conflict:innerPackCount')
  );
});

test('source orchestration invokes OCR on original labels and never publishes guessed facts', async (t) => {
  const store = await temporary(t);
  const cache = sources(store);
  const parent = await imported(
    cache,
    request,
    '<img src="https://images.factory.example/chocolate.png">'
  );
  let ocrCalls = 0;
  const research = new ManufacturerResearch({
    store,
    registry,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    fetchSource: async () =>
      new globalThis.Response(Buffer.from([3, 4]), {
        headers: { 'content-type': 'image/png' },
      }),
    ocr: {
      recognize: async (blob) => {
        ocrCalls++;
        return { imageHash: blob.sha256, text: '4g', confidence: 0.9 };
      },
    },
  });
  const report = await research.run({
    sources: [
      {
        brand: 'Factory',
        kind: 'label',
        url: 'https://images.factory.example/chocolate.png',
        parentSourceId: parent.id,
      },
    ],
  });
  assert.equal(report.status, 'draft-requires-exact-identity-review');
  assert.equal(ocrCalls, 1);
  assert.equal(report.ocr[0].imageHash, report.sources[0].blob.sha256);
  assert.deepEqual(report.reviews, []);
  assert.equal((await store.list('product')).length, 0);
});

test('unsupported methods, private credentials and Lazada navigation cannot enter the source plan', () => {
  assert.throws(
    () => manufacturerRequest({ url: 'https://lazada.vn/products/x' }),
    /must not request Lazada/u
  );
  assert.throws(
    () => manufacturerRequest({ url: 'https://img.lazcdn.com/x' }),
    /must not request Lazada/u
  );
  assert.throws(
    () =>
      manufacturerRequest({ url: 'https://user:password@factory.example/x' }),
    /credential-free/u
  );
  assert.throws(
    () =>
      manufacturerRequest({
        ...request,
        headers: { Cookie: 'session=secret' },
      }),
    /Unsupported research request header/u
  );
  assert.throws(
    () => manufacturerRequest({ ...request, method: 'DELETE' }),
    /GET and public POST/u
  );
  assert.equal(
    manufacturerSourceId(request),
    manufacturerSourceId({ ...request, url: `${request.url}#section` })
  );
});

test('correct SHA and identity cannot approve invented excerpts or unrelated numeric values', async (t) => {
  const store = await temporary(t);
  const source = await imported(sources(store));
  const input = reviewed(source);
  input.facts.proteinPer100ml.excerpt = 'Protein 90g per 100ml';
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /not present in the original source/u
  );
  input.facts.proteinPer100ml.excerpt = 'Protein 4g per 100ml';
  input.facts.proteinPer100ml.value = 5;
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /number does not appear/u
  );
});

test('nutrition bases must be supported by actual source columns, not only the review text', async (t) => {
  const store = await temporary(t);
  const source = await imported(
    sources(store),
    request,
    '473ml; Protein 4g per 100g'
  );
  const input = reviewed(source);
  input.facts.proteinPer100ml.excerpt = 'Protein 4g per 100g';
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /basis must be stated/u
  );
});

test('HTML entities and table boundaries preserve original review excerpts and ingredient arrays', async (t) => {
  const store = await temporary(t);
  const html =
    '<table><tr><td>Protein&nbsp;</td><td>4g</td><td>per 100ml</td></tr></table><p>473ml</p><p>Ingredients: cream, sugar, cocoa</p>';
  const source = await imported(sources(store), request, html);
  const input = reviewed(source);
  input.facts.ingredients = {
    value: ['cream', 'sugar', 'cocoa'],
    unit: 'text',
    basis: 'complete current formula',
    excerpt: 'Ingredients: cream, sugar, cocoa',
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
  };
  const result = await reviewManufacturerResearch(store, input);
  assert.deepEqual(result.facts.ingredients.value, ['cream', 'sugar', 'cocoa']);
  assert.equal(result.facts.proteinPer100ml.sourceAuthority, 'manufacturer');
  input.facts.ingredients.value.pop();
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /complete reviewed original excerpt/u
  );
});

test('zero protein is preserved and exact litres convert to millilitres without density inference', async (t) => {
  const store = await temporary(t);
  const source = await imported(
    sources(store),
    request,
    'Net volume 6L; Protein 0g per 100ml'
  );
  const input = reviewed(source);
  input.identity.listing.netVolumeMl = 6000;
  input.identity.manufacturer.netVolumeMl = 6000;
  input.sourceIdentities[source.id].netVolumeMl = 6000;
  Object.assign(input.facts.netVolumeMl, {
    value: 6000,
    sourceValue: 6,
    sourceUnit: 'L',
    valueExcerpt: '6L',
    excerpt: 'Net volume 6L',
  });
  Object.assign(input.facts.proteinPer100ml, {
    value: 0,
    valueExcerpt: '0g',
    excerpt: 'Protein 0g per 100ml',
  });
  const result = await reviewManufacturerResearch(store, input);
  assert.equal(result.facts.netVolumeMl.value, 6000);
  assert.equal(result.facts.proteinPer100ml.value, 0);
  assert.equal(result.facts.netMassG, undefined);
});

test('label facts require original-image-bound OCR and a matching raw TSV transcription', async (t) => {
  const store = await temporary(t);
  const cache = sources(store);
  const parent = await imported(
    cache,
    request,
    '<img src="https://images.factory.example/label.png">'
  );
  const bytes = Buffer.from([137, 80, 78, 71]);
  const source = await cache.importOriginal(
    {
      brand: 'Factory',
      kind: 'label',
      url: 'https://images.factory.example/label.png',
      parentSourceId: parent.id,
      observedAt: originalDate,
      sourceSha256: sha256(bytes),
      contentType: 'image/png',
    },
    bytes
  );
  const input = reviewed(source);
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /OCR bound to the original image/u
  );
  const tsv =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t200\t20\t99\t473ml; Protein 4g per 100ml\n';
  const rawTsv = await store.putBlob(Buffer.from(tsv));
  const ocr = {
    id: 'label-ocr',
    imageHash: source.blob.sha256,
    rawTsv,
    engine: 'fixture-tesseract',
    languages: 'eng',
    psm: 6,
    ...parseTsv(tsv),
  };
  await store.put('ocr', ocr);
  for (const fact of Object.values(input.facts)) {
    fact.ocrId = ocr.id;
  }
  assert.equal(
    (await reviewManufacturerResearch(store, input)).facts.proteinPer100ml
      .value,
    4
  );
  await store.put('ocr', { ...ocr, text: '473ml; Protein 9g per 100ml' });
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /differs from its original TSV/u
  );
  await store.put('ocr', { ...ocr, imageHash: '0'.repeat(64) });
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /OCR bound to the original image/u
  );
});

test('cached label research delivers bounded crop passes without approving facts or downloading again', async (t) => {
  const store = await temporary(t);
  const cache = sources(store);
  const parent = await imported(
    cache,
    request,
    '<img src="https://images.factory.example/label.png">'
  );
  const label = {
    brand: 'Factory',
    kind: 'label',
    url: 'https://images.factory.example/label.png',
    parentSourceId: parent.id,
  };
  const bytes = Buffer.from([137, 80, 78, 71]);
  const source = await cache.importOriginal(
    {
      ...label,
      observedAt: originalDate,
      sourceSha256: sha256(bytes),
      contentType: 'image/png',
    },
    bytes
  );
  const calls = [];
  const research = new ManufacturerResearch({
    store,
    registry,
    offline: true,
    ocr: {
      recognize: async (blob, options) => {
        calls.push({ blob, options });
        return { imageHash: blob.sha256, text: '4.5', requiresReview: true };
      },
    },
  });
  const passes = [
    { psm: 11 },
    { psm: 7, transform: { crop: { left: 0, top: 0, width: 10, height: 10 } } },
  ];
  const report = await research.run({
    sources: [{ ...label, ocrPasses: passes }],
  });
  assert.deepEqual(
    calls.map((row) => row.options),
    passes
  );
  assert.ok(calls.every((row) => row.blob.sha256 === source.blob.sha256));
  assert.equal(report.ocr.length, 2);
  assert.deepEqual(report.reviews, []);
  assert.equal(report.cache.downloads, 0);
  calls.length = 0;
  const invalid = await research.run({
    sources: [{ ...label, ocrPasses: Array.from({ length: 9 }, () => ({})) }],
  });
  assert.equal(calls.length, 0);
  assert.equal(invalid.sources.length, 0);
  assert.match(invalid.failures[0].error, /one to eight/u);
});

test('explicit whey category supports chocolate or unflavoured formulas while retaining default ice core safety', () => {
  for (const flavour of ['chocolate', 'unflavoured', 'plain', 'natural']) {
    const whey = {
      ...identity,
      category: 'whey',
      flavour,
      packageType: 'bag',
      coreFlavour: undefined,
    };
    assert.deepEqual(manufacturerIdentityGaps(whey, whey), [], flavour);
  }
  for (const flavour of [
    'vanilla',
    'chocolate peanut butter',
    'chocolate banana',
  ]) {
    const whey = { ...identity, category: 'whey', flavour };
    assert.ok(
      manufacturerIdentityGaps(whey, whey).includes(
        'whey-category-or-flavour-unconfirmed'
      ),
      flavour
    );
  }
  const noCategory = { ...identity, coreFlavour: undefined };
  assert.ok(
    manufacturerIdentityGaps(noCategory, noCategory).includes(
      'strict-chocolate-core-unconfirmed'
    )
  );
});

test('application research rejects plan registry overrides and uses configured offline source authority', async (t) => {
  const store = await temporary(t);
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    manufacturerRegistry: registry.map((entry) => ({
      ...entry,
      name: entry.brand,
    })),
  });
  assert.throws(
    () =>
      app.manufacturerResearch({
        registry: [{ brand: 'Factory', domains: ['untrusted.example'] }],
        sources: [],
      }),
    /registry/u
  );
  let browserStarts = 0;
  app.collector.start = () => {
    browserStarts++;
    throw new Error('No browser');
  };
  const result = await app.manufacturerResearch({ sources: [request] });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /Offline cache miss/u);
  assert.equal(browserStarts, 0);
  assert.equal(result.cache.downloads, 0);
});

test('original imports preserve explicit missing capture-time receipts', async (t) => {
  const store = await temporary(t);
  const cache = sources(store, { offline: true });
  const bytes = Buffer.from('Archived source');
  await assert.rejects(
    cache.importOriginal({ ...request, sourceSha256: sha256(bytes) }, bytes),
    /unknown-time receipt/u
  );
  const source = await cache.importOriginal(
    {
      ...request,
      sourceSha256: sha256(bytes),
      captureTimeUnknown: true,
      contentType: 'text/html',
    },
    bytes
  );
  assert.equal(source.observedAt, null);
  assert.equal(source.captureTimeUnknown, true);
  assert.equal((await cache.capture(request)).cacheHit, true);
});

test('package unit suffixes and nutrition basis numbers cannot turn kilograms into grams or 1100ml into 100ml', async (t) => {
  const store = await temporary(t);
  const source = await imported(
    sources(store),
    request,
    'Package 473kg; Protein 4g per 1100ml'
  );
  const input = reviewed(source);
  Object.assign(input.facts.netVolumeMl, {
    valueExcerpt: '473kg',
    excerpt: 'Package 473kg',
    sourceUnit: 'ml',
  });
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /quantity unit must appear/u
  );
  delete input.facts.netVolumeMl;
  Object.assign(input.facts.proteinPer100ml, {
    excerpt: 'Protein 4g per 1100ml',
    basisExcerpt: 'per 1100ml',
  });
  await assert.rejects(
    reviewManufacturerResearch(store, input),
    /basis must be stated/u
  );
});
