import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, identity } from './helpers/manufacturer-workflow.js';
import {
  applyManufacturerSourceValidity,
  createManufacturerSourceValidityLoader,
} from '../src/manufacturer-source-validity.js';
import { reviewManufacturerWorkflow } from '../src/manufacturer-workflow-review.js';
import { planManufacturerWorkflow } from '../src/manufacturer-workflow.js';
import { comparisonInputs } from '../src/comparison-inputs.js';
import { calculateOffer } from '../src/compare.js';
import {
  catalogProducts,
  resolveProductReviews,
} from '../src/catalog-products.js';

async function approvedFixture() {
  const f = await fixture();
  const quantities = await f.store.putBlob(Buffer.from('Net weight 2000 g'));
  const massSource = {
    ...f.source,
    id: 'manufacturer-source:independent-mass',
    url: 'https://factory.example/package',
    finalUrl: 'https://factory.example/package',
    contentType: 'text/plain',
    blob: quantities,
  };
  await f.store.put('manufacturer-source', massSource);
  const mass = {
    ...f.mass,
    sourceId: massSource.id,
    sourceUrl: massSource.url,
    sourceSha256: quantities.sha256,
  };
  await f.store.put('manufacturer-fact-candidate', mass);
  const quantityDraft = await f.store.get(
    'manufacturer-review-draft',
    'review-draft:quantity'
  );
  await f.store.put('manufacturer-review-draft', {
    ...quantityDraft,
    candidates: [mass],
  });
  const fields = [
    ['proteinPer100g', 80, 'g/100g', 'Protein 80 g per 100g', '80 g'],
    ['sugarPer100g', 1, 'g/100g', 'Sugar 1 g per 100g', '1 g'],
    ['fatPer100g', 2, 'g/100g', 'Total fat 2 g per 100g', '2 g'],
    ['saturatedFatPer100g', 1, 'g/100g', 'Saturated fat 1 g per 100g', '1 g'],
    ['kcalPer100g', 360, 'kcal/100g', 'Calories 360 kcal per 100g', '360 kcal'],
    [
      'ingredients',
      ['Whey protein isolate'],
      'text',
      'Ingredients: Whey protein isolate',
      null,
    ],
  ];
  const blob = await f.store.putBlob(
    Buffer.from(
      JSON.stringify({
        identity,
        label: fields.map((row) => row[3]).join('; '),
      })
    )
  );
  const source = { ...f.source, blob };
  await f.store.put('manufacturer-source', source);
  const candidates = fields.map(
    ([field, value, unit, excerpt, valueExcerpt]) => ({
      ...f.protein,
      id: `candidate:${field}`,
      sourceSha256: blob.sha256,
      field,
      value,
      unit,
      excerpt,
      valueExcerpt,
      basis:
        field === 'ingredients'
          ? 'complete-original-ingredient-list'
          : 'per-100g',
    })
  );
  for (const candidate of candidates) {
    await f.store.put('manufacturer-fact-candidate', candidate);
  }
  await f.store.put('manufacturer-review-draft', { ...f.draft, candidates });
  const originalOffer = {
    ...(await f.store.get('offer', 'offer:fixture')),
    variantConfirmed: true,
    available: true,
  };
  await f.store.put('offer', originalOffer);
  await reviewManufacturerWorkflow(f.application, {
    ...f.packet,
    candidateIds: candidates.map((row) => row.id),
    sourceIdentities: {
      ...f.packet.sourceIdentities,
      [massSource.id]: identity,
    },
  });
  const attachments = await f.store.list('evidence');
  return {
    ...f,
    source,
    massSource,
    originalOffer,
    nutritionEvidence: attachments.find((row) => row.sourceId === source.id),
    massEvidence: attachments.find((row) => row.sourceId === massSource.id),
  };
}

for (const kind of ['evidence-id', 'source-id', 'url', 'cache-id']) {
  test(`late ${kind} invalidation withdraws source nutrition and reopens work without losing independently sourced grams or prices`, async () => {
    const f = await approvedFixture();
    const before = await planManufacturerWorkflow(f.application, {
      id: 'before-invalidation',
      productIds: [f.product.id],
    });
    assert.equal(before.items[0].status, 'already-reviewed');
    assert.equal(before.tasks.length, 0);
    const invalidation = {
      id: `late:${kind}`,
      invalidated: true,
      ...(kind === 'evidence-id'
        ? { evidenceIds: [f.nutritionEvidence.id] }
        : kind === 'source-id'
          ? { sourceIds: [f.source.id] }
          : kind === 'url'
            ? { url: f.source.url }
            : { cacheIds: ['manufacturer-json-cache'] }),
    };
    if (kind === 'cache-id') {
      await f.store.put('cache', {
        id: 'manufacturer-json-cache',
        url: f.source.url,
        blob: f.source.blob,
        observedAt: f.source.observedAt,
        invalidatedAt: new Date().toISOString(),
      });
    }
    await f.store.put('invalidation', invalidation);
    f.store.writes = [];
    const inputs = await comparisonInputs(f.store, {
      manufacturerRegistry: f.application.manufacturerRegistry,
    });
    const product = inputs.products[0];
    assert.equal(product.proteinPer100g, undefined);
    assert.equal(product.netMassG, 2000);
    assert.equal(product.specificationsInvalidated, false);
    assert.ok(product.pendingSpecificationReview.includes('proteinPer100g'));
    assert.equal(product.manufacturerVerification.identityMatched, false);
    const row = calculateOffer(product, inputs.offers[0], {
      requireManufacturer: false,
      requireShipping: false,
    });
    assert.equal(row.metrics.costPerGramBeforeDelivery, 500);
    assert.equal(row.metrics.costPerProteinGramBeforeDelivery, null);
    assert.deepEqual(
      await f.store.get('offer', f.originalOffer.id),
      f.originalOffer
    );
    assert.equal(
      (await f.store.get('product', f.product.id)).proteinPer100g,
      80,
      'Original approved observation remains preserved'
    );
    assert.equal(f.store.writes.length, 0);
    const plan = await planManufacturerWorkflow(f.application, {
      id: 'after-invalidation',
      productIds: [f.product.id],
    });
    assert.equal(plan.items[0].status, 'unresolved');
    assert.ok(
      plan.items[0].nutritionFields.includes('protein:explicit-label-basis')
    );
    assert.ok(plan.tasks.some((task) => task.kind === 'discover-sources'));
  });
}

for (const mutation of [
  'changed-source',
  'missing-bytes',
  'review-invalidated',
]) {
  test(`catalog and exact product resolution withdraw approval after ${mutation}`, async () => {
    const f = await approvedFixture();
    if (mutation === 'changed-source') {
      const blob = await f.store.putBlob(
        Buffer.from('Another current formula original')
      );
      await f.store.put('manufacturer-source', { ...f.source, blob });
    } else if (mutation === 'missing-bytes') {
      f.store.blobs.delete(f.source.blob.sha256);
    } else {
      const product = await f.store.get('product', f.product.id);
      const review = await f.store.get(
        'manufacturer-review',
        product.manufacturerVerification.reviewId
      );
      await f.store.put('manufacturer-review', {
        ...review,
        invalidated: true,
      });
    }
    const product = await resolveProductReviews(
      f.store,
      await f.store.get('product', f.product.id)
    );
    assert.equal(product.proteinPer100g, undefined);
    assert.equal((await catalogProducts(f.store))[0].proteinPer100g, undefined);
    if (mutation !== 'review-invalidated') {
      assert.equal(product.netMassG, 2000);
    }
    assert.deepEqual(
      await f.store.get('offer', f.originalOffer.id),
      f.originalOffer
    );
  });
}

test('resolved or inactive invalidations do not withdraw unchanged source-approved facts', async () => {
  const f = await approvedFixture();
  await f.store.put('invalidation', {
    id: 'inactive',
    evidenceIds: [f.nutritionEvidence.id],
    invalidated: true,
    active: false,
  });
  await f.store.put('invalidation', {
    id: 'resolved',
    sourceIds: [f.source.id],
    invalidated: true,
    resolvedAt: new Date().toISOString(),
  });
  const product = (await catalogProducts(f.store))[0];
  assert.equal(product.proteinPer100g, 80);
  assert.equal(product.netMassG, 2000);
  assert.equal(product.manufacturerVerification.identityMatched, true);
});

test('an unrelated granular claim cannot waive a legacy manufacturer cross-check source hold', async () => {
  const f = await approvedFixture();
  const product = await f.store.get('product', f.product.id);
  const legacyUrl = 'https://factory.example/legacy-nutrition';
  await f.store.put('product', {
    ...product,
    claims: product.claims.filter((claim) => claim.field === 'netMassG'),
    crossChecks: [
      ...product.crossChecks,
      {
        id: 'legacy-check',
        evidenceId: 'legacy-evidence',
        manufacturerUrl: legacyUrl,
        identityMatched: true,
        sourceAuthority: 'manufacturer',
      },
    ],
  });
  await f.store.put('cache', {
    id: 'manufacturer:legacy',
    url: legacyUrl,
    invalidatedAt: new Date().toISOString(),
  });
  await f.store.put('invalidation', {
    id: 'legacy-invalidation',
    cacheIds: ['manufacturer:legacy'],
    url: legacyUrl,
    invalidatedAt: new Date().toISOString(),
  });
  const inputs = await comparisonInputs(f.store);
  assert.equal(inputs.products[0].specificationsInvalidated, true);
  assert.equal(
    inputs.products[0].manufacturerSourceValidityHandledUrls.includes(
      legacyUrl
    ),
    false
  );
  const row = calculateOffer(inputs.products[0], inputs.offers[0], {
    requireManufacturer: false,
    requireShipping: false,
  });
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, null);
});

for (const selectedOnly of [false, true]) {
  test(`manufacturer source context is shared once per ${selectedOnly ? 'selected-offer' : 'whole-catalog'} comparison and refreshed on the next operation`, async () => {
    const f = await approvedFixture();
    const product = await f.store.get('product', f.product.id);
    const ids = new Set([f.originalOffer.id]);
    // Read-count fixtures share one exact factory formula and source receipts.
    for (const suffix of ['alias-a', 'alias-b']) {
      const id = `${product.id}:${suffix}`;
      await f.store.put('product', { ...product, id });
      const offer = {
        ...f.originalOffer,
        id: `offer:${suffix}`,
        productId: id,
      };
      await f.store.put('offer', offer);
      ids.add(offer.id);
    }
    const counts = new Map();
    const list = f.store.list.bind(f.store);
    const get = f.store.get.bind(f.store);
    f.store.list = (kind) => {
      counts.set(`list:${kind}`, (counts.get(`list:${kind}`) || 0) + 1);
      return list(kind);
    };
    f.store.get = (kind, id) => {
      counts.set(
        `get:${kind}:${id}`,
        (counts.get(`get:${kind}:${id}`) || 0) + 1
      );
      return get(kind, id);
    };
    const options = selectedOnly ? { offerIds: ids } : {};
    const before = await comparisonInputs(f.store, options);
    assert.equal(before.products.length, 3);
    assert.equal(counts.get('list:cache'), 1);
    assert.equal(counts.get('list:invalidation'), 1);
    assert.equal(counts.get(`get:manufacturer-source:${f.source.id}`), 1);
    await f.store.put('invalidation', {
      id: 'between-operations',
      sourceIds: [f.source.id],
      invalidated: true,
    });
    counts.clear();
    const after = await comparisonInputs(f.store, options);
    assert.ok(after.products.every((row) => row.proteinPer100g === undefined));
    assert.equal(counts.get('list:cache'), 1);
    assert.equal(counts.get('list:invalidation'), 1);
  });
}

for (const operation of [
  'catalog',
  'whole-comparison',
  'selected-comparison',
]) {
  test(`${operation} with no approved manufacturer claim or legacy check does not scan source caches`, async () => {
    const f = await fixture();
    const list = f.store.list.bind(f.store);
    let cacheLists = 0;
    f.store.list = (kind) => {
      if (kind === 'cache') {
        cacheLists += 1;
        assert.fail('A claim-free operation must not list source caches');
      }
      return list(kind);
    };
    if (operation === 'catalog') {
      assert.equal((await catalogProducts(f.store)).length, 1);
    } else {
      const options =
        operation === 'selected-comparison'
          ? { offerIds: new Set(['offer:fixture']) }
          : {};
      assert.equal(
        (await comparisonInputs(f.store, options)).products.length,
        1
      );
    }
    assert.equal(cacheLists, 0);
  });
}

test('shared approved fallback facts trigger lazy source validation after merging a claim-free private observation', async () => {
  const f = await approvedFixture();
  const shared = await f.store.get('product', f.product.id);
  await f.store.put('product', f.product);
  f.store.fallback = {
    get: (kind, id) =>
      Promise.resolve(
        kind === 'product' && id === shared.id
          ? globalThis.structuredClone(shared)
          : undefined
      ),
    list: (kind) =>
      Promise.resolve(
        kind === 'product' ? [globalThis.structuredClone(shared)] : []
      ),
  };
  const list = f.store.list.bind(f.store);
  let cacheLists = 0;
  f.store.list = (kind) => {
    if (kind === 'cache') {
      cacheLists += 1;
    }
    return list(kind);
  };
  const approved = (await catalogProducts(f.store))[0];
  assert.equal(approved.proteinPer100g, 80);
  assert.equal(cacheLists, 1);
  await f.store.put('invalidation', {
    id: 'fallback-source-hold',
    sourceIds: [f.source.id],
    invalidated: true,
  });
  cacheLists = 0;
  const revoked = (await catalogProducts(f.store))[0];
  assert.equal(revoked.proteinPer100g, undefined);
  assert.equal(revoked.netMassG, 2000);
  assert.equal(cacheLists, 1);
});

test('concurrent eligible consumers initialize one lazy source context and preserve source corruption checks', async () => {
  const f = await approvedFixture();
  const product = await f.store.get('product', f.product.id);
  const list = f.store.list.bind(f.store);
  let cacheLists = 0;
  f.store.list = async (kind) => {
    if (kind === 'cache') {
      cacheLists += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return list(kind);
  };
  const sourceContext = createManufacturerSourceValidityLoader(f.store);
  assert.equal(cacheLists, 0);
  const rows = await Promise.all(
    Array.from({ length: 5 }, () =>
      applyManufacturerSourceValidity(f.store, product, sourceContext)
    )
  );
  assert.ok(rows.every((row) => row.proteinPer100g === 80));
  assert.equal(cacheLists, 1);
  f.store.blobs.delete(f.source.blob.sha256);
  const nextContext = createManufacturerSourceValidityLoader(f.store);
  const changed = await applyManufacturerSourceValidity(
    f.store,
    product,
    nextContext
  );
  assert.equal(changed.proteinPer100g, undefined);
  assert.equal(changed.netMassG, 2000);
  assert.equal(cacheLists, 2);
});
