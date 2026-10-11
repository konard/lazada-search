import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  CachedTranslator,
  DomainScheduler,
  LazadaSearch,
  planCatalogTranslation,
  COLLECTION_STOP_ID,
} from '../src/index.js';
import { applyComparisonTranslations } from '../src/translation-presentation.js';
import { sha256 } from '../src/util.js';

const source = 'Sữa 🍫. '.repeat(4);
const english = 'Milk 🍫. '.repeat(4);

async function approve(translator, record) {
  return translator.review(record.id, {
    sourceSha256: record.sourceSha256,
    translatedSha256: record.translatedSha256,
    reviewer: 'human-chunk-fixture',
    decision: 'approved',
  });
}

async function setup(
  t,
  { description = source, maxChunkBytes = 12, translate } = {}
) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-chunk-presentation-'));
  const store = new AssociativeStore({ directory });
  const calls = [];
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: {
      id: 'human-chunk-fixture',
      version: '1',
      translate: ({ originalText }) => {
        calls.push(originalText);
        return translate
          ? translate(originalText)
          : originalText.replaceAll('Sữa', 'Milk');
      },
    },
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const product = {
    id: 'ice',
    title: 'Chocolate ice cream',
    description,
    category: 'chocolate-ice-cream',
    netMassG: 40,
  };
  const offer = {
    id: 'offer',
    productId: product.id,
    price: 8000,
    currency: 'VND',
  };
  const row = { product, offer, metrics: { costPerGramBeforeDelivery: 200 } };
  const report = {
    comparisons: [row],
    ranked: [row],
    observedPrices: [row],
    excluded: [],
    unsortable: [],
    bestByCategory: { whey: null, 'chocolate-ice-cream': row },
  };
  await store.put('product', product);
  const plan = await planCatalogTranslation(app, {
    includeSources: false,
    maxChunkBytes,
  });
  const pieces = plan.items.filter((item) => item.path[0] === 'description');
  await store.putMany('translation-catalog-source', plan.items);
  for (const piece of pieces) {
    await approve(app.translator, await app.translate(piece.originalText));
  }
  return { app, store, calls, product, offer, report, pieces, maxChunkBytes };
}

test('reviewed Unicode chunks reassemble into exact record fields offline while stopped, preserving all source facts and metrics', async (t) => {
  const ctx = await setup(t);
  const original = globalThis.structuredClone(ctx.report);
  const before = ctx.calls.length;
  await ctx.store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
  });
  const offline = new CachedTranslator({
    store: ctx.store,
    providerId: 'human-chunk-fixture',
    providerVersion: '1',
    offline: true,
  });
  const shown = await applyComparisonTranslations(ctx.report, offline);
  const field = shown.comparisons[0].product.presentation.description;
  assert.equal(field.text, english);
  assert.equal(field.status, 'reviewed');
  assert.equal(field.originalText, source);
  assert.equal(field.sourceSha256, sha256(source));
  assert.equal(field.translatedSha256, sha256(english));
  assert.equal(field.chunkProof.chunks.length, 4);
  assert.deepEqual(
    field.chunkProof.chunks.map((piece) => piece.offset),
    [0, 8, 16, 24]
  );
  assert.equal(field.chunkProof.assemblyQuality.passed, true);
  assert.equal(field.chunkProof.reviewBasis, 'reviewed-chunks');
  assert.equal(
    shown.bestByCategory['chocolate-ice-cream'].product.presentation.description
      .text,
    english
  );
  assert.deepEqual(
    shown.comparisons[0].metrics,
    original.comparisons[0].metrics
  );
  assert.deepEqual(ctx.report, original);
  assert.equal(ctx.calls.length, before);
  assert.equal(
    (await ctx.store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

const corruptions = [
  ['offset overlap', (piece) => ({ ...piece, offset: 1 })],
  ['wrong chunk order', (piece) => ({ ...piece, chunkIndex: 2 })],
  ['source digest', (piece) => ({ ...piece, sourceSha256: 'a'.repeat(64) })],
  ['chunk count', (piece) => ({ ...piece, chunkCount: 99 })],
  [
    'partition digest',
    (piece) => ({ ...piece, chunkPartitionSha256: 'a'.repeat(64) }),
  ],
  [
    'record identity',
    (piece) => ({ ...piece, sourceRecordId: 'other-product' }),
  ],
  ['field path', (piece) => ({ ...piece, path: ['title'] })],
  [
    'malformed protected entities',
    (piece) => ({ ...piece, protectedEntities: 'not-an-array' }),
  ],
];
for (const [name, corrupt] of corruptions) {
  test(`corrupt ${name} keeps the source text and rejects incomplete English assembly`, async (t) => {
    const ctx = await setup(t);
    await ctx.store.put(
      'translation-catalog-source',
      corrupt(ctx.pieces.find((piece) => piece.chunkIndex === 0))
    );
    const shown = await applyComparisonTranslations(
      ctx.report,
      ctx.app.translator
    );
    assert.equal(
      shown.comparisons[0].product.presentation.description.text,
      source
    );
    assert.notEqual(
      shown.comparisons[0].product.presentation.description.status,
      'reviewed'
    );
  });
}

test('duplicate chunk records, unreviewed or rejected English and altered output cannot assemble', async (t) => {
  const ctx = await setup(t);
  const zero = ctx.pieces.find((piece) => piece.chunkIndex === 0);
  const cached = await ctx.app.translator.cached(zero.originalText);
  for (const record of [
    { ...cached, review: { status: 'pending' } },
    { ...cached, review: { ...cached.review, status: 'rejected' } },
    { ...cached, translatedText: `${cached.translatedText}400 g` },
  ]) {
    await ctx.store.put('translation', record);
    const shown = await applyComparisonTranslations(
      ctx.report,
      ctx.app.translator,
      { requireReviewed: false }
    );
    assert.equal(
      shown.comparisons[0].product.presentation.description.text,
      source
    );
  }
  await ctx.store.put('translation', cached);
  await ctx.store.put('translation-catalog-source', {
    ...zero,
    id: 'duplicate-piece',
  });
  assert.equal(
    (await applyComparisonTranslations(ctx.report, ctx.app.translator))
      .comparisons[0].product.presentation.description.text,
    source
  );
});

test('changed whole source, provider version and language pair cannot reuse a reviewed assembly', async (t) => {
  const ctx = await setup(t);
  const changed = {
    comparisons: [
      {
        ...ctx.report.comparisons[0],
        product: { ...ctx.product, description: `${source}Changed` },
      },
    ],
  };
  assert.equal(
    (await applyComparisonTranslations(changed, ctx.app.translator))
      .comparisons[0].product.presentation.description.text,
    `${source}Changed`
  );
  const different = new CachedTranslator({
    store: ctx.store,
    providerId: 'human-chunk-fixture',
    providerVersion: '2',
    offline: true,
  });
  assert.equal(
    (await applyComparisonTranslations(ctx.report, different)).comparisons[0]
      .product.presentation.description.text,
    source
  );
  assert.equal(
    (
      await applyComparisonTranslations(ctx.report, ctx.app.translator, {
        targetLanguage: 'fr',
      })
    ).comparisons[0].product.presentation.description.text,
    source
  );
});

test('full-field quality rejects a number split corrupted by independently reviewed chunk text', async (t) => {
  const ctx = await setup(t, {
    description: 'Kem 40 g',
    maxChunkBytes: 5,
    translate: (text) => (text === 'Kem 4' ? 'Ice cream 4 ' : text),
  });
  assert.ok((await ctx.app.translator.cached('Kem 4')).qualityChecks.passed);
  const shown = await applyComparisonTranslations(
    ctx.report,
    ctx.app.translator
  );
  assert.equal(
    shown.comparisons[0].product.presentation.description.text,
    'Kem 40 g'
  );
  assert.notEqual(
    shown.comparisons[0].product.presentation.description.status,
    'reviewed'
  );
});

test('source partition identities preserve old boundaries, and complete legacy source groups remain readable', async (t) => {
  const ctx = await setup(t);
  const next = await planCatalogTranslation(ctx.app, {
    includeSources: false,
    maxChunkBytes: 24,
  });
  const newer = next.items.filter((item) => item.path[0] === 'description');
  assert.ok(
    newer.every((item) => !ctx.pieces.some((prior) => prior.id === item.id))
  );
  await ctx.store.putMany('translation-catalog-source', newer);
  assert.equal(
    (await applyComparisonTranslations(ctx.report, ctx.app.translator))
      .comparisons[0].product.presentation.description.text,
    english
  );
  const legacyStore = new AssociativeStore({
    directory: join(ctx.store.directory, 'legacy'),
  });
  for (const piece of ctx.pieces) {
    const legacy = { ...piece };
    delete legacy.chunkPartitionSha256;
    delete legacy.chunkCount;
    await legacyStore.put('translation-catalog-source', legacy);
  }
  for (const translated of await ctx.store.list('translation')) {
    await legacyStore.put('translation', translated);
  }
  const legacy = new CachedTranslator({
    store: legacyStore,
    providerId: 'human-chunk-fixture',
    providerVersion: '1',
    offline: true,
  });
  assert.equal(
    (await applyComparisonTranslations(ctx.report, legacy)).comparisons[0]
      .product.presentation.description.text,
    english
  );
});

test('only planned reviewed commercial fields overlay offers; private contact and destination fields remain blocked', async (t) => {
  const ctx = await setup(t, {
    translate: (text) =>
      ({
        'Cửa hàng': 'Store',
        'Giảm 10%': '10% off',
        'Giao hàng': 'Delivery',
        'Đơn 500.000 ₫': 'Order 500,000 VND',
      })[text] || text.replaceAll('Sữa', 'Milk'),
  });
  const offer = {
    ...ctx.offer,
    seller: 'Cửa hàng',
    promotionText: 'Giảm 10%',
    shippingText: 'Giao hàng',
    conditions: ['Đơn 500.000 ₫'],
    shippingDestination: 'PRIVATE destination',
    phone: 'PRIVATE phone',
    email: 'PRIVATE email',
    address: 'PRIVATE address',
  };
  await ctx.store.put('offer', offer);
  const reviewed = await ctx.app.translate('Cửa hàng');
  await approve(ctx.app.translator, reviewed);
  const report = { comparisons: [{ ...ctx.report.comparisons[0], offer }] };
  assert.equal(
    (await applyComparisonTranslations(report, ctx.app.translator))
      .comparisons[0].offer.presentation.seller.text,
    'Cửa hàng'
  );
  const plan = await planCatalogTranslation(ctx.app, { includeSources: true });
  const commercial = plan.items.filter((item) => item.sourceKind === 'offer');
  assert.ok(
    !commercial.some((item) =>
      ['shippingDestination', 'address', 'phone', 'email'].some((key) =>
        item.path.includes(key)
      )
    )
  );
  await ctx.store.putMany('translation-catalog-source', commercial);
  for (const piece of commercial) {
    await approve(
      ctx.app.translator,
      await ctx.app.translate(piece.originalText)
    );
  }
  const shown = await applyComparisonTranslations(report, ctx.app.translator);
  assert.equal(shown.comparisons[0].offer.presentation.seller.text, 'Store');
  assert.equal(
    shown.comparisons[0].offer.presentation.shippingText.text,
    'Delivery'
  );
  assert.equal(
    shown.comparisons[0].offer.presentation.promotionText.text,
    '10% off'
  );
  assert.ok(
    shown.comparisons[0].offer.presentation.commercialText.some(
      (item) =>
        item.path[0] === 'conditions' &&
        item.presentation.text === 'Order 500,000 VND'
    )
  );
  assert.equal(
    shown.comparisons[0].offer.shippingDestination,
    'PRIVATE destination'
  );
  assert.equal(shown.comparisons[0].offer.seller, offer.seller);
  assert.equal(shown.comparisons[0].offer.price, 8000);
  assert.deepEqual(
    shown.comparisons[0].metrics,
    ctx.report.comparisons[0].metrics
  );
  assert.ok(!ctx.calls.some((text) => text.includes('PRIVATE')));
});
