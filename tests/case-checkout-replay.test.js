import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch } from '../src/index.js';
import { sha256 } from '../src/util.js';
import { REQUIRED_SPEC_FIELDS } from '../src/verification.js';
import { planCaseWorkflow, runCaseWorkflow } from '../src/case-workflow.js';

const original = `<html><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="line" data-item-id="100" data-sku-id="11">
<input id="selected" type="checkbox" checked>
<input id="quantity" type="number" value="3">
<span id="unit">100.000 ₫</span><span id="subtotal">300.000 ₫</span>
<span id="stock">10</span><span id="available">Còn hàng</span>
<span id="eligible">Số lượng hợp lệ</span></div>
<span id="shipping">20.000 ₫</span><span id="total">300.000 ₫</span>
<span id="voucher-id">MERCH20</span><span id="voucher-amount">-20.000 ₫</span>
<span id="payment">Cash on delivery</span><span id="vouchers">MERCH20 applied</span>
<span>Free shaker gift; no additional food</span>
</body></html>`;

function prepared(html = original, observedAt = new Date().toISOString()) {
  return {
    html,
    metadata: {
      sourceUrl: 'https://cart.lazada.vn/cart',
      sourceSha256: sha256(html),
      evidenceId: `checkout-fixture:${sha256(html + observedAt)}`,
      observedAt,
      market: 'vn',
      currency: 'VND',
      deliveryArea: 'Nha Trang',
    },
    layout: {
      id: 'reviewed-offline-checkout-fixture',
      reviewed: true,
      reviewedBy: 'Offline fixture reviewer',
      reviewedAt: new Date().toISOString(),
      selectors: {
        destination: '#address',
        shipping: '#shipping',
        total: '#total',
        paymentMethod: '#payment',
        voucherState: '#vouchers',
      },
      lines: [
        {
          offerId: 'offer:100-11',
          sku: '100_VNAMZ-11',
          identityBinding: {
            kind: 'attributes',
            rowSelector: '#line',
            itemId: { selector: '#line', attribute: 'data-item-id' },
            skuId: { selector: '#line', attribute: 'data-sku-id' },
            selection: { selector: '#selected', attribute: 'checked' },
          },
          quantityBinding: { selector: '#quantity', attribute: 'value' },
          selectors: {
            unitPrice: '#unit',
            subtotal: '#subtotal',
            stock: '#stock',
            availability: '#available',
            eligibility: '#eligible',
          },
        },
      ],
      appliedDiscounts: [
        {
          id: 'MERCH20',
          scope: 'merchandise',
          selector: '#voucher-amount',
          identitySelector: '#voucher-id',
          amountSign: 'negative-reduction',
        },
      ],
    },
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-case-checkout-'));
  const shared = new AssociativeStore({ directory: join(directory, 'shared') });
  const store =
    options.visibility === 'public'
      ? shared
      : new AssociativeStore({
          directory: join(directory, 'account'),
          visibility: 'private',
          fallback: shared,
        });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(async () => {
    app.collector.runtime = undefined;
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const url = 'https://www.lazada.vn/products/pdp-i100.html';
  const product = {
    id: 'product:100-11',
    sku: '100_VNAMZ-11',
    url,
    title: 'Fixture chocolate whey powder 1kg',
    category: 'whey',
    observedAt,
    netMassG: 1000,
    proteinPer100g: 80,
    sugarPer100g: 2,
    fatPer100g: 3,
    saturatedFatPer100g: 1,
    kcalPer100g: 400,
    ingredients: ['whey protein isolate', 'cocoa'],
    packCount: 1,
    selectedVariant: [{ text: 'Chocolate', selected: true }],
    evidenceIds: ['factory-fixture'],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId: 'factory-fixture',
    },
  };
  const factoryHtml = await shared.putBlob(
    Buffer.from(`<html><body>${JSON.stringify(product)}</body></html>`)
  );
  await shared.put('evidence', {
    id: 'factory-fixture',
    role: 'manufacturer',
    observedAt,
    html: factoryHtml,
    sourceUrl: 'https://perfectsports.com/fixture',
  });
  product.claims = [...REQUIRED_SPEC_FIELDS, 'packCount'].map((field) => ({
    field,
    value: product[field],
    source: 'manufacturer',
    evidenceId: 'factory-fixture',
    sourceSha256: factoryHtml.sha256,
    requiresReview: false,
  }));
  await shared.put('product', product);
  await store.put('offer', {
    id: 'offer:100-11',
    productId: product.id,
    sku: product.sku,
    url,
    currency: 'VND',
    price: 110000,
    observedAt,
    variantConfirmed: true,
    available: true,
    stock: 10,
    maxQuantity: 10,
  });
  await shared.put('sku-inventory', {
    id: url,
    url,
    observedAt,
    inventoryObserved: true,
    skus: [{ sku: product.sku, url, options: ['Chocolate'] }],
  });
  await shared.put('crawl', {
    id: 'crawl:fixture',
    startedAt: observedAt,
    queries: ['whey protein'],
    categoryUrls: [],
    scopes: [{ query: 'whey protein', terminalConfirmed: true }],
    failures: [],
    uncollectedUrls: [],
  });
  const stop = await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
    origin: 'https://www.optimumnutrition.com',
    detectedAt: observedAt,
    browser: { targetId: 'original-fixture-challenge-target' },
  });
  const forbidden = () => {
    throw new Error('Offline checkout replay cannot access a page or network');
  };
  app.collector.start = forbidden;
  app.collector.runtime = {
    get page() {
      return forbidden();
    },
  };
  app.cache.get = forbidden;
  app.translateCatalog = async () => ({ reviewedComplete: true });
  const plan = await planCaseWorkflow(app, {
    queries: ['whey protein'],
    categoryUrls: [],
    quantities: [3],
    recollectAfterInitialPass: false,
    maxPriceAgeMs: options.maxPriceAgeMs || 86400000,
  });
  const task = plan.tasks.find((entry) => entry.stage === 'checkout');
  assert.ok(task, 'The exact bulk checkout task must be scheduled');
  return { app, store, shared, plan, task, stop };
}

async function execute(context, capture) {
  const result = await runCaseWorkflow(context.app, context.plan.workflow.id, {
    maxTasks: 20,
    preparedCheckouts: { [context.task.id]: capture },
  });
  assert.deepEqual(
    await context.store.get('collection-stop', 'browser-collection'),
    context.stop
  );
  assert.equal(context.app.cache.stats.downloads, 0);
  return result.tasks.find((entry) => entry.id === context.task.id);
}

test('offline bulk task imports a private original and uses shared manufacturer facts despite an unrelated active stop', async (t) => {
  const context = await fixture(t);
  const capture = prepared();
  const task = await execute(context, capture);
  assert.equal(task.status, 'succeeded');
  assert.equal(task.result.sourceMode, 'stored-original-import');
  const report = await context.app.compareBaskets();
  assert.equal((await context.app.compare({ quantity: 3 })).ranked.length, 0);
  const readiness = await context.app.caseReadiness({ quantity: 3 });
  assert.equal(readiness.qualifiedOffers, 1);
  assert.equal(readiness.unverifiedOrUnpricedOffers, 0);
  assert.equal(readiness.purchaseReady, false);
  assert.equal(report.ranked.length, 1);
  const row = report.ranked[0];
  assert.equal(row.quote.lines[0].quantity, 3);
  assert.equal(row.metrics.totalMassG, 3000);
  assert.equal(row.metrics.totalVolumeMl, null);
  assert.equal(row.metrics.totalProteinG, 2400);
  assert.equal(row.metrics.totalBeforeDelivery, 280000);
  assert.equal(row.metrics.totalAfterDelivery, 300000);
  assert.equal(row.metrics.costPerGramAfterDelivery, 100);
  assert.equal(row.metrics.costPerProteinGramAfterDelivery, 125);
  const evidence = await context.store.get(
    'evidence',
    capture.metadata.evidenceId
  );
  assert.equal(evidence.visibility, 'private');
  assert.equal(await context.shared.get('evidence', evidence.id), undefined);
  assert.deepEqual(
    await context.store.blob(evidence.html.sha256),
    Buffer.from(original)
  );
});

test('an ordinary missing offline translation does not strand another valid checkout task behind the global stop', async (t) => {
  const context = await fixture(t);
  context.app.translateCatalog = async () => {
    throw new Error('Missing cached translation fixture');
  };
  const task = await execute(context, prepared());
  assert.equal(task.status, 'succeeded');
  const failed = (await context.store.list('case-task')).find(
    (entry) => entry.stage === 'translation'
  );
  assert.equal(failed.status, 'blocked');
  assert.equal(failed.reason, 'Missing cached translation fixture');
});

test('offline bulk task refuses live capture without touching the prepared browser page', async (t) => {
  const context = await fixture(t);
  const task = await execute(context, { layout: prepared().layout });
  assert.equal(task.status, 'blocked');
  assert.match(
    task.reason,
    /Live prepared checkout capture requires allowNetwork/u
  );
  assert.equal((await context.store.list('basket-quote')).length, 0);
});

test('network-enabled workflow remains stopped before any saved or live checkout task', async (t) => {
  const context = await fixture(t);
  await assert.rejects(
    runCaseWorkflow(context.app, context.plan.workflow.id, {
      allowNetwork: true,
      preparedCheckouts: { [context.task.id]: prepared() },
    }),
    { code: 'COLLECTION_STOPPED' }
  );
  assert.deepEqual(
    await context.store.get('collection-stop', 'browser-collection'),
    context.stop
  );
  assert.equal((await context.store.list('basket-quote')).length, 0);
});

for (const [name, mutate] of [
  [
    'stale original',
    (input) => {
      input.metadata.observedAt = new Date(
        Date.now() - 172800000
      ).toISOString();
    },
  ],
  [
    'future original',
    (input) => {
      input.metadata.observedAt = new Date(Date.now() + 30000).toISOString();
    },
  ],
  [
    'invalid original date',
    (input) => {
      input.metadata.observedAt = 'not-a-date';
    },
  ],
  [
    'wrong case destination',
    (input) => {
      input.metadata.deliveryArea = 'Hồ Chí Minh';
    },
  ],
  [
    'wrong original digest',
    (input) => {
      input.metadata.sourceSha256 = '0'.repeat(64);
    },
  ],
  [
    'another SKU row',
    (input) => {
      input.html = input.html.replace('data-sku-id="11"', 'data-sku-id="12"');
      input.metadata.sourceSha256 = sha256(input.html);
    },
  ],
  [
    'another order quantity',
    (input) => {
      input.html = input.html
        .replace('value="3"', 'value="2"')
        .replace('300.000 ₫', '200.000 ₫')
        .replace('id="total">300.000', 'id="total">200.000');
      input.metadata.sourceSha256 = sha256(input.html);
    },
  ],
  [
    'unknown shipping',
    (input) => {
      input.html = input.html.replace(
        'id="shipping">20.000 ₫',
        'id="shipping">Pending quote'
      );
      input.metadata.sourceSha256 = sha256(input.html);
    },
  ],
  [
    'challenged original',
    (input) => {
      input.html = input.html.replace(
        '<body>',
        '<body><div data-captcha>Verify to continue</div>'
      );
      input.metadata.sourceSha256 = sha256(input.html);
    },
  ],
]) {
  test(`offline bulk task cannot succeed with ${name}`, async (t) => {
    const context = await fixture(t);
    const capture = prepared();
    mutate(capture);
    const task = await execute(context, capture);
    assert.equal(task.status, 'blocked');
    assert.equal(
      (await context.app.compareBaskets()).ranked.some((row) =>
        row.quote.lines.some(
          (line) => line.sku === '100_VNAMZ-11' && line.quantity === 3
        )
      ),
      false
    );
  });
}

test('offline imported original is not promoted into a public store', async (t) => {
  const context = await fixture(t, { visibility: 'public' });
  const task = await execute(context, prepared());
  assert.equal(task.status, 'blocked');
  assert.match(task.reason, /private store/u);
  assert.equal((await context.store.list('checkout-adapter')).length, 0);
  assert.equal((await context.store.list('basket-quote')).length, 0);
});

test('workflow quote freshness honors its explicit age bound and distinguishes the comparison default', async (t) => {
  const context = await fixture(t, { maxPriceAgeMs: 259200000 });
  const capture = prepared(
    original,
    new Date(Date.now() - 172800000).toISOString()
  );
  const task = await execute(context, capture);
  assert.equal(task.status, 'succeeded');
  const rows = await context.app.compareBaskets({ maxPriceAgeMs: 259200000 });
  assert.equal(rows.ranked.length, 1);
  assert.equal((await context.app.compareBaskets()).ranked.length, 0);
});

test('an explicitly observed zero delivery fee is retained without multiplying a fixed voucher or adding shaker grams', async (t) => {
  const context = await fixture(t);
  const capture = prepared(
    original
      .replace('id="shipping">20.000 ₫', 'id="shipping">0 ₫')
      .replace('id="total">300.000 ₫', 'id="total">280.000 ₫')
  );
  const task = await execute(context, capture);
  assert.equal(task.status, 'succeeded');
  const row = (await context.app.compareBaskets()).ranked[0];
  assert.equal(row.quote.shipping, 0);
  assert.equal(row.metrics.totalAfterDelivery, 280000);
  assert.equal(row.metrics.totalBeforeDelivery, 280000);
  assert.equal(row.metrics.totalMassG, 3000);
  assert.equal(row.metrics.totalVolumeMl, null);
});

test('invalidated saved original cannot be rewritten or accepted by its case task', async (t) => {
  const context = await fixture(t);
  const capture = prepared();
  const evidence = await context.store.put('evidence', {
    id: capture.metadata.evidenceId,
    sourceUrl: capture.metadata.sourceUrl,
    observedAt: capture.metadata.observedAt,
    html: await context.store.putBlob(Buffer.from(capture.html)),
    invalidated: true,
  });
  const task = await execute(context, capture);
  assert.equal(task.status, 'blocked');
  assert.match(task.reason, /invalidated observation/u);
  assert.deepEqual(await context.store.get('evidence', evidence.id), evidence);
  assert.equal((await context.store.list('basket-quote')).length, 0);
});

for (const [name, option, category] of [
  ['paid shaker', 'Chocolate + Shaker', 'whey'],
  ['other flavour', 'Vanilla', 'whey'],
  ['soy isolate', 'Chocolate', 'protein-powder'],
]) {
  test(`a case cannot import a prepared checkout for a newly excluded ${name}`, async (t) => {
    const context = await fixture(t);
    const product = await context.store.get('product', 'product:100-11');
    await context.store.put('product', {
      ...product,
      category,
      ingredients:
        category === 'whey' ? product.ingredients : ['soy protein isolate'],
      selectedVariant: [{ text: option, selected: true }],
    });
    const task = await execute(context, prepared());
    assert.equal(task.status, 'superseded');
    assert.equal((await context.store.list('basket-quote')).length, 0);
  });
}
