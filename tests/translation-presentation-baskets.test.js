import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  CachedTranslator,
  DomainScheduler,
} from '../src/index.js';
import { planCatalogTranslation } from '../src/translation-catalog.js';
import { applyBasketComparisonTranslations } from '../src/translation-presentation.js';

async function setup(t, { reviewed = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-basket-english-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const calls = [];
  const translator = new CachedTranslator({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    provider: {
      id: 'basket-english-fixture',
      version: '1',
      translate: ({ originalText }) => {
        calls.push(originalText);
        return (
          {
            'Kem chocolate 40 g': 'Chocolate ice cream 40 g',
            'Cửa hàng': 'Store',
            'Giảm 10%': '10% off',
          }[originalText] || originalText
        );
      },
    },
  });
  const product = {
    id: 'product:ice',
    title: 'Kem chocolate 40 g',
    category: 'chocolate-ice-cream',
    netMassG: 40,
  };
  const offer = {
    id: 'offer:ice',
    productId: product.id,
    sku: '1561301337_VNAMZ-6599253417',
    price: 8000,
    seller: 'Cửa hàng',
    promotionText: 'Giảm 10%',
    shippingDestination: 'PRIVATE destination',
    address: 'PRIVATE address',
    phone: 'PRIVATE phone',
    email: 'PRIVATE email',
  };
  await store.put('product', product);
  await store.put('offer', offer);
  const plan = await planCatalogTranslation(
    { store },
    { includeSources: true }
  );
  await store.putMany('translation-catalog-source', plan.items);
  const translations = [];
  for (const text of [product.title, offer.seller, offer.promotionText]) {
    const result = await translator.translate(text);
    translations.push(result);
    if (reviewed) {
      await translator.review(result.id, {
        sourceSha256: result.sourceSha256,
        translatedSha256: result.translatedSha256,
        reviewer: 'basket-english-fixture',
        decision: 'approved',
      });
    }
  }
  const line = {
    product,
    offer,
    metrics: { quantity: 5, totalMassG: 200, costPerGramBeforeDelivery: 200 },
  };
  const ranked = {
    quote: { shippingDestination: offer.shippingDestination, total: 39000 },
    lines: [line],
    metrics: {
      totalMassG: 200,
      totalAfterDelivery: 39000,
      costPerGramAfterDelivery: 195,
    },
    eligible: true,
  };
  const excluded = {
    ...ranked,
    eligible: false,
    problems: ['Stale checkout quote'],
  };
  const missing = {
    eligible: false,
    problems: ['Original source missing'],
    metrics: null,
  };
  const report = {
    observations: [ranked, excluded, missing],
    ranked: [ranked],
    excluded: [excluded, missing],
    assumptions: { quoteCoverage: 'captured-exact-baskets-only' },
  };
  return {
    store,
    translator,
    calls,
    product,
    offer,
    plan,
    translations,
    report,
  };
}

test('basket English uses reviewed cached product and planned commercial text while preserving quote, metrics and row aliases', async (t) => {
  const ctx = await setup(t);
  const original = globalThis.structuredClone(ctx.report);
  const beforeCalls = ctx.calls.length;
  const beforeSources = await ctx.store.list('translation-catalog-source');
  const beforeTranslations = await ctx.store.list('translation');
  const offline = new CachedTranslator({
    store: ctx.store,
    providerId: ctx.translator.providerId,
    providerVersion: ctx.translator.providerVersion,
    offline: true,
  });
  const shown = await applyBasketComparisonTranslations(ctx.report, offline);
  const basket = shown.ranked[0];
  const line = basket.lines[0];
  assert.equal(line.product.title, ctx.product.title);
  assert.equal(
    line.product.presentation.title.text,
    'Chocolate ice cream 40 g'
  );
  assert.equal(line.product.presentation.title.status, 'reviewed');
  assert.equal(line.offer.seller, ctx.offer.seller);
  assert.equal(line.offer.presentation.seller.text, 'Store');
  assert.equal(line.offer.presentation.promotionText.text, '10% off');
  assert.equal(basket, shown.observations[0]);
  assert.equal(shown.excluded[0], shown.observations[1]);
  assert.equal(shown.excluded[1], shown.observations[2]);
  assert.equal(shown.excluded[1], ctx.report.excluded[1]);
  assert.equal(basket.quote, ctx.report.ranked[0].quote);
  assert.equal(basket.metrics, ctx.report.ranked[0].metrics);
  assert.equal(line.metrics, ctx.report.ranked[0].lines[0].metrics);
  assert.equal(shown.assumptions, ctx.report.assumptions);
  assert.deepEqual(ctx.report, original);
  assert.equal(ctx.calls.length, beforeCalls);
  assert.deepEqual(
    await ctx.store.list('translation-catalog-source'),
    beforeSources
  );
  assert.deepEqual(await ctx.store.list('translation'), beforeTranslations);
  assert.ok(!ctx.calls.some((text) => text.includes('PRIVATE')));
  assert.ok(
    !ctx.plan.items.some((item) => item.originalText.includes('PRIVATE'))
  );
  assert.ok(
    !line.offer.presentation.commercialText.some((item) =>
      ['shippingDestination', 'address', 'phone', 'email'].some((field) =>
        item.path.includes(field)
      )
    )
  );
});

for (const mode of [
  'unreviewed',
  'rejected',
  'stale-checker',
  'changed-source',
]) {
  test(`basket ${mode} English preserves the current original text without generating translations`, async (t) => {
    const ctx = await setup(t, { reviewed: mode !== 'unreviewed' });
    if (mode === 'rejected') {
      for (const record of ctx.translations) {
        await ctx.translator.review(record.id, {
          sourceSha256: record.sourceSha256,
          translatedSha256: record.translatedSha256,
          reviewer: 'basket-english-fixture',
          decision: 'rejected',
        });
      }
    }
    if (mode === 'stale-checker') {
      for (const record of await ctx.store.list('translation')) {
        await ctx.store.put('translation', {
          ...record,
          review: { ...record.review, qualityFingerprint: 'obsolete-checker' },
        });
      }
    }
    if (mode === 'changed-source') {
      ctx.product.title = 'Kem chocolate 60 g';
      ctx.offer.seller = 'Cửa hàng mới';
      ctx.offer.promotionText = 'Giảm 5%';
    }
    const beforeCalls = ctx.calls.length;
    const shown = await applyBasketComparisonTranslations(
      ctx.report,
      ctx.translator
    );
    const line = shown.ranked[0].lines[0];
    assert.equal(line.product.presentation.title.text, ctx.product.title);
    assert.equal(line.offer.presentation.seller.text, ctx.offer.seller);
    assert.equal(
      line.offer.presentation.promotionText.text,
      ctx.offer.promotionText
    );
    assert.notEqual(line.product.presentation.title.status, 'reviewed');
    assert.equal(shown.ranked[0].metrics, ctx.report.ranked[0].metrics);
    assert.equal(shown.excluded[0].eligible, false);
    assert.equal(ctx.calls.length, beforeCalls);
  });
}

test('disabled basket translations retain the original report without cache reads', async () => {
  const report = { observations: [], ranked: [], excluded: [] };
  assert.equal(await applyBasketComparisonTranslations(report), report);
  assert.equal(
    await applyBasketComparisonTranslations(report, {
      providerId: 'unconfigured',
      cached() {
        assert.fail('Disabled presentation cannot read the cache');
      },
    }),
    report
  );
});
