import {
  MemoryStore,
  identity,
  registry,
  fixture,
} from './helpers/manufacturer-workflow.js';
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
import {
  planManufacturerWorkflow,
  runManufacturerWorkflow,
} from '../src/manufacturer-workflow.js';
import { createManufacturerSearchProvider } from '../src/manufacturer-workflow-search.js';
import { verifyOriginalBoundOcr } from '../src/ocr-evidence.js';
import { parseTsv, TesseractOcr } from '../src/ocr.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { stopForChallenge } from '../src/page-challenge.js';
import sharp from 'sharp';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { resolveProductReviews } from '../src/catalog-products.js';
import { ManufacturerSourceCache } from '../src/manufacturer-source-cache.js';

// Offline synthetic originals isolate approval and cache invariants from sites.

test('offline planning and resumable runner retain source-bound quantity/nutrition drafts from a cached primary JSON original', async () => {
  const f = await fixture();
  f.store.records.delete(`manufacturer-source:${f.source.id}`);
  const bytes = Buffer.from(
    JSON.stringify({
      identity,
      quantities: {
        netMassG: {
          value: 2000,
          unit: 'g',
          basis: 'one-inner-food-package',
          originalLabelExcerpt: 'Net weight 2000 g',
          valueExcerpt: '2000 g',
        },
      },
      nutrition: {
        proteinPer100g: {
          value: 80,
          unit: 'g/100g',
          basis: 'per-100g',
          originalLabelExcerpt: 'Protein 80 g per 100g',
          valueExcerpt: '80 g',
          basisExcerpt: 'per 100g',
        },
      },
    })
  );
  const sources = new ManufacturerSourceCache({
    store: f.store,
    offline: true,
    registry: [{ brand: 'Factory', domains: ['factory.example'] }],
  });
  const source = await sources.importOriginal(
    {
      brand: 'Factory',
      url: registry[0].url,
      contentType: 'application/json',
      observedAt: f.source.observedAt,
      sourceSha256: sha256(bytes),
    },
    bytes
  );
  f.application.cache.fetch = () => {
    throw new Error('Offline pipeline cannot fetch');
  };
  const plan = await planManufacturerWorkflow(f.application, {
    id: 'workflow:offline-pipeline',
    productIds: [f.product.id],
  });
  assert.equal(plan.items.length, 1);
  assert.ok(plan.tasks.some((task) => task.kind === 'discover-sources'));
  const completed = await runManufacturerWorkflow(f.application, plan.id, {
    allowNetwork: false,
    maxTasks: 100,
  });
  assert.equal(completed.lastRun.cache.downloads, 0);
  assert.equal(completed.lastRun.automaticApprovals, 0);
  assert.equal(completed.marketCompletenessGuaranteed, false);
  const drafts = (await f.store.list('manufacturer-review-draft')).filter(
    (draft) => completed.tasks.some((task) => task.reviewDraftId === draft.id)
  );
  const nutrition = drafts.find(
    (draft) =>
      draft.kind === 'nutrition' &&
      draft.candidates.some(
        (candidate) =>
          candidate.sourceId === source.id &&
          candidate.field === 'proteinPer100g'
      )
  );
  const quantity = drafts.find(
    (draft) =>
      draft.kind === 'quantity' &&
      draft.candidates.some(
        (candidate) =>
          candidate.sourceId === source.id && candidate.field === 'netMassG'
      )
  );
  assert.ok(nutrition);
  assert.ok(quantity);
  for (const draft of [nutrition, quantity]) {
    assert.equal(draft.automaticApprovalAllowed, false);
    assert.ok(
      draft.candidates.every(
        (candidate) =>
          candidate.requiresReview &&
          !candidate.identityMatched &&
          candidate.sourceSha256 === source.blob.sha256
      )
    );
  }
  assert.equal(
    (await f.store.get('product', f.product.id)).proteinPer100g,
    undefined
  );
  assert.equal((await f.store.list('manufacturer-research-review')).length, 0);
  const reused = await planManufacturerWorkflow(f.application, {
    id: plan.id,
    productIds: [f.product.id],
  });
  const replay = await runManufacturerWorkflow(f.application, reused.id, {
    allowNetwork: false,
    maxTasks: 100,
  });
  assert.equal(replay.lastRun.executedTasks, 0);
  assert.equal(replay.lastRun.cache.downloads, 0);
});

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

for (const [name, mutate] of [
  [
    'numeric value absent from original',
    (candidate) => ({ ...candidate, value: 9000 }),
  ],
  [
    'unit conversion absent from original',
    (candidate) => ({ ...candidate, sourceUnit: 'kg' }),
  ],
  [
    'excerpt absent from original',
    (candidate) => ({
      ...candidate,
      excerpt: 'Net weight 9000 g',
      valueExcerpt: '9000 g',
      value: 9000,
    }),
  ],
]) {
  test(`quantity bridge rejects ${name} before attaching sources`, async () => {
    const f = await fixture();
    const candidate = mutate(f.mass);
    const draft = {
      ...f.draft,
      id: 'review-draft:quantity',
      kind: 'quantity',
      candidates: [candidate],
    };
    await f.store.put('manufacturer-fact-candidate', candidate);
    await f.store.put('manufacturer-review-draft', draft);
    f.store.writes = [];
    await assert.rejects(
      reviewManufacturerWorkflow(f.application, {
        ...f.packet,
        reviewDraftId: draft.id,
        candidateIds: [candidate.id],
        factoryQuantityCandidateIds: [],
      }),
      /original|conversion/u
    );
    assert.equal(f.store.writes.length, 0);
    assert.equal((await f.store.list('package-quantity-review')).length, 0);
  });
}

for (const [field, value] of [
  ['flavour', 'vanilla'],
  ['formulaRevision', 'another-formula'],
]) {
  test(`reviewed packet cannot override original structured ${field}`, async () => {
    const f = await fixture();
    const original = JSON.parse(
      (await f.store.blob(f.source.blob.sha256)).toString()
    );
    original.identity[field] = value;
    const blob = await f.store.putBlob(Buffer.from(JSON.stringify(original)));
    await f.store.put('manufacturer-source', { ...f.source, blob });
    for (const candidate of [f.protein, f.mass]) {
      const saved = { ...candidate, sourceSha256: blob.sha256 };
      await f.store.put('manufacturer-fact-candidate', saved);
      const draftId =
        candidate.field === 'netMassG' ? 'review-draft:quantity' : f.draft.id;
      const draft = await f.store.get('manufacturer-review-draft', draftId);
      await f.store.put('manufacturer-review-draft', {
        ...draft,
        candidates: [saved],
      });
    }
    f.store.writes = [];
    await assert.rejects(
      reviewManufacturerWorkflow(f.application, f.packet),
      /Original structured source identity conflicts/u
    );
    assert.equal(f.store.writes.length, 0);
  });
}

test('approved primary-source review survives associative restart and stays private over shared originals', async (t) => {
  const f = await fixture();
  const directory = await mkdtemp(
    join(tmpdir(), 'manufacturer-workflow-private-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const privateStore = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: shared,
  });
  for (const bytes of f.store.blobs.values()) {
    await shared.putBlob(bytes);
  }
  for (const [key, record] of f.store.records) {
    const kind = key.slice(0, key.indexOf(':'));
    await (kind === 'manufacturer-source' ? privateStore : shared).put(
      kind,
      record
    );
  }
  const application = {
    ...f.application,
    store: privateStore,
    cache: new EvidenceCache({ store: privateStore, offline: true }),
  };
  await reviewManufacturerWorkflow(application, f.packet);
  const restarted = new AssociativeStore({
    directory: privateStore.directory,
    visibility: 'private',
    fallback: shared,
  });
  const approved = await restarted.get('product', f.product.id);
  assert.equal(approved.proteinPer100g, 80);
  assert.equal(approved.visibility, 'private');
  assert.equal(
    (await shared.get('product', f.product.id)).proteinPer100g,
    undefined
  );
  const attachments = (await restarted.list('evidence')).filter(
    (row) => row.sourceId === f.source.id
  );
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].visibility, 'private');
  assert.deepEqual(
    await restarted.blob(attachments[0].blob.sha256),
    await shared.blob(f.source.blob.sha256)
  );
  assert.equal(
    (await shared.list('evidence')).some((row) => row.sourceId === f.source.id),
    false
  );
  assert.deepEqual(
    await restarted.get('offer', 'offer:fixture'),
    await shared.get('offer', 'offer:fixture')
  );
  assert.equal(
    (await restarted.list('manufacturer-workflow-review')).length,
    1
  );
});

test('quantity workflow establishes grams and millilitres independently from the selected original without approving nutrition', async () => {
  const f = await fixture();
  const html = Buffer.from(
    '<html><body><h1 class="pdp-mod-product-badge-title">Factory kem chocolate 500ml</h1><button data-sku-option data-sku-id="2" aria-checked="true">Chocolate 500ml</button></body></html>'
  );
  const listing = await f.store.putBlob(html);
  const snapshot = extractPage({
    document: parseHTML(html.toString()).document,
    url: f.product.url,
  });
  const product = parseProduct(snapshot, {
    evidenceId: f.packet.listingEvidenceId,
    originalHtmlSha256: listing.sha256,
    observedAt: f.product.observedAt,
  }).product;
  const exactIdentity = {
    ...identity,
    name: 'Chocolate ice cream',
    category: 'ice-cream',
    coreFlavour: 'chocolate',
    packageType: 'tub',
    netMassG: 250,
    netVolumeMl: 500,
  };
  const blob = await f.store.putBlob(
    Buffer.from(
      JSON.stringify({
        identity: exactIdentity,
        label: 'Net weight 250 g; Net volume 500 ml',
      })
    )
  );
  const source = { ...f.source, blob };
  await f.store.put('manufacturer-source', source);
  await f.store.put('evidence', {
    id: f.packet.listingEvidenceId,
    role: 'listing',
    url: product.url,
    observedAt: product.observedAt,
    html: listing,
  });
  await f.store.put('product', product);
  const offer = {
    ...(await f.store.get('offer', 'offer:fixture')),
    productId: product.id,
    sku: product.sku,
  };
  await f.store.put('offer', offer);
  const mass = {
    ...f.mass,
    productId: product.id,
    identity: exactIdentity,
    sourceSha256: blob.sha256,
    value: 250,
    excerpt: 'Net weight 250 g',
    valueExcerpt: '250 g',
  };
  const volume = {
    ...mass,
    id: 'candidate:volume',
    field: 'netVolumeMl',
    value: 500,
    unit: 'ml',
    excerpt: 'Net volume 500 ml',
    valueExcerpt: '500 ml',
  };
  for (const candidate of [mass, volume]) {
    await f.store.put('manufacturer-fact-candidate', candidate);
  }
  const fingerprint = workflowProductFingerprint(product);
  const draft = {
    ...f.draft,
    id: 'review-draft:quantity',
    kind: 'quantity',
    productId: product.id,
    productFingerprint: fingerprint,
    candidates: [mass, volume],
  };
  await f.store.put('manufacturer-review-draft', draft);
  await f.store.put('manufacturer-workflow', {
    id: f.packet.workflowId,
    items: [
      {
        ...f.item,
        productId: product.id,
        productFingerprint: fingerprint,
        identity: exactIdentity,
      },
    ],
    tasks: [{ reviewDraftId: draft.id }],
  });
  const receipt = await reviewManufacturerWorkflow(f.application, {
    ...f.packet,
    reviewDraftId: draft.id,
    productFingerprint: fingerprint,
    listingSha256: listing.sha256,
    listingIdentity: exactIdentity,
    manufacturerIdentity: exactIdentity,
    sourceIdentities: { [source.id]: exactIdentity },
    candidateIds: [mass.id, volume.id],
    factoryQuantityCandidateIds: [],
  });
  assert.deepEqual(receipt.appliedFields.sort(), ['netMassG', 'netVolumeMl']);
  const reviewed = await resolveProductReviews(
    f.store,
    await f.store.get('product', product.id)
  );
  assert.equal(reviewed.netMassG, 250);
  assert.equal(reviewed.netVolumeMl, 500);
  assert.equal(reviewed.proteinPer100g, undefined);
  assert.equal(reviewed.manufacturerVerification, undefined);
  const packageReview = await f.store.get(
    'package-quantity-review',
    product.id
  );
  assert.equal(packageReview.nutritionApproved, false);
  assert.equal(packageReview.factoryIdentityApproved, false);
  assert.deepEqual(await f.store.get('offer', offer.id), offer);
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

test('provider identity preserves cached-only reuse but isolates actual bounds and response mappings', async () => {
  const f = await fixture();
  const config = {
    origin: 'https://search.example',
    endpoint: 'https://search.example/query',
  };
  const live = createManufacturerSearchProvider(f.application, config);
  const cached = createManufacturerSearchProvider(f.application, {
    ...config,
    cacheOnly: true,
  });
  const larger = createManufacturerSearchProvider(f.application, {
    ...config,
    maxResults: 300,
  });
  const mapped = createManufacturerSearchProvider(f.application, {
    ...config,
    rowsPath: '/data/items',
  });
  assert.equal(live.configurationSha256, cached.configurationSha256);
  assert.notEqual(live.configurationSha256, larger.configurationSha256);
  assert.notEqual(live.configurationSha256, mapped.configurationSha256);
});

function searchRequest() {
  return {
    queries: ['site:factory.example chocolate'],
    domains: ['factory.example'],
    maxResults: 8,
  };
}

async function withMockSearch(action, respond, config = {}) {
  const f = await fixture();
  f.application.cache.offline = false;
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  };
  try {
    const provider = createManufacturerSearchProvider(f.application, {
      origin: 'https://search.example',
      endpoint: 'https://search.example/query',
      ...config,
    });
    return await action({ ...f, provider, calls });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('HTTP JSON provider sends bounded POST and omits token echoes from returned candidates', async () => {
  const name = 'LAZADA_MANUFACTURER_FIXTURE_SEARCH_TOKEN';
  const previous = process.env[name];
  const secret = 'fixture-secret-never-persisted';
  process.env[name] = secret;
  try {
    await withMockSearch(
      async ({ provider, calls, store }) => {
        const rows = await provider.search(searchRequest());
        assert.deepEqual(rows, [
          {
            url: 'https://factory.example/chocolate',
            title: 'Original factory page',
          },
        ]);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.method, 'POST');
        assert.equal(calls[0].options.redirect, 'manual');
        assert.equal(calls[0].options.credentials, 'omit');
        assert.equal(
          calls[0].options.headers.Authorization,
          `Bearer ${secret}`
        );
        assert.equal(JSON.parse(calls[0].options.body).maxResults, 8);
        assert.equal(
          JSON.stringify(await store.list('manufacturer-search')).includes(
            secret
          ),
          false
        );
      },
      () =>
        new globalThis.Response(
          JSON.stringify({
            results: [
              {
                url: 'https://factory.example/chocolate',
                title: 'Original factory page',
              },
              { url: 'https://factory.example/chocolate', title: secret },
              {
                url: `https://factory.example/${secret}`,
                title: 'Secret echo',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
      { tokenEnv: name }
    );
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
});

test('active global CAPTCHA stop prevents even the first configured search request', async () => {
  await withMockSearch(
    async ({ provider, calls, store }) => {
      await stopForChallenge(store, {
        url: 'https://factory.example/captcha',
        signals: ['fixture-widget'],
      });
      await assert.rejects(
        provider.search(searchRequest()),
        (error) => error.code === 'COLLECTION_STOPPED'
      );
      assert.equal(calls.length, 0);
      assert.equal(
        (await store.get('collection-stop', 'browser-collection')).active,
        true
      );
    },
    () => {
      throw new Error('No request is allowed after CAPTCHA');
    }
  );
});

test('a search challenge persists the global stop and prevents subsequent requests', async () => {
  await withMockSearch(
    async ({ provider, calls, store }) => {
      await assert.rejects(
        provider.search(searchRequest()),
        (error) => error.code === 'COLLECTION_STOPPED'
      );
      await assert.rejects(
        provider.search(searchRequest()),
        (error) => error.code === 'COLLECTION_STOPPED'
      );
      assert.equal(calls.length, 1);
      assert.equal(
        (await store.get('collection-stop', 'browser-collection')).active,
        true
      );
    },
    () =>
      new globalThis.Response(
        '<html><title>Security verification</title><body>Verify you are human</body></html>',
        { headers: { 'content-type': 'text/html' } }
      )
  );
});

for (const [name, response, expected] of [
  [
    'oversized streamed response',
    () =>
      new globalThis.Response('x'.repeat(2048), {
        headers: { 'content-type': 'application/json' },
      }),
    /byte limit/u,
  ],
  [
    'redirect response',
    () =>
      new globalThis.Response('', {
        status: 302,
        headers: {
          location: 'https://other.example/search',
          'content-type': 'application/json',
        },
      }),
    /redirects are prohibited/u,
  ],
  [
    'invalid JSON response',
    () =>
      new globalThis.Response('not json', {
        headers: { 'content-type': 'application/json' },
      }),
    /invalid JSON/u,
  ],
]) {
  test(`search provider rejects ${name} with no cache publication`, async () => {
    await withMockSearch(
      async ({ provider, calls, store }) => {
        store.writes = [];
        await assert.rejects(provider.search(searchRequest()), expected);
        assert.equal(calls.length, 1);
        assert.equal(store.writes.length, 0);
      },
      response,
      { maxResponseBytes: 1024 }
    );
  });
}

test('request byte and result bounds are enforced before any fetch', async () => {
  await withMockSearch(
    async ({ provider, calls }) => {
      await assert.rejects(
        provider.search({ ...searchRequest(), queries: ['x'.repeat(1000)] }),
        /byte limit/u
      );
      await assert.rejects(
        provider.search({ ...searchRequest(), maxResults: 501 }),
        /integer between/u
      );
      assert.equal(calls.length, 0);
    },
    () => {
      throw new Error('Invalid request cannot fetch');
    },
    { maxBodyBytes: 256 }
  );
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

test('real lossless image transform and fixture-native OCR receipts verify after private associative restart', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'manufacturer-transform-proof-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
  });
  const modelDirectory = join(directory, 'models');
  await mkdir(modelDirectory);
  await writeFile(
    join(modelDirectory, 'eng.traineddata'),
    'fixture engine model bytes'
  );
  const original = await store.putBlob(
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer()
  );
  const tsv =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t99\t4.5\n';
  const ocr = new TesseractOcr({
    store,
    tessdataDir: modelDirectory,
    execute: async (_command, args) => ({
      stdout: args[0] === '--version' ? 'fixture engine\n' : tsv,
    }),
  });
  const baseline = await ocr.recognize(original);
  const derived = await ocr.recognize(original, {
    psm: 7,
    sourceOcrId: baseline.id,
    transform: {
      crop: { left: 10, top: 5, width: 15, height: 10 },
      resize: { width: 30, height: 20, kernel: 'nearest' },
      grayscale: true,
    },
  });
  const restarted = new AssociativeStore({
    directory: store.directory,
    visibility: 'private',
  });
  const proof = await verifyOriginalBoundOcr(restarted, original, derived);
  assert.equal(proof.text, '4.5');
  assert.equal(proof.originalImageSha256, original.sha256);
  assert.equal(proof.physicalImageSha256, derived.imageHash);
  assert.notEqual(proof.physicalImageSha256, original.sha256);
  assert.equal(
    (await sharp(await restarted.blob(derived.imageHash)).metadata()).width,
    30
  );
  assert.equal((await restarted.get('ocr', derived.id)).visibility, 'private');
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
