import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { validateOffer } from '../src/products.js';
import { calculateOffer } from '../src/compare.js';
import { executeOperation } from '../src/operations.js';
import { startServer } from '../src/server.js';
import { createTelegramBot } from '../src/telegram.js';

const execute = promisify(execFile);
const product = {
  id: 'paid-chocolate',
  title: 'Factory chocolate whey 1 kg',
  brand: 'Factory',
  market: 'VN',
  category: 'whey',
  url: 'https://www.lazada.vn/products/pdp-i101.html?skuId=123',
  netMassG: 1000,
  packCount: 2,
  proteinPer100g: 80,
  ingredients: ['whey protein isolate', 'cocoa'],
};
const offer = {
  id: 'selected-offer',
  productId: product.id,
  url: product.url,
  currency: 'VND',
  price: 1790000,
  sku: '123',
  available: true,
  variantConfirmed: true,
  observedAt: '2026-10-11T06:00:00Z',
};
const potential = {
  id: 'advertised-bonus',
  kind: 'bonus-food',
  originalText: '2 túi tặng1 túi — exact gift identity not reviewed',
  evidenceIds: ['original-advertising-source'],
  eligibility: { confirmed: true, stockUnits: 0 },
  review: {
    sourceSha256: 'unconfirmed original digest',
    identityMatched: false,
  },
};
const paid = {
  id: 'paid-bags',
  kind: 'paid-food',
  productId: product.id,
  unitsPerSellingUnit: 2,
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-food-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  await app.importRecords({ products: [product], offers: [offer] });
  return { app, store, directory };
}

test('offer validation preserves incomplete evidence and deduplicates exact records without property-order conflicts', () => {
  const components = [
    paid,
    potential,
    {
      kind: 'paid-food',
      unitsPerSellingUnit: 2,
      productId: product.id,
      id: paid.id,
    },
    { id: 'shaker', kind: 'non-food', originalText: 'Shaker 700 ml' },
  ];
  const result = validateOffer({ ...offer, foodComponents: components });
  assert.equal(result.foodComponents.length, 3);
  assert.deepEqual(result.foodComponents[1], potential);
  const metrics = calculateOffer(product, result, {
    requireManufacturer: false,
  }).metrics;
  assert.equal(metrics.totalMassG, 2000);
  assert.equal(metrics.totalProteinG, 1600);
  assert.equal(metrics.foodComponents.confirmedBonuses.length, 0);
  assert.equal(metrics.foodComponents.potentialBonuses.length, 1);
  assert.equal(metrics.foodComponents.nonFoodAccessories.length, 1);
});

test('offer validation rejects malformed roots, identifiers, kinds and conflicting component IDs', () => {
  const invalid = [
    null,
    {},
    'gift',
    Array.from({ length: 101 }, () => paid),
    Array(1),
    [null],
    [[]],
    [{ kind: 'bonus-food' }],
    [{ id: ' ', kind: 'bonus-food' }],
    [{ id: 'gift\n1', kind: 'bonus-food' }],
    [{ id: ' gift', kind: 'bonus-food' }],
    [{ id: 'gift', kind: 'food' }],
    [paid, { ...paid, unitsPerSellingUnit: 3 }],
  ];
  for (const foodComponents of invalid) {
    assert.throws(
      () => validateOffer({ ...offer, foodComponents }),
      /foodComponents|food component/u
    );
  }
});

test('offer validation rejects invalid count, quantity, proof unit and nested object structures before JSON cloning', () => {
  const invalid = [
    { ...paid, unitsPerSellingUnit: 1.5 },
    { ...paid, unitsPerSellingUnit: Number.MAX_SAFE_INTEGER + 1 },
    { ...paid, productId: 123 },
    { ...potential, product: { netMassG: NaN } },
    { ...potential, product: { netMassG: Infinity } },
    { ...potential, product: { netMassG: -1 } },
    { ...potential, product: { packCount: 1.5 } },
    { ...potential, product: { ingredients: 'whey' } },
    { ...potential, product: { claims: [null] } },
    { ...potential, identity: [] },
    { ...potential, sourceIdentity: { innerPackCount: 0 } },
    { ...potential, review: 'reviewed' },
    { ...potential, review: { identityMatched: 'true' } },
    { ...potential, evidenceIds: 'source' },
    { ...potential, evidenceIds: [''] },
    { ...potential, evidenceIds: Array(1) },
    { ...potential, eligibility: { orderQuantity: 1.5 } },
    { ...potential, eligibility: { confirmed: 'true' } },
    { ...potential, eligibility: { sku: -1 } },
    { ...potential, facts: { netMassG: { value: 1, unit: 'ml' } } },
    {
      ...potential,
      facts: { proteinPerPackageG: { value: '1', unit: 'g/package' } },
    },
    {
      ...potential,
      eligibility: { claims: { units: { value: 1, unit: 'g' } } },
    },
    {
      ...potential,
      eligibility: { claims: { units: { value: 1.5, unit: 'count' } } },
    },
  ];
  for (const component of invalid) {
    assert.throws(
      () => validateOffer({ ...offer, foodComponents: [component] }),
      /foodComponents/u
    );
  }
  const circular = { ...potential };
  circular.original = circular;
  assert.throws(
    () => validateOffer({ ...offer, foodComponents: [circular] }),
    /circular/u
  );
});

test('partial records and numeric selected SKU identifiers remain safely potential', () => {
  const components = [
    { id: 'gift', kind: 'bonus-food' },
    {
      ...potential,
      id: 'second',
      product: {},
      identity: {},
      sourceIdentity: {},
      facts: {},
      eligibility: { sku: 123, stockUnits: 0, available: false, claims: {} },
    },
  ];
  assert.deepEqual(
    validateOffer({ ...offer, foodComponents: components }).foodComponents,
    components
  );
});

test('imports and quotes preserve source-backed component records, history and associative projections across restart', async (t) => {
  const { app, store, directory } = await fixture(t);
  await app.quote(offer.id, { foodComponents: [paid, potential] });
  const restarted = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  const record = await restarted.store.get('offer', offer.id);
  assert.deepEqual(record.foodComponents, [paid, potential]);
  assert.ok(
    (await store.list('offer-history')).some(
      (entry) =>
        entry.foodComponents?.[1]?.originalText === potential.originalText
    )
  );
  assert.match(
    await readFile(store.recordPath('offer', offer.id), 'utf8'),
    /foodComponents/u
  );
  const graph = await restarted.store.graph('offer', offer.id);
  assert.ok(graph.names.has(`string:${potential.originalText}`));
  assert.ok(
    (
      await readFile(
        store.recordPath('offer', offer.id).replace('.lino', '.links')
      )
    ).length > 0
  );
  const imported = validateOffer({
    ...offer,
    id: 'imported-components',
    foodComponents: [potential],
  });
  await restarted.importRecords({ offers: [imported] });
  assert.deepEqual((await store.get('offer', imported.id)).foodComponents, [
    potential,
  ]);
});

test('invalid quotes and import batches leave existing offers, history and product records unchanged', async (t) => {
  const { app, store } = await fixture(t);
  const before = await store.get('offer', offer.id);
  const history = await store.list('offer-history');
  await assert.rejects(
    app.quote(offer.id, {
      foodComponents: [paid, { ...paid, unitsPerSellingUnit: 3 }],
    }),
    /Conflicting food component ID/u
  );
  await assert.rejects(
    app.importRecords({
      products: [{ ...product, id: 'must-not-save' }],
      offers: [{ ...offer, foodComponents: { bad: true } }],
    }),
    /foodComponents/u
  );
  assert.deepEqual(await store.get('offer', offer.id), before);
  assert.deepEqual(await store.list('offer-history'), history);
  assert.equal(await store.get('product', 'must-not-save'), undefined);
});

function quoteOperation(foodComponents) {
  return {
    operation: 'quote',
    input: { offerId: offer.id, quote: { foodComponents } },
  };
}

function telegramUpdate(text) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      from: { id: 777, is_bot: false, first_name: 'Tester' },
      chat: { id: 777, type: 'private' },
      text,
      entities: [
        { offset: 0, length: '/operation'.length, type: 'bot_command' },
      ],
    },
  };
}

test('structured operation, spawned CLI, HTTP and Telegram quotes share component validation and persistence', async (t) => {
  const { app, store, directory } = await fixture(t);
  const components = [paid, potential];
  assert.deepEqual(
    (await executeOperation(app, quoteOperation(components))).foodComponents,
    components
  );
  const cli = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      'quote',
      offer.id,
      JSON.stringify({ foodComponents: components }),
      '--data-dir',
      directory,
      '--offline',
      '--no-archive',
    ],
    { cwd: new URL('../', import.meta.url).pathname }
  );
  assert.deepEqual(JSON.parse(cli.stdout).foodComponents, components);
  const server = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/operations`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(quoteOperation(components)),
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).foodComponents, components);
  const replies = [];
  const bot = createTelegramBot({
    application: app,
    token: '123:FIXTURE',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: {
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body);
        replies.push(body.text);
        return new globalThis.Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: replies.length,
              date: 0,
              chat: { id: 777, type: 'private' },
              text: body.text,
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    },
  });
  await bot.handleUpdate(
    telegramUpdate(`/operation ${JSON.stringify(quoteOperation(components))}`)
  );
  assert.ok(replies.some((reply) => reply.includes('foodComponents')));
  assert.deepEqual(
    (await store.get('offer', offer.id)).foodComponents,
    components
  );
  const invalid = quoteOperation([{ ...paid, unitsPerSellingUnit: 1.5 }]);
  await bot.handleUpdate({
    ...telegramUpdate(`/operation ${JSON.stringify(invalid)}`),
    update_id: 2,
  });
  assert.ok(replies.at(-1).includes('positive integer'));
  assert.deepEqual(
    (await store.get('offer', offer.id)).foodComponents,
    components
  );
});
