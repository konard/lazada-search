import test from 'node:test';
import assert from 'node:assert/strict';
import { AssociativeStore, LazadaSearch } from '../src/index.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';
import { clone } from '../src/util.js';
import {
  scenarioFixture,
  scenarioPlan,
  capturedScenario,
} from './helpers/checkout-scenarios.js';

async function prepared(t) {
  const fixture = await scenarioFixture(t);
  const report = await fixture.app.planCheckoutScenarios(scenarioPlan());
  const batch = {
    planId: report.plan.id,
    captures: [
      { scenarioId: capturedScenario(report).id, mapping: fixture.mapping },
    ],
  };
  return { ...fixture, report, batch };
}

test('bounded durable quantity/voucher/payment sweep resumes exact source after restart without re-extraction or source downloads', async (t) => {
  const { app, store, report, batch } = await prepared(t);
  assert.equal(report.coverage.planned, 8);
  assert.deepEqual(report.counts, { pending: 8, failed: 0, validated: 0 });
  const stop = {
    id: COLLECTION_STOP_ID,
    active: true,
    reason: 'fixture CAPTCHA',
  };
  await store.put('collection-stop', stop);
  const first = await app.runCheckoutScenarios(batch);
  assert.deepEqual(first.counts, { pending: 7, failed: 0, validated: 1 });
  assert.equal(first.results[0].reused, false);
  assert.equal(first.downloads, 0);
  assert.equal(first.payments, 0);
  assert.equal(first.coverage.allMarketScenariosCollected, false);
  assert.equal(first.coverage.checkoutLayoutLiveVerified, false);
  assert.equal(first.coverage.purchaseReady, false);
  const restarted = new LazadaSearch({
    store: new AssociativeStore({ directory: store.directory }),
    offline: true,
    ocr: false,
  });
  t.after(() => restarted.close());
  const originalAttempts = await store.list('checkout-scenario-attempt');
  const originalRows = await store.list('checkout-scenario');
  const reused = await restarted.runCheckoutScenarios(batch);
  assert.equal(reused.results[0].reused, true);
  assert.deepEqual(
    await store.list('checkout-scenario-attempt'),
    originalAttempts
  );
  assert.deepEqual(await store.list('checkout-scenario'), originalRows);
  assert.deepEqual(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    stop
  );
  const compared = await restarted.compareBaskets({
    requireManufacturer: false,
    allowStale: true,
  });
  assert.equal(compared.ranked[0].metrics.totalAfterDelivery, 285000);
  assert.equal(compared.ranked[0].metrics.costPerGramAfterDelivery, 95);
  assert.equal((await store.get('offer', 'offer-a')).price, 110000);
  assert.deepEqual(
    (await restarted.planCheckoutScenarios(scenarioPlan())).counts,
    first.counts
  );
});

test('expected identity cannot replace observed SKU, quantities, voucher IDs or payment conditions and failures are durable/retryable', async (t) => {
  const { app, store, report, batch } = await prepared(t);
  const wrong = report.scenarios.find(
    (row) => row.definition.lines[0].quantity === 1
  );
  const mismatch = await app.runCheckoutScenarios({
    ...batch,
    captures: [{ ...batch.captures[0], scenarioId: wrong.id }],
  });
  assert.equal(mismatch.results[0].status, 'failed');
  assert.equal((await store.list('basket-quote')).length, 0);
  assert.equal(
    (await store.get('checkout-scenario', wrong.id)).status,
    'failed'
  );
  for (const change of [
    (mapping) => {
      mapping.lines[0].sku = '100_VNAMZ-12';
    },
    (mapping) => {
      mapping.checkoutConditions.paymentMethod.text = 'Bank transfer';
    },
    (mapping) => {
      mapping.appliedDiscounts[0].id = 'invented-voucher';
    },
    (mapping) => {
      delete mapping.appliedDiscounts[0].identitySelector;
    },
    (mapping) => {
      delete mapping.checkoutConditions;
    },
  ]) {
    const changed = clone(batch);
    change(changed.captures[0].mapping);
    assert.equal(
      (await app.runCheckoutScenarios(changed)).results[0].status,
      'failed'
    );
    assert.equal((await store.list('basket-quote')).length, 0);
  }
  assert.equal(
    (await app.runCheckoutScenarios(batch)).results[0].status,
    'validated'
  );
  assert.equal((await store.list('checkout-scenario-attempt')).length, 7);
});

test('changed original bytes, separate invalidation and corrupt public output cannot reuse source proof', async (t) => {
  const { app, store, batch } = await prepared(t);
  const first = await app.runCheckoutScenarios(batch);
  const quoteId = first.results[0].quoteId;
  const state = await store.get('checkout-scenario', first.results[0].id);
  await store.put('checkout-scenario', {
    ...state,
    extractionFingerprint: 'obsolete-producer',
  });
  assert.equal(
    (await app.checkoutScenarioStatus({ planId: batch.planId })).counts.pending,
    8
  );
  assert.equal(
    (await app.runCheckoutScenarios(batch)).results[0].reused,
    false
  );
  const quote = await store.get('basket-quote', quoteId);
  await store.put('basket-quote', { ...quote, total: 1 });
  assert.equal(
    (await app.checkoutScenarioStatus({ planId: batch.planId })).counts.pending,
    8
  );
  assert.equal(
    (await app.runCheckoutScenarios(batch)).results[0].reused,
    false
  );
  assert.equal((await store.get('basket-quote', quoteId)).total, 285000);
  const evidence = await store.get('evidence', 'checkout-fixture');
  await store.put('evidence', {
    ...evidence,
    html: await store.putBlob(Buffer.from('changed original')),
  });
  await assert.rejects(
    app.runCheckoutScenarios(batch),
    /Public scenario preflight/u
  );
  assert.equal(
    (await app.checkoutScenarioStatus({ planId: batch.planId })).counts
      .validated,
    0
  );
  await store.put('evidence', evidence);
  await store.put('invalidation', {
    id: 'separate-original',
    evidenceIds: [evidence.id],
    invalidatedAt: evidence.observedAt,
  });
  assert.equal(
    (await app.runCheckoutScenarios(batch)).results[0].status,
    'failed'
  );
  assert.equal(
    (await app.checkoutScenarioStatus({ planId: batch.planId })).counts
      .validated,
    0
  );
});

test('older original observations cannot overwrite newer source scenarios or current quoted totals', async (t) => {
  const { app, store, batch, mapping } = await prepared(t);
  const first = await app.runCheckoutScenarios(batch);
  const original = await store.get('evidence', mapping.evidenceId);
  const older = clone(batch);
  older.captures[0].mapping.observedAt = '2026-10-09T05:00:00.000Z';
  older.captures[0].mapping.evidenceId = 'older-source';
  await store.put('evidence', {
    ...original,
    id: 'older-source',
    observedAt: older.captures[0].mapping.observedAt,
  });
  const result = await app.runCheckoutScenarios(older);
  assert.equal(result.results[0].status, 'failed');
  assert.match(result.results[0].reason, /Older/u);
  assert.deepEqual(
    await store.get('checkout-scenario', first.results[0].id),
    Object.fromEntries(
      Object.entries(first.results[0]).filter(([key]) => key !== 'reused')
    )
  );
});

test('oversized sweeps, repeated normalized choices and unknown offers fail before plan mutations', async (t) => {
  const { app, store } = await scenarioFixture(t);
  for (const change of [
    (plan) => {
      plan.lines[0].quantities = Array.from({ length: 100 }, (_, i) => i + 1);
      plan.paymentMethods = Array.from({ length: 10 }, (_, i) => `Method${i}`);
    },
    (plan) => {
      plan.paymentMethods = ['Cash on delivery', ' Cash on delivery '];
    },
    (plan) => {
      plan.lines[0].offerId = 'unknown';
    },
  ]) {
    const plan = scenarioPlan();
    change(plan);
    await assert.rejects(app.planCheckoutScenarios(plan));
    assert.equal((await store.list('checkout-plan')).length, 0);
    assert.equal((await store.list('checkout-scenario')).length, 0);
  }
});

test('private checkout evidence and URL credentials are rejected before public receipts, and persistence failures propagate', async (t) => {
  const { app, store, batch, mapping } = await prepared(t);
  const before = await store.list('checkout-scenario');
  const evidence = await store.get('evidence', mapping.evidenceId);
  await store.put('evidence', { ...evidence, visibility: 'private' });
  await assert.rejects(app.runCheckoutScenarios(batch), /Private checkout/u);
  assert.deepEqual(await store.list('checkout-scenario'), before);
  assert.equal((await store.list('checkout-scenario-attempt')).length, 0);
  await store.put('evidence', evidence);
  const credentials = clone(batch);
  credentials.captures[0].mapping.sourceUrl =
    'https://secret:password@cart.lazada.vn/cart';
  await assert.rejects(app.runCheckoutScenarios(credentials), /credentials/u);
  assert.equal((await store.list('checkout-scenario-attempt')).length, 0);
  const write = store.put.bind(store);
  store.put = (kind, record) => {
    if (kind === 'basket-quote') {
      throw new Error('fixture durable write failed');
    }
    return write(kind, record);
  };
  await assert.rejects(
    app.runCheckoutScenarios(batch),
    /durable write failed/u
  );
  assert.equal((await store.list('checkout-scenario-attempt')).length, 0);
  assert.deepEqual(await store.list('checkout-scenario'), before);
});

test('overlapping prepared batches atomically preserve the newer validated scenario observation', async (t) => {
  const { app, store, batch, mapping } = await prepared(t);
  const newer = clone(batch);
  newer.captures[0].mapping.observedAt = '2026-10-10T05:00:01.000Z';
  newer.captures[0].mapping.evidenceId = 'newer-original';
  const evidence = await store.get('evidence', mapping.evidenceId);
  await store.put('evidence', {
    ...evidence,
    id: 'newer-original',
    observedAt: newer.captures[0].mapping.observedAt,
  });
  let release, entered;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const write = store.putLatest.bind(store);
  store.putLatest = async (kind, record) => {
    if (
      kind === 'checkout-scenario' &&
      record.status === 'validated' &&
      record.observedAt === mapping.observedAt
    ) {
      entered();
      await blocked;
    }
    return write(kind, record);
  };
  const oldRun = app.runCheckoutScenarios(batch);
  await waiting;
  const recent = await app.runCheckoutScenarios(newer);
  release();
  await oldRun;
  const saved = await store.get('checkout-scenario', recent.results[0].id);
  assert.equal(saved.observedAt, newer.captures[0].mapping.observedAt);
  assert.equal(saved.evidenceId, 'newer-original');
  assert.equal(saved.quoteId, recent.results[0].quoteId);
});

test('unknown or mismatched public original rejects before all writes and ordinary public source failures retain references only', async (t) => {
  const { app, store, batch } = await prepared(t);
  const before = await store.list('checkout-scenario');
  for (const mutate of [
    (mapping) => {
      mapping.evidenceId = 'unknown-private-origin';
    },
    (mapping) => {
      mapping.sourceSha256 = 'a'.repeat(64);
    },
    (mapping) => {
      mapping.sourceUrl = 'https://cart.lazada.vn/checkout';
    },
    (mapping) => {
      mapping.observedAt = '2026-10-10T06:00:00.000Z';
    },
  ]) {
    const changed = clone(batch);
    changed.captures[0].mapping.destination = 'secret-private-contact';
    mutate(changed.captures[0].mapping);
    await assert.rejects(
      app.runCheckoutScenarios(changed),
      /Public scenario preflight/u
    );
    assert.deepEqual(await store.list('checkout-scenario'), before);
    assert.equal((await store.list('checkout-scenario-attempt')).length, 0);
    assert.equal((await store.list('basket-quote')).length, 0);
  }
  const knownOriginal = clone(batch);
  knownOriginal.captures[0].mapping.destination = 'secret-private-contact';
  const failed = await app.runCheckoutScenarios(knownOriginal);
  assert.equal(failed.results[0].status, 'failed');
  assert.equal(failed.results[0].sourceMapping, undefined);
  const saved = await store.get(
    'checkout-scenario',
    batch.captures[0].scenarioId
  );
  const attempts = await store.list('checkout-scenario-attempt');
  assert.equal(saved.sourceMapping, undefined);
  assert.equal(attempts[0].sourceMapping, undefined);
  assert.equal(attempts[0].evidenceId, batch.captures[0].mapping.evidenceId);
  assert.ok(attempts[0].mappingSha256);
  assert.doesNotMatch(
    JSON.stringify([saved, attempts]),
    /secret-private-contact/u
  );
  assert.equal(
    (await app.runCheckoutScenarios(batch)).results[0].status,
    'validated'
  );
});
