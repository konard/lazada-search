import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceCache, DomainScheduler } from '../src/cache.js';
import { sha256 } from '../src/util.js';
import {
  workflowSourceInvalidated,
  workflowProductFingerprint,
} from '../src/label-worklist.js';
import {
  extractStructuredWorkflowCandidates,
  prepareWorkflowFacts,
} from '../src/manufacturer-workflow-facts.js';
import {
  prepareManufacturerWorkflowReview,
  reviewManufacturerWorkflow,
} from '../src/manufacturer-workflow-review.js';
import { runManufacturerWorkflow } from '../src/manufacturer-workflow.js';
import { createManufacturerSearchProvider } from '../src/manufacturer-workflow-search.js';
import { verifyOriginalBoundOcr } from '../src/ocr-evidence.js';
import { parseTsv } from '../src/ocr.js';

// Draft tests are intentionally not executed during this drafting pass.
class MemoryStore {
  constructor() {
    this.records = new Map();
    this.blobs = new Map();
    this.writes = [];
  }
  get(kind, id) {
    return Promise.resolve(
      globalThis.structuredClone(this.records.get(`${kind}:${id}`))
    );
  }
  list(kind) {
    return Promise.resolve(
      [...this.records.entries()]
        .filter(([key]) => key.startsWith(`${kind}:`))
        .map(([, value]) => globalThis.structuredClone(value))
    );
  }
  put(kind, value) {
    this.records.set(`${kind}:${value.id}`, globalThis.structuredClone(value));
    this.writes.push({ kind, id: value.id });
    return Promise.resolve(globalThis.structuredClone(value));
  }
  putBlob(bytes) {
    const hash = sha256(bytes);
    this.blobs.set(hash, Buffer.from(bytes));
    return Promise.resolve({
      type: 'stored-blob',
      sha256: hash,
      bytes: bytes.length,
    });
  }
  blob(hash) {
    return Promise.resolve(this.blobs.get(hash));
  }
}

const identity = {
  brand: 'Factory',
  name: 'Chocolate whey',
  flavour: 'chocolate',
  market: 'VN',
  category: 'whey',
  packageType: 'pouch',
  formulaRevision: '2026-label-A',
  gtin: '0123456789012',
  netMassG: 2000,
  innerPackCount: 1,
  currentFormula: true,
};
const registry = [
  {
    name: 'Factory',
    aliases: ['factory'],
    domains: ['factory.example'],
    url: 'https://factory.example/chocolate',
  },
];

function factCandidates(product, source) {
  const base = {
    productId: product.id,
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
    sourceUrl: source.finalUrl,
    sourceRecordKind: 'manufacturer-source',
    sourceAuthority: 'manufacturer',
    identity,
    identityGaps: [],
    identityMatched: false,
    requiresReview: true,
    approvalStatus: 'candidate-only',
  };
  const protein = {
    ...base,
    id: 'candidate:protein',
    field: 'proteinPer100g',
    value: 80,
    unit: 'g/100g',
    basis: 'per-100g',
    excerpt: 'Protein 80 g per 100g',
    valueExcerpt: '80 g',
    basisExcerpt: 'per 100g',
  };
  const mass = {
    ...base,
    id: 'candidate:mass',
    field: 'netMassG',
    value: 2000,
    unit: 'g',
    basis: 'one-inner-food-package',
    excerpt: 'Net weight 2000 g',
    valueExcerpt: '2000 g',
  };
  return [protein, mass];
}

async function fixture() {
  const store = new MemoryStore();
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const cache = new EvidenceCache({
    store,
    offline: true,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const application = { store, cache, manufacturerRegistry: registry };
  const listing = await store.putBlob(
    Buffer.from(
      '<html><body>Factory Chocolate whey 2000 g, GTIN0123456789012, selected chocolate</body></html>'
    )
  );
  const product = {
    id: 'product:fixture',
    sku: '1_VNAMZ-2',
    title: 'Factory Chocolate whey 2000g',
    brand: 'Factory',
    category: 'whey',
    url: 'https://www.lazada.vn/products/pdp-i1.html?skuId=2',
    observedAt,
    packCount: 1,
    netMassG: 2000,
    ingredients: [],
    claims: [],
    selectedVariant: [{ text: 'Chocolate', selected: true }],
    evidenceIds: ['listing:fixture'],
  };
  await store.put('evidence', {
    id: 'listing:fixture',
    role: 'listing',
    html: listing,
    url: product.url,
    observedAt,
  });
  await store.put('product', product);
  await store.put('offer', {
    id: 'offer:fixture',
    productId: product.id,
    sku: product.sku,
    price: 1000000,
    currency: 'VND',
    url: product.url,
    observedAt,
  });
  const sourceText = JSON.stringify({
    identity,
    label:
      'Net weight 2000 g. Protein 80 g per 100g. Ingredients: Whey protein isolate',
  });
  const blob = await store.putBlob(Buffer.from(sourceText));
  const source = {
    id: 'manufacturer-source:fixture',
    brand: 'Factory',
    authority: 'manufacturer',
    kind: 'page',
    status: 'captured',
    contentType: 'application/json',
    url: 'https://factory.example/chocolate',
    finalUrl: 'https://factory.example/chocolate',
    blob,
    observedAt,
  };
  await store.put('manufacturer-source', source);
  const fingerprint = workflowProductFingerprint(product);
  const item = {
    id: 'label-work:fixture',
    productId: product.id,
    productFingerprint: fingerprint,
    identity,
    originals: [
      {
        evidenceId: 'listing:fixture',
        kind: 'html',
        role: 'listing',
        url: product.url,
        sha256: listing.sha256,
        bytes: listing.bytes,
      },
    ],
    quantityFields: [],
    nutritionFields: ['protein:explicit-label-basis'],
    candidates: [],
    sku: product.sku,
  };
  const [protein, mass] = factCandidates(product, source);
  for (const candidate of [protein, mass]) {
    await store.put('manufacturer-fact-candidate', candidate);
  }
  const draft = {
    id: 'review-draft:nutrition',
    productId: product.id,
    productFingerprint: fingerprint,
    kind: 'nutrition',
    candidates: [protein],
    listingOriginals: item.originals,
  };
  await store.put('manufacturer-review-draft', draft);
  await store.put('manufacturer-review-draft', {
    ...draft,
    id: 'review-draft:quantity',
    kind: 'quantity',
    candidates: [mass],
  });
  const plan = {
    id: 'manufacturer-workflow:fixture',
    items: [item],
    tasks: [
      { reviewDraftId: draft.id },
      { reviewDraftId: 'review-draft:quantity' },
    ],
  };
  await store.put('manufacturer-workflow', plan);
  const packet = {
    workflowId: plan.id,
    reviewDraftId: draft.id,
    productFingerprint: fingerprint,
    reviewedBy: 'Explicit fixture reviewer',
    reason: 'Exact original package and formula matched',
    listingEvidenceId: 'listing:fixture',
    listingSha256: listing.sha256,
    listingIdentity: identity,
    manufacturerIdentity: identity,
    sourceIdentities: { [source.id]: identity },
    candidateIds: [protein.id],
    factoryQuantityCandidateIds: [mass.id],
  };
  store.writes = [];
  return {
    application,
    store,
    product,
    source,
    item,
    draft,
    packet,
    protein,
    mass,
  };
}

test('source invalidation by evidence/cache IDs removes reuse even without a URL', () => {
  const source = {
    id: 'evidence:label',
    cacheId: 'image:label',
    observedAt: '2026-10-10T00:00:00Z',
  };
  assert.equal(
    workflowSourceInvalidated(
      source,
      [],
      [{ evidenceIds: [source.id], invalidated: true }]
    ),
    true
  );
  assert.equal(
    workflowSourceInvalidated(
      source,
      [],
      [{ cacheIds: [source.cacheId], invalidated: true }]
    ),
    true
  );
  assert.equal(
    workflowSourceInvalidated(
      source,
      [],
      [
        {
          evidenceIds: [source.id],
          invalidated: true,
          resolvedAt: '2026-10-11T00:00:00Z',
        },
      ]
    ),
    false
  );
});

test('structured candidates require literal revision/currentness and remain unapproved', () => {
  const source = {
    id: 'source',
    contentType: 'application/json',
    blob: { sha256: 'a'.repeat(64) },
  };
  const nutrition = {
    proteinPer100g: {
      value: 80,
      unit: 'g/100g',
      basis: 'per-100g',
      originalLabelExcerpt: 'Protein 80 g per 100g',
      valueExcerpt: '80 g',
      basisExcerpt: 'per 100g',
    },
  };
  const absent = extractStructuredWorkflowCandidates({
    source,
    text: JSON.stringify({
      identity: { ...identity, formulaRevision: undefined },
      nutrition,
    }),
  });
  assert.deepEqual(absent.candidates, []);
  const futureUnknown = extractStructuredWorkflowCandidates({
    source,
    text: JSON.stringify({
      identity: { ...identity, currentFormula: undefined },
      nutrition,
    }),
  });
  assert.deepEqual(futureUnknown.candidates, []);
  const text = JSON.stringify({ identity, nutrition });
  const extracted = extractStructuredWorkflowCandidates({ source, text });
  const proposed = prepareWorkflowFacts(
    { identity, productId: 'product', productFingerprint: 'fingerprint' },
    source,
    extracted,
    text
  );
  assert.equal(proposed.candidates.length, 1);
  assert.equal(proposed.candidates[0].identityMatched, false);
  assert.equal(proposed.candidates[0].requiresReview, true);
  assert.equal(proposed.candidates[0].approvalStatus, 'candidate-only');
});

test('human review attaches original primary sources and applies approved nutrition without replacing offer price', async () => {
  const f = await fixture();
  const originalOffer = await f.store.get('offer', 'offer:fixture');
  const prepared = await prepareManufacturerWorkflowReview(
    f.application,
    f.packet
  );
  assert.equal(prepared.automaticApprovalAllowed, false);
  assert.equal(f.store.writes.length, 0);
  const result = await reviewManufacturerWorkflow(f.application, f.packet);
  const product = await f.store.get('product', f.product.id);
  assert.equal(product.proteinPer100g, 80);
  assert.equal(product.netMassG, 2000);
  assert.equal(
    product.manufacturerVerification.identity.formulaRevision,
    identity.formulaRevision
  );
  assert.equal(result.automaticApproval, false);
  assert.deepEqual(await f.store.get('offer', 'offer:fixture'), originalOffer);
  const attached = (await f.store.list('evidence')).find(
    (evidence) => evidence.sourceId === f.source.id
  );
  assert.equal(attached.blob.sha256, f.source.blob.sha256);
  assert.ok(product.evidenceIds.includes(attached.id));
  assert.ok(
    product.claims.some(
      (claim) => claim.field === 'netMassG' && claim.source === 'manufacturer'
    )
  );
});

for (const [name, mutate] of [
  [
    'missing reviewer',
    (f) => {
      delete f.packet.reviewedBy;
    },
  ],
  [
    'automatic approval',
    (f) => {
      f.packet.automaticApproval = true;
    },
  ],
  [
    'different flavour',
    (f) => {
      f.packet.manufacturerIdentity = { ...identity, flavour: 'vanilla' };
    },
  ],
  [
    'missing formula revision',
    (f) => {
      f.packet.manufacturerIdentity = {
        ...identity,
        formulaRevision: undefined,
      };
    },
  ],
  [
    'stale original',
    (f) => {
      f.packet.maxSourceAgeMs = 1;
    },
  ],
  [
    'changed listing digest',
    (f) => {
      f.packet.listingSha256 = 'f'.repeat(64);
    },
  ],
]) {
  test(`bridge rejects ${name} before attaching or approving sources`, async () => {
    const f = await fixture();
    mutate(f);
    await assert.rejects(reviewManufacturerWorkflow(f.application, f.packet));
    assert.equal(f.store.writes.length, 0);
    assert.equal(
      (await f.store.get('product', f.product.id)).manufacturerVerification,
      undefined
    );
  });
}

test('bridge rejects changed source bytes and evidence-ID invalidations before writes', async () => {
  const f = await fixture();
  f.store.blobs.set(f.source.blob.sha256, Buffer.from('corrupted source'));
  await assert.rejects(
    reviewManufacturerWorkflow(f.application, f.packet),
    /missing or corrupt/u
  );
  assert.equal(f.store.writes.length, 0);
  const g = await fixture();
  await g.store.put('invalidation', {
    id: 'invalidation:source',
    evidenceIds: [g.source.id],
    invalidated: true,
  });
  g.store.writes = [];
  await assert.rejects(
    reviewManufacturerWorkflow(g.application, g.packet),
    /invalidated/u
  );
  assert.equal(g.store.writes.length, 0);
});

test('asynchronous approval withdraws when a newer selected capture arrives during validation', async () => {
  const f = await fixture();
  const get = f.store.get.bind(f.store);
  let reads = 0;
  const newer = {
    ...f.product,
    observedAt: new Date().toISOString(),
    title: 'Factory newer chocolate capture',
  };
  f.store.get = async (kind, id) => {
    const value = await get(kind, id);
    if (kind === 'manufacturer-source' && ++reads === 3) {
      f.store.records.set(
        `product:${f.product.id}`,
        globalThis.structuredClone(newer)
      );
    }
    return value;
  };
  await assert.rejects(
    reviewManufacturerWorkflow(f.application, f.packet),
    /changed during review/u
  );
  assert.deepEqual(await get('product', f.product.id), newer);
  assert.equal(f.store.writes.length, 0);
});

test('source invalidation created during asynchronous validation blocks staged publication', async () => {
  const f = await fixture();
  const get = f.store.get.bind(f.store);
  let reads = 0;
  f.store.get = async (kind, id) => {
    const value = await get(kind, id);
    if (kind === 'manufacturer-source' && ++reads === 3) {
      f.store.records.set('invalidation:late-source', {
        id: 'late-source',
        evidenceIds: [f.source.id],
        invalidated: true,
      });
    }
    return value;
  };
  await assert.rejects(
    reviewManufacturerWorkflow(f.application, f.packet),
    /invalidated/u
  );
  assert.equal(f.store.writes.length, 0);
});

test('chronological product writer retains a newer capture arriving after the final review read', async () => {
  const f = await fixture();
  const newer = {
    ...f.product,
    observedAt: new Date().toISOString(),
    title: 'Factory latest capture',
  };
  f.store.putLatest = (kind) => {
    assert.equal(kind, 'product');
    f.store.records.set(
      `product:${f.product.id}`,
      globalThis.structuredClone(newer)
    );
    return Promise.resolve(globalThis.structuredClone(newer));
  };
  await assert.rejects(
    reviewManufacturerWorkflow(f.application, f.packet),
    /newer product was retained/u
  );
  assert.deepEqual(await f.store.get('product', f.product.id), newer);
  assert.equal((await f.store.list('manufacturer-workflow-review')).length, 0);
});

test('cached-only provider cannot issue a request and rejects embedded tokens', async () => {
  const f = await fixture();
  const provider = createManufacturerSearchProvider(f.application, {
    origin: 'https://search.example',
    endpoint: 'https://search.example/query',
    cacheOnly: true,
  });
  await assert.rejects(
    provider.search({
      queries: ['site:factory.example chocolate'],
      domains: ['factory.example'],
      maxResults: 8,
    }),
    (error) => error.code === 'MANUFACTURER_SEARCH_CACHE_MISS'
  );
  assert.throws(
    () =>
      createManufacturerSearchProvider(f.application, {
        origin: 'https://search.example',
        endpoint: 'https://search.example/query',
        token: 'must-not-persist',
      }),
    /plaintext tokens/u
  );
  assert.equal(f.store.writes.length, 0);
});

test('search cache separates result bounds so a narrow discovery cannot satisfy a broader request', async () => {
  const store = new MemoryStore();
  const cache = new EvidenceCache({
    store,
    offline: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const application = { store, cache, manufacturerRegistry: registry };
  const product = {
    id: 'product',
    sku: '1_VNAMZ-2',
    url: 'https://www.lazada.vn/products/pdp-i1.html',
    observedAt: new Date().toISOString(),
    title: 'Factory whey chocolate',
    category: 'whey',
    ingredients: [],
    claims: [],
    evidenceIds: [],
  };
  await store.put('product', product);
  const calls = [];
  const provider = {
    id: 'bounded-fixture',
    version: '1',
    origin: 'https://search.example',
    search: (request) => {
      calls.push(request.maxResults);
      return Promise.resolve([]);
    },
  };
  for (const bound of [8, 50, 8]) {
    const item = {
      id: `item:${bound}`,
      productId: product.id,
      productFingerprint: workflowProductFingerprint(product),
      identity,
      title: product.title,
      candidates: [{ name: 'Factory', url: registry[0].url }],
      originals: [],
    };
    const id = `workflow:${bound}:${calls.length}`;
    await store.put('manufacturer-workflow', {
      id,
      items: [item],
      tasks: [
        {
          id: `discover:${id}`,
          kind: 'discover-sources',
          input: { itemId: item.id },
          itemIds: [item.id],
          dependencies: [],
          status: 'queued',
          attempts: 0,
        },
      ],
      blockers: [],
      bounds: {
        maxSourcesPerProduct: bound,
        maxLabelsPerPage: 12,
        maxTotalTasks: 100,
        maxAttempts: 3,
      },
    });
    await runManufacturerWorkflow(application, id, {
      allowNetwork: true,
      searchProvider: provider,
      maxTasks: 1,
    });
  }
  assert.deepEqual(calls, [8, 50]);
});

async function transformedOcrFixture() {
  const store = new MemoryStore();
  const original = await store.putBlob(
    Buffer.from('preserved-original-image-fixture')
  );
  const derived = await store.putBlob(
    Buffer.from('preserved-derived-crop-fixture')
  );
  const tsv = Buffer.from(
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t99\t4.5\n'
  );
  const rawTsv = await store.putBlob(tsv);
  const parsed = parseTsv(tsv.toString('utf8'));
  const baseline = {
    id: 'ocr:original',
    imageHash: original.sha256,
    rawTsv,
    engine: 'fixture-engine',
    languages: 'eng',
    psm: 6,
    ...parsed,
  };
  await store.put('ocr', baseline);
  const sourceOcr = { id: baseline.id, imageHash: original.sha256, rawTsv };
  const recipe = {
    crop: { left: 0, top: 0, width: 10, height: 10 },
    resize: { width: 20, height: 20, kernel: 'nearest' },
    grayscale: true,
    alphaBackground: '#ffffff',
    format: 'png',
    png: { compressionLevel: 9, adaptiveFiltering: false, palette: false },
  };
  const renderer = { sharp: 'fixture-sharp', vips: 'fixture-vips' };
  const transform = {
    id: sha256(
      JSON.stringify([
        'ocr-image-transform-v1',
        original.sha256,
        recipe,
        renderer,
        sourceOcr,
      ])
    ),
    originalImage: original,
    derivedImage: derived,
    sourceOcr,
    transform: recipe,
    renderer,
    originalDimensions: { width: 10, height: 10 },
    originalFormat: 'png',
    requiresReview: true,
  };
  await store.put('image-transform', transform);
  const manifest = {
    version: 'tesseract-traineddata-v1',
    requestedLanguages: 'eng',
    directorySelection: 'native',
    models: [
      { language: 'eng', role: 'language', sha256: 'a'.repeat(64), bytes: 100 },
    ],
  };
  manifest.fingerprint = sha256(JSON.stringify(manifest));
  const ocr = {
    id: 'ocr:derived',
    imageHash: derived.sha256,
    originalImageHash: original.sha256,
    imageTransform: transform,
    derivedImage: derived,
    rawTsv,
    engine: 'fixture-engine',
    languages: 'eng',
    psm: 6,
    modelProvenance: manifest,
    ...parsed,
  };
  await store.put('ocr', ocr);
  return { store, original, derived, ocr, transform };
}

test('genuine stored transform provenance preserves original and derived identities without relabelling OCR', async () => {
  const f = await transformedOcrFixture();
  const proof = await verifyOriginalBoundOcr(f.store, f.original, f.ocr);
  assert.equal(proof.text, '4.5');
  assert.equal(proof.originalImageSha256, f.original.sha256);
  assert.equal(proof.physicalImageSha256, f.derived.sha256);
  assert.notEqual(proof.originalImageSha256, proof.physicalImageSha256);
  assert.equal(proof.transformationId, f.transform.id);
  assert.equal(f.ocr.imageHash, f.derived.sha256);
});

test('private storage metadata does not replace the source-bound physical OCR proof', async () => {
  const f = await transformedOcrFixture();
  await f.store.put('ocr', { ...f.ocr, visibility: 'private' });
  const proof = await verifyOriginalBoundOcr(f.store, f.original, f.ocr);
  assert.equal(proof.physicalImageSha256, f.derived.sha256);
});

for (const [name, mutate] of [
  [
    'forged originalImageHash',
    async (f) => {
      f.ocr.imageTransform = undefined;
      await f.store.put('ocr', f.ocr);
    },
  ],
  [
    'changed crop recipe',
    async (f) => {
      f.transform.transform.crop.width = 9;
      f.ocr.imageTransform = f.transform;
      await f.store.put('image-transform', f.transform);
      await f.store.put('ocr', f.ocr);
    },
  ],
  [
    'corrupted derived bytes',
    async (f) => {
      f.store.blobs.set(f.derived.sha256, Buffer.from('other image'));
    },
  ],
  [
    'changed TSV transcription',
    async (f) => {
      f.ocr.text = '45';
      await f.store.put('ocr', f.ocr);
    },
  ],
  [
    'wrong native model fingerprint',
    async (f) => {
      f.ocr.modelProvenance.fingerprint = 'f'.repeat(64);
      await f.store.put('ocr', f.ocr);
    },
  ],
  [
    'lost source OCR binding',
    async (f) => {
      f.store.records.delete(`ocr:${f.transform.sourceOcr.id}`);
    },
  ],
]) {
  test(`original-bound OCR rejects ${name}`, async () => {
    const f = await transformedOcrFixture();
    await mutate(f);
    await assert.rejects(verifyOriginalBoundOcr(f.store, f.original, f.ocr));
  });
}
