import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { auditCoverage } from '../src/coverage.js';
import { reviewListingCategory } from '../src/category-review.js';
import { sha256 } from '../src/util.js';
import { planCaseWorkflow, runCaseWorkflow } from '../src/case-workflow.js';
import { acquireCaseLease } from '../src/case-workflow-lock.js';
import { recordListingUnavailable } from '../src/availability.js';
import {
  applyCaseCategoryDecisions,
  caseCoverageStatus,
  recordCaseManualReview,
  importCaseInventoryManifest,
  verifyCaseInventory,
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
      availability: await store.list('listing-availability'),
      invalidations: await store.list('invalidation'),
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

async function pendingSku(store, at) {
  return store.put('sku-inventory', {
    id: 'inventory-999',
    url: 'https://www.lazada.vn/products/pdp-i999.html',
    inventoryObserved: true,
    observedAt: at,
    skus: [{ sku: '999_VNAMZ-91', options: [{ value: 'Chocolate' }] }],
  });
}

const simplePlan = {
  queries: ['whey protein'],
  categoryUrls: [],
  recollectAfterInitialPass: false,
};

test('case terminal discovery barrier defers exact-SKU work until every configured list is complete', async (t) => {
  const { app, store, calls, at } = await fixture(t);
  await pendingSku(store, at);
  const [crawl] = await store.list('crawl');
  await store.put('crawl', {
    ...crawl,
    scopes: [{ query: 'whey protein', terminalConfirmed: false }],
  });
  app.crawl = async (input) => {
    assert.equal(input.discoveryOnly, true);
    assert.equal(input.exhaustive, true);
    assert.equal(input.searchSort, 'priceasc');
    await store.put('crawl', crawl);
    return { id: crawl.id, discoveryComplete: true };
  };
  const planned = await planCaseWorkflow(app, simplePlan);
  assert.deepEqual(
    planned.tasks
      .filter((task) => task.stage !== 'report')
      .map((task) => task.stage),
    ['discovery']
  );
  const result = await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 1,
  });
  assert.deepEqual(calls, []);
  assert.ok(
    result.tasks.some(
      (task) => task.stage === 'discovery' && task.status === 'succeeded'
    )
  );
  assert.ok(
    result.tasks.some(
      (task) => task.stage === 'sku' && task.status === 'pending'
    )
  );
});

test('case retries remain bounded and interrupted checkpoints require explicit recovery', async (t) => {
  const { app, store, at } = await fixture(t);
  await pendingSku(store, at);
  let attempts = 0;
  app.collect = async () => {
    attempts += 1;
    throw new Error('Original quantity price is still loading');
  };
  const planned = await planCaseWorkflow(app, {
    ...simplePlan,
    maxAttempts: 2,
  });
  const sku = planned.tasks.find((task) => task.stage === 'sku');
  await store.put('case-task', { ...sku, status: 'running', runs: 1 });
  await runCaseWorkflow(app, planned.workflow.id, { maxTasks: 1 });
  assert.equal(attempts, 0);
  await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 1,
    recoverInterrupted: true,
  });
  assert.equal(attempts, 1);
  await runCaseWorkflow(app, planned.workflow.id, { maxTasks: 1 });
  assert.equal(attempts, 1);
  await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 1,
    retryBlocked: true,
  });
  await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 10,
    retryBlocked: true,
  });
  assert.equal(attempts, 2);
  const checkpoint = await store.get('case-task', sku.id);
  assert.equal(checkpoint.status, 'blocked');
  assert.equal(checkpoint.attempts, 2);
  assert.equal(checkpoint.runs, 3);
});

async function leaseWorker(t, directory, workflowId) {
  const workerPath = join(directory, `lease-worker-${randomUUID()}.mjs`);
  const moduleUrl = new URL('../src/case-workflow-lock.js', import.meta.url)
    .href;
  await writeFile(
    workerPath,
    `
import { acquireCaseLease } from ${JSON.stringify(moduleUrl)};
try {
  const release = await acquireCaseLease({store:{directory:process.argv[2]}},process.argv[3]);
  console.log('LEASE');
  process.stdin.once('data', async () => { await release(); process.exit(0); });
  process.stdin.resume();
} catch (error) {
  console.log(error.code || error.message);
  process.exit(error.code === 'WORKFLOW_BUSY' ? 0 : 1);
}
`
  );
  // Node is installed before every CI runtime; the independently held lease
  // must belong to a distinct process, including under Bun and Deno runners.
  const child = spawn('node', [workerPath, directory, workflowId], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await exited;
  });
  const message = await new Promise((resolve, reject) => {
    let output = '';
    child.once('error', reject);
    child.stdout.on('data', (bytes) => {
      output += bytes;
      if (output.includes('\n')) {
        resolve(output.split('\n')[0].trim());
      }
    });
    child.once('exit', (code) => {
      if (!output.includes('\n')) {
        reject(new Error(`Lease worker exited without a checkpoint: ${code}`));
      }
    });
  });
  return { child, exited, message };
}

test('case lease rejects an independent live worker and malformed orphan metadata without deleting it', async (t) => {
  const { app, store } = await fixture(t);
  const workflowId = 'lease-independent';
  const worker = await leaseWorker(t, store.directory, workflowId);
  assert.equal(worker.message, 'LEASE');
  await assert.rejects(
    acquireCaseLease(app, workflowId),
    (error) => error.code === 'WORKFLOW_BUSY'
  );
  worker.child.stdin.end('release\n');
  assert.equal((await worker.exited).code, 0);
  const release = await acquireCaseLease(app, workflowId);
  await release();
  const orphan = join(
    store.directory,
    '.case-workflow-locks',
    sha256(workflowId)
  );
  await mkdir(orphan);
  await writeFile(join(orphan, 'owner.json'), '{malformed');
  await assert.rejects(
    acquireCaseLease(app, workflowId),
    (error) => error.code === 'WORKFLOW_BUSY'
  );
  assert.equal(
    await readFile(join(orphan, 'owner.json'), 'utf8'),
    '{malformed'
  );
});

test('case dead-owner recovery permits only one independent contender and an old release cannot delete the replacement owner', async (t) => {
  const { app, store } = await fixture(t);
  const workflowId = 'lease-dead-recovery';
  const abandoned = await leaseWorker(t, store.directory, workflowId);
  assert.equal(abandoned.message, 'LEASE');
  abandoned.child.kill();
  await abandoned.exited;
  const contenders = await Promise.all([
    leaseWorker(t, store.directory, workflowId),
    leaseWorker(t, store.directory, workflowId),
  ]);
  assert.deepEqual(contenders.map((worker) => worker.message).sort(), [
    'LEASE',
    'WORKFLOW_BUSY',
  ]);
  await assert.rejects(
    acquireCaseLease(app, workflowId),
    (error) => error.code === 'WORKFLOW_BUSY'
  );
  const winner = contenders.find((worker) => worker.message === 'LEASE');
  winner.child.stdin.end('release\n');
  await winner.exited;
  const release = await acquireCaseLease(app, workflowId);
  const ownerPath = join(
    store.directory,
    '.case-workflow-locks',
    sha256(workflowId),
    'owner.json'
  );
  const replacement = {
    nonce: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  await writeFile(ownerPath, JSON.stringify(replacement));
  await release();
  assert.deepEqual(JSON.parse(await readFile(ownerPath, 'utf8')), replacement);
});

async function inventoryOriginal(app, store, at, payload) {
  const blob = await store.putBlob(JSON.stringify(payload));
  const evidenceId = `inventory-original:${blob.sha256}`;
  await store.put('evidence', {
    id: evidenceId,
    url: 'https://www.lazada.vn/inventory/export',
    role: 'inventory',
    observedAt: at,
    blob,
  });
  return {
    evidenceId,
    sourceSha256: blob.sha256,
    scope: (await caseCoverageStatus(app)).scope,
    reviewedBy: 'Exact original export reviewer',
    mapping: {
      rowsPointer: '/rows',
      urlPointer: '/url',
      skuPointer: '/sku',
      reportedTotalPointer: '/total',
      terminalPointer: '/next',
      terminalValue: null,
    },
  };
}

test('case inventory distinguishes source-confirmed removed rows from unpriced SKUs and rejects invalidated originals', async (t) => {
  const { app, store, at } = await fixture(t);
  const rows = ['100', '101', '102'].map((item) => ({
    url: `https://www.lazada.vn/products/pdp-i${item}.html`,
    sku: `${item}_VNAMZ-11`,
  }));
  const input = await inventoryOriginal(app, store, at, {
    rows,
    total: 3,
    next: null,
  });
  const manifest = await importCaseInventoryManifest(app, input);
  await store.put('offer', {
    id: 'priced',
    ...rows[0],
    currency: 'VND',
    price: 100000,
    variantConfirmed: true,
    observedAt: at,
  });
  const removed =
    '<html><head><title>Xin lỗi! Sản phẩm này không còn tồn tại</title></head><body>Xin lỗi! Sản phẩm này không còn tồn tại</body></html>';
  const capture = {
    id: 'original-removed-101',
    url: rows[1].url,
    finalUrl: rows[1].url,
    status: 'unavailable',
    fetchedAt: Date.now(),
    html: await store.putBlob(removed),
  };
  assert.ok(await recordListingUnavailable(store, capture, rows[1].url));
  let verified = await verifyCaseInventory(app, { inventoryId: manifest.id });
  assert.deepEqual(verified.missing, [rows[2]]);
  assert.deepEqual(verified.unavailable, [rows[1]]);
  assert.equal(verified.scopedPricesComplete, false);
  await store.put('offer', {
    id: 'now-priced',
    ...rows[2],
    currency: 'VND',
    price: 80000,
    variantConfirmed: true,
    observedAt: at,
  });
  verified = await verifyCaseInventory(app, { inventoryId: manifest.id });
  assert.equal(verified.scopedPricesComplete, true);
  assert.equal(verified.allMarketCoverageProven, false);
  await store.put('invalidation', {
    id: 'withdraw-original-export',
    evidenceIds: [input.evidenceId],
    invalidatedAt: new Date().toISOString(),
  });
  await assert.rejects(
    verifyCaseInventory(app, { inventoryId: manifest.id }),
    /recollection/u
  );
});

test('case inventory rejects wrong item prefixes, contradictory selected SKU URLs, duplicate rows, totals and nonterminal exports', async (t) => {
  const { app, store, at } = await fixture(t);
  const row = {
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    sku: '100_VNAMZ-11',
  };
  for (const payload of [
    {
      rows: [{ ...row, url: 'https://www.lazada.vn/products/pdp-i1000.html' }],
      total: 1,
      next: null,
    },
    { rows: [{ ...row, url: `${row.url}?skuId=12` }], total: 1, next: null },
    { rows: [row, row], total: 2, next: null },
    { rows: [row], total: 2, next: null },
    { rows: [row], total: 1, next: 'another-page' },
  ]) {
    const input = await inventoryOriginal(app, store, at, payload);
    await assert.rejects(
      importCaseInventoryManifest(app, input),
      /disagree|duplicate|total\/terminal/u
    );
  }
  assert.equal((await store.list('case-inventory')).length, 0);
});

test('case aggregate review rejects modified stored approval and is withdrawn after a new declared inventory', async (t) => {
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
          reason: 'Original accessory is outside both target categories',
          evidence: [proof],
        },
      ]
    )
  );
  assert.ok(
    (await caseCoverageStatus(app, { manualReviewId: review.id })).manualReview
  );
  await store.put('case-manual-review', {
    ...review,
    reviewedBy: 'Changed approval without matching immutable ID',
  });
  assert.equal(
    (await caseCoverageStatus(app, { manualReviewId: review.id })).manualReview,
    null
  );
  await store.put('case-manual-review', review);
  const manifestInput = await inventoryOriginal(app, store, at, {
    rows: [
      {
        url: 'https://www.lazada.vn/products/pdp-i100.html',
        sku: '100_VNAMZ-11',
      },
    ],
    total: 1,
    next: null,
  });
  await importCaseInventoryManifest(app, manifestInput);
  assert.equal(
    (await caseCoverageStatus(app, { manualReviewId: review.id })).manualReview,
    null
  );
});

test('case old-product recollection stays deferred until every initial exact-SKU price is captured', async (t) => {
  const { app, store, at } = await fixture(t);
  await pendingSku(store, at);
  const product = {
    id: 'old-product',
    url: 'https://www.lazada.vn/products/pdp-i500.html',
    title: 'Chocolate whey protein',
    category: 'whey',
    selectedVariant: [{ text: 'Chocolate' }],
    claims: [],
    evidenceIds: [],
    specificationsInvalidated: true,
    observedAt: at,
  };
  await store.put('product', product);
  await store.put('offer', {
    id: 'old-offer',
    productId: product.id,
    url: product.url,
    sku: '500_VNAMZ-51',
    price: 100000,
    currency: 'VND',
    variantConfirmed: true,
    observedAt: at,
  });
  await store.put('sku-inventory', {
    id: product.url,
    url: product.url,
    inventoryObserved: true,
    skus: [{ sku: '500_VNAMZ-51', options: [{ value: 'Chocolate' }] }],
  });
  let planned = await planCaseWorkflow(app, {
    ...simplePlan,
    recollectAfterInitialPass: true,
  });
  assert.ok(!planned.tasks.some((task) => task.stage === 'recollection'));
  await store.put('offer', {
    id: 'new-priced-offer',
    productId: 'new-product',
    url: 'https://www.lazada.vn/products/pdp-i999.html',
    sku: '999_VNAMZ-91',
    price: 80000,
    currency: 'VND',
    variantConfirmed: true,
    observedAt: at,
  });
  planned = await planCaseWorkflow(app, {
    ...simplePlan,
    recollectAfterInitialPass: true,
  });
  assert.ok(
    planned.tasks.some(
      (task) =>
        task.stage === 'recollection' && task.input.productId === product.id
    )
  );
});

test('case failed discovery counts its attempted task and retains the barrier before any exact-SKU work', async (t) => {
  const { app, store, calls, at } = await fixture(t);
  await pendingSku(store, at);
  const [crawl] = await store.list('crawl');
  await store.put('crawl', {
    ...crawl,
    scopes: [{ query: 'whey protein', terminalConfirmed: false }],
  });
  app.crawl = async () => ({ id: crawl.id, discoveryComplete: false });
  const planned = await planCaseWorkflow(app, simplePlan);
  const result = await runCaseWorkflow(app, planned.workflow.id, {
    maxTasks: 10,
  });
  assert.equal(result.executed, 1);
  assert.deepEqual(calls, []);
  assert.ok(
    result.tasks.some(
      (task) =>
        task.stage === 'discovery' &&
        task.status === 'blocked' &&
        task.attempts === 1
    )
  );
  assert.ok(!result.tasks.some((task) => task.stage === 'sku'));
});
