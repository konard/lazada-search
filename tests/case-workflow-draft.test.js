import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { auditCoverage } from '../src/coverage.js';
import { reviewListingCategory } from '../src/category-review.js';
import { sha256 } from '../src/util.js';
import { planCaseWorkflow, runCaseWorkflow } from '../src/case-workflow.js';
import {
  applyCaseCategoryDecisions,
  caseCoverageStatus,
  recordCaseManualReview,
} from '../src/case-coverage.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-case-draft-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const calls = [];
  const app = {
    store,
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
    cache: { offline: true, stats: { downloads: 0, hits: 0 } },
    assertMarket: (url) =>
      assert.match(new URL(url).hostname, /(?:^|\.)lazada\.vn$/u),
    compare: async () => ({ comparisons: [], assumptions: {} }),
    compareBaskets: async () => ({ observations: [] }),
    translateCatalog: async () => ({
      reviewedComplete: true,
      counts: { remaining: 0 },
    }),
    collect: async (url) => {
      calls.push(url);
      throw new Error('No external collector is configured');
    },
  };
  app.audit = async () =>
    auditCoverage({
      crawl: (await store.list('crawl'))[0],
      products: await store.list('product'),
      offers: await store.list('offer'),
      discoveries: await store.list('discovery'),
      skuInventories: await store.list('sku-inventory'),
    });
  const at = new Date(Date.now() - 1000).toISOString();
  await store.put('crawl', {
    id: `crawl:${at}`,
    startedAt: at,
    queries: ['whey protein'],
    categoryUrls: [],
    scopes: [{ query: 'whey protein', terminalConfirmed: true }],
    failures: [],
    uncollectedUrls: [],
  });
  return { app, store, calls, at };
}

async function unknownCard(
  store,
  at,
  id = 'discovery:uncertain',
  item = '100'
) {
  const url = `https://www.lazada.vn/products/pdp-i${item}.html`;
  const cacheId = `page:https://www.lazada.vn/catalog/?q=${item}`;
  const html = await store.putBlob(
    Buffer.from(
      `<html><body><a href="${url}">Exact original uncertain card ${item}</a></body></html>`
    )
  );
  await store.put('cache', {
    id: cacheId,
    url: `https://www.lazada.vn/catalog/?q=${item}`,
    observedAt: at,
    html,
    status: 'ok',
  });
  const discovery = await store.put('discovery', {
    id,
    url,
    title: 'Uncertain food package',
    category: 'unknown',
    classification: 'needs-category-review',
    cacheId,
    observedAt: at,
  });
  return {
    discovery,
    proof: { evidenceId: cacheId, sourceSha256: html.sha256 },
  };
}

function reviewInput(coverage, evidence, categoryDecisions = []) {
  return {
    scope: coverage.scope,
    scopeFingerprint: coverage.scopeFingerprint,
    reviewedBy: 'Draft source reviewer',
    reason: 'Independently checked exact originals',
    evidence,
    categoryDecisions,
    exactPriceExtractionReviewed: true,
    quantityExtractionReviewed: true,
    classificationReviewed: true,
    listPaginationReviewed: true,
  };
}

test('draft manual review cannot waive unknown cards and inclusion creates missing-listing work', async (t) => {
  const { app, store, at } = await fixture(t);
  const { discovery, proof } = await unknownCard(store, at);
  let coverage = await caseCoverageStatus(app);
  assert.equal(coverage.audit.categoryReview.length, 1);
  await assert.rejects(
    recordCaseManualReview(app, reviewInput(coverage, [proof])),
    /each unknown/u
  );
  assert.equal((await store.list('case-manual-review')).length, 0);
  const decision = {
    recordId: discovery.id,
    recordFingerprint: sha256(JSON.stringify(discovery)),
    decision: 'included',
    category: 'whey',
    reason: 'Original card is a candidate whey package',
    evidence: [proof],
  };
  const review = await recordCaseManualReview(
    app,
    reviewInput(coverage, [proof], [decision])
  );
  coverage = await caseCoverageStatus(app, { manualReviewId: review.id });
  assert.equal(coverage.audit.categoryReview.length, 0);
  assert.ok(coverage.audit.missingListings.includes(discovery.url));
  assert.equal(coverage.observedScopeReady, false);
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  assert.ok(
    planned.tasks.some(
      (task) => task.stage === 'listing' && task.input.url === discovery.url
    )
  );
  assert.ok(planned.tasks.some((task) => task.stage === 'manual-review'));
});

test('draft retained category decisions withdraw when their source card or original is changed', async (t) => {
  const { app, store, at } = await fixture(t);
  const { discovery, proof } = await unknownCard(store, at);
  const coverage = await caseCoverageStatus(app);
  const review = await recordCaseManualReview(
    app,
    reviewInput(
      coverage,
      [proof],
      [
        {
          recordId: discovery.id,
          recordFingerprint: sha256(JSON.stringify(discovery)),
          decision: 'excluded',
          reason: 'Original source shows a non-food accessory',
          evidence: [proof],
        },
      ]
    )
  );
  assert.equal(
    (await caseCoverageStatus(app, { manualReviewId: review.id })).manualReview
      .id,
    review.id
  );
  await store.put('discovery', {
    ...discovery,
    title: 'Changed evidence now advertises whey chocolate',
  });
  const changed = await caseCoverageStatus(app, { manualReviewId: review.id });
  assert.equal(changed.manualReview, null);
  assert.equal(changed.audit.categoryReview.length, 1);
  assert.equal(changed.audit.unknownListingBacklog[0].id, discovery.id);
  await store.put('discovery', discovery);
  await store.put('invalidation', {
    id: proof.evidenceId,
    cacheIds: [proof.evidenceId],
    invalidatedAt: new Date().toISOString(),
  });
  assert.equal(
    (await applyCaseCategoryDecisions(app, await app.audit())).categoryReview
      .length,
    1
  );
});

test('draft manual task consumes a valid current review and later data changes revoke it', async (t) => {
  const { app, store, at } = await fixture(t);
  const { discovery, proof } = await unknownCard(store, at);
  const coverage = await caseCoverageStatus(app);
  const review = await recordCaseManualReview(
    app,
    reviewInput(
      coverage,
      [proof],
      [
        {
          recordId: discovery.id,
          recordFingerprint: sha256(JSON.stringify(discovery)),
          decision: 'excluded',
          reason: 'Original source independently confirms an accessory',
          evidence: [proof],
        },
      ]
    )
  );
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  const result = await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 10,
    manualReviewId: review.id,
  });
  assert.ok(
    result.tasks.some(
      (task) => task.stage === 'manual-review' && task.status === 'succeeded'
    )
  );
  await store.put('offer', {
    id: 'new-offer',
    url: 'https://www.lazada.vn/products/pdp-i200.html',
    productId: 'new-product',
    price: 100000,
    currency: 'VND',
    sku: '200_VNAMZ-20',
    variantConfirmed: true,
    observedAt: at,
  });
  assert.equal(
    (await caseCoverageStatus(app, { manualReviewId: review.id })).manualReview,
    null
  );
});

test('draft worklist schedules scoped plain/chocolate powders and strict chocolate ice while retaining unknown SKU backlog', async (t) => {
  const { app, store, at } = await fixture(t);
  for (const [id, category, text] of [
    ['plain', 'protein-powder', 'Unflavored'],
    ['choc', 'whey', 'Chocolate'],
    ['ice', 'chocolate-ice-cream', 'Chocolate'],
    ['vanilla', 'whey', 'Vanilla'],
    ['shaker', 'whey', 'Chocolate + Shaker'],
    ['white', 'chocolate-ice-cream', 'White chocolate'],
    ['soy', 'protein-powder', 'Soy isolate chocolate'],
  ]) {
    await store.put('product', {
      id,
      url: `https://www.lazada.vn/products/pdp-i${100 + id.length}.html`,
      title: text,
      category,
      selectedVariant: [{ text }],
      claims: [],
      evidenceIds: [],
      observedAt: at,
    });
  }
  await store.put('sku-inventory', {
    id: 'inventory-999',
    url: 'https://www.lazada.vn/products/pdp-i999.html',
    inventoryObserved: true,
    skus: [
      { sku: '999_VNAMZ-91', options: [{ value: 'Unclear option' }] },
      { sku: '999_VNAMZ-92', options: [{ value: 'Vanilla' }] },
      { sku: '999_VNAMZ-93', options: [{ value: 'Chocolate + Shaker' }] },
    ],
  });
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  const ids = planned.tasks
    .filter((task) => task.stage === 'manufacturer')
    .map((task) => task.input.productId);
  assert.ok(
    ids.includes('plain') && ids.includes('choc') && ids.includes('ice')
  );
  assert.ok(
    !ids.includes('vanilla') &&
      !ids.includes('shaker') &&
      !ids.includes('white') &&
      !ids.includes('soy')
  );
  assert.ok(
    planned.tasks.some(
      (task) => task.stage === 'sku' && task.input.sku === '999_VNAMZ-91'
    )
  );
  assert.ok(
    !planned.tasks.some(
      (task) =>
        task.input.sku === '999_VNAMZ-92' || task.input.sku === '999_VNAMZ-93'
    )
  );
  assert.equal(
    (await store.list('scope-decision')).filter(
      (record) => record.decision === 'excluded'
    ).length,
    2
  );
});

test('draft case runner honours the persisted global CAPTCHA before collector work', async (t) => {
  const { app, store, calls } = await fixture(t);
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    origin: 'https://www.optimumnutrition.com',
  });
  await assert.rejects(
    runCaseWorkflow(app, planned.workflow.id, {
      allowNetwork: true,
      maxTasks: 1,
    }),
    (error) => error.code === 'COLLECTION_STOPPED'
  );
  assert.deepEqual(calls, []);
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
});

test('draft exact SKU task rejects a different item even when its numeric SKU suffix matches', async (t) => {
  const { app, store } = await fixture(t);
  await store.put('sku-inventory', {
    id: 'inventory-999',
    url: 'https://www.lazada.vn/products/pdp-i999.html',
    inventoryObserved: true,
    skus: [{ sku: '999_VNAMZ-91', options: [{ value: 'Unclear option' }] }],
  });
  app.collect = async () => ({
    product: { id: 'wrong-product' },
    offer: {
      id: 'wrong-offer',
      sku: '998_VNAMZ-91',
      variantConfirmed: true,
      price: 100000,
    },
  });
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  const result = await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 1,
  });
  const task = result.tasks.find((entry) => entry.stage === 'sku');
  assert.equal(task.status, 'blocked');
  assert.match(task.reason, /exact SKU/u);
  assert.equal((await store.list('offer')).length, 0);
});

test('draft preliminary inclusion cannot hide unknown or contradictory detailed categories or waive them with a blanket review', async (t) => {
  const { app, store, at } = await fixture(t);
  const { discovery, proof } = await unknownCard(store, at);
  const initial = await caseCoverageStatus(app);
  await recordCaseManualReview(
    app,
    reviewInput(
      initial,
      [proof],
      [
        {
          recordId: discovery.id,
          recordFingerprint: sha256(JSON.stringify(discovery)),
          decision: 'included',
          category: 'protein-powder',
          reason: 'Preliminary source only identifies a potential powder',
          evidence: [proof],
        },
      ]
    )
  );
  const html = await store.putBlob(
    Buffer.from(
      '<html><body><h1>Chocolate frozen ice cream 130ml</h1></body></html>'
    )
  );
  await store.put('evidence', {
    id: 'listing:100',
    url: discovery.url,
    role: 'listing',
    observedAt: at,
    html,
  });
  const product = {
    id: 'product:100',
    url: discovery.url,
    sku: '100_VNAMZ-11',
    title: 'Chocolate food package',
    category: 'unknown',
    observedAt: at,
    originalHtmlSha256: html.sha256,
    evidenceIds: ['listing:100'],
    claims: [],
    selectedVariant: [{ text: 'Chocolate' }],
  };
  await store.put('product', product);
  await store.put('offer', {
    id: 'offer:100',
    productId: product.id,
    url: discovery.url,
    sku: product.sku,
    currency: 'VND',
    variantConfirmed: true,
    observedAt: at,
  });
  let coverage = await caseCoverageStatus(app);
  assert.equal(coverage.audit.categoryReview.length, 0);
  assert.equal(coverage.audit.categoryReviewProducts[0].productId, product.id);
  assert.equal(coverage.audit.scopedDatasetReady, false);
  await assert.rejects(
    recordCaseManualReview(app, reviewInput(coverage, [proof])),
    /detailed product category/u
  );
  const planned = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    recollectAfterInitialPass: false,
  });
  assert.ok(planned.tasks.some((task) => task.stage === 'manual-review'));
  await store.put('product', {
    ...product,
    category: 'whey',
    title: 'Whey protein chocolate',
  });
  assert.equal(
    (await caseCoverageStatus(app)).audit.categoryReviewProducts.length,
    0
  );
  await store.put('product', {
    ...product,
    category: 'chocolate-ice-cream',
    title: 'Chocolate frozen ice cream 130ml',
  });
  coverage = await caseCoverageStatus(app);
  assert.equal(coverage.audit.categoryReviewProducts.length, 1);
  await assert.rejects(
    recordCaseManualReview(app, reviewInput(coverage, [proof])),
    /detailed product category/u
  );
  await reviewListingCategory(app, discovery.url, {
    category: 'chocolate-ice-cream',
    evidenceId: 'listing:100',
    reviewedBy: 'Detailed source reviewer',
    reason:
      'Exact original listing establishes frozen chocolate food; preliminary powder inclusion was wrong',
  });
  assert.equal(
    (await caseCoverageStatus(app)).audit.categoryReviewProducts.length,
    0
  );
  await store.put('invalidation', {
    id: 'listing-source-invalidated',
    evidenceIds: ['listing:100'],
    invalidatedAt: new Date().toISOString(),
  });
  assert.equal(
    (await caseCoverageStatus(app)).audit.categoryReviewProducts.length,
    1
  );
});
