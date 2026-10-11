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
} from '../src/index.js';
import {
  checkTranslationQuality,
  translationReviewAccepted,
} from '../src/translation-quality.js';
import { applyComparisonTranslations } from '../src/translation-presentation.js';
import { sha256 } from '../src/util.js';

async function setup(t, translate) {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-translation-quality-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const calls = [];
  const translator = new CachedTranslator({
    store,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    provider: {
      id: 'reviewed-fixture',
      version: '1',
      translate: ({ originalText }) => {
        calls.push(originalText);
        return translate(originalText);
      },
    },
  });
  return { store, translator, calls };
}

test('quality checks preserve decimal/comma notation, thousands, nutrition bases, units and exact codes', () => {
  const source =
    'Merino 40 g, 5 chiếc; đạm 3,5 g/100 g; giá 1.250.000 ₫; SKU1561301337_VNAMZ-6599253417; https://manufacturer.example/label';
  const english =
    'Merino 40 grams, 5 pieces; protein 3.5 g per 100 grams; price 1,250,000 VND; SKU1561301337_VNAMZ-6599253417; https://manufacturer.example/label';
  const quality = checkTranslationQuality(source, english, {
    protectedEntities: ['Merino'],
  });
  assert.equal(quality.passed, true);
  assert.equal(quality.sourceSha256, sha256(source));
  assert.equal(quality.translatedSha256, sha256(english));
  assert.equal(quality.semanticAccuracyApproved, false);
  assert.ok(quality.protectedEntities.includes('Merino'));
});

const failures = [
  ['quantity', 'Kem 40 g', 'Ice cream 400 g', 'number-mismatch'],
  ['unit', 'Kem 40 g', 'Ice cream 40 ml', 'quantity-unit-mismatch'],
  ['bonus', 'Mua 2 túi tặng 1 túi', 'Buy 3 bags', 'number-mismatch'],
  [
    'nutrition basis',
    'Đạm 3,5 g/100 g',
    'Protein 100 g/3.5 g',
    'nutrition-basis-mismatch',
  ],
  [
    'coupon condition',
    'Giảm 10%; đơn 500.000 ₫',
    '10% off orders of 400,000 VND',
    'number-mismatch',
  ],
  [
    'SKU',
    'SKU1561301337_VNAMZ-6599253417',
    'SKU1561301337_VNAMZ-6599253418',
    'protected-entity-mismatch',
  ],
  [
    'barcode',
    'GTIN 0123456789012',
    'GTIN 123456789012',
    'protected-entity-mismatch',
  ],
  ['brand', 'Merino 40 g', 'Another 40 g', 'protected-entity-mismatch'],
  [
    'sugar',
    'Kem không đường',
    'Ice cream with sugar',
    'negative-condition-mismatch',
  ],
  [
    'delivery',
    'Không hỗ trợ giao Nha Trang',
    'Delivery to Nha Trang',
    'negative-condition-mismatch',
  ],
  ['stock', 'Hết hàng', 'Available', 'negative-condition-mismatch'],
  ['duration', 'Hạn 30 ngày', 'Valid for 30 months', 'quantity-unit-mismatch'],
];
for (const [label, original, english, issue] of failures) {
  test(`quality rejects altered ${label} without approving source facts`, () => {
    const result = checkTranslationQuality(original, english, {
      protectedEntities: ['Merino'],
    });
    assert.equal(result.passed, false);
    assert.ok(result.issues.includes(issue), JSON.stringify(result));
  });
}

test('unsafe provider text is retained as an unapproved candidate and cannot be reviewed into use', async (t) => {
  const { store, translator } = await setup(t, () => 'Merino 400 g');
  const result = await translator.translate('Merino 40 g', {
    protectedEntities: ['Merino'],
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'translation-quality-failed');
  assert.equal(result.translatedText, undefined);
  assert.equal(result.candidateText, 'Merino 400 g');
  assert.equal(result.review.status, 'pending');
  assert.equal(await translator.cached('Merino 40 g'), undefined);
  await assert.rejects(
    translator.review(result.id, {
      sourceSha256: result.sourceSha256,
      translatedSha256: result.translatedSha256,
      reviewer: 'fixture-reviewer',
      decision: 'approved',
    }),
    /quality checks must pass/
  );
  assert.equal(
    (await store.get('translation', result.id)).originalText,
    'Merino 40 g'
  );
});

test('a human review binds source, translated bytes, provider and checker; refresh invalidates it', async (t) => {
  const { translator, calls } = await setup(
    t,
    () => 'Merino chocolate ice cream 40 g'
  );
  const result = await translator.translate('Merino kem sô cô la 40 g', {
    protectedEntities: ['Merino'],
  });
  assert.equal(translationReviewAccepted(result), false);
  const review = {
    sourceSha256: result.sourceSha256,
    translatedSha256: result.translatedSha256,
    reviewer: 'fixture-reviewer',
    decision: 'approved',
  };
  await assert.rejects(
    translator.review(result.id, {
      ...review,
      sourceSha256: sha256('other source'),
    }),
    /exact source/
  );
  await assert.rejects(
    translator.review(result.id, {
      ...review,
      translatedSha256: sha256('other English'),
    }),
    /exact source/
  );
  const approved = await translator.review(result.id, review);
  assert.equal(translationReviewAccepted(approved), true);
  assert.equal(
    translationReviewAccepted(await translator.cached(result.originalText)),
    true
  );
  assert.equal(calls.length, 1);
  const refreshed = await translator.translate(result.originalText, {
    refresh: true,
  });
  assert.equal(refreshed.review.status, 'pending');
  assert.equal(translationReviewAccepted(refreshed), false);
  assert.equal(calls.length, 2);
});

test('legacy bad cache and altered output hashes fail offline; safe old text requires fresh review', async (t) => {
  const { store, translator, calls } = await setup(
    t,
    () => 'Merino chocolate ice cream 40 g'
  );
  const original = 'Merino kem sô cô la 40 g';
  const safe = await translator.translate(original);
  const offline = new CachedTranslator({
    store,
    offline: true,
    providerId: translator.providerId,
    providerVersion: translator.providerVersion,
  });
  const legacy = {
    ...safe,
    translatedText: 'Merino chocolate ice cream 400 g',
    translatedSha256: sha256('Merino chocolate ice cream 400 g'),
  };
  delete legacy.qualityChecks;
  delete legacy.review;
  await store.put('translation', legacy);
  assert.equal(await offline.cached(original), undefined);
  assert.equal(
    (await offline.translate(original)).reason,
    'cached-translation-unsuitable'
  );
  assert.equal(calls.length, 1);
  await store.put('translation', {
    ...safe,
    translatedSha256: sha256('corrupt'),
  });
  assert.equal(await offline.cached(original), undefined);
  await store.put('translation', {
    ...safe,
    review: {
      status: 'approved',
      sourceSha256: safe.sourceSha256,
      translatedSha256: safe.translatedSha256,
      qualityFingerprint: 'obsolete',
    },
  });
  const checked = await offline.cached(original);
  assert.equal(checked.review.status, 'pending');
  assert.equal(checked.qualityChecks.passed, true);
});

test('cache-only presentation keeps originals, positions and metrics and hides unreviewed/rejected English', async (t) => {
  const { translator, calls } = await setup(t, (text) =>
    text === 'sữa' ? 'milk' : 'Merino chocolate ice cream 40 g'
  );
  const product = {
    id: 'ice',
    title: 'Merino kem sô cô la 40 g',
    brand: 'Merino',
    ingredients: [null, 'sữa'],
    netMassG: 40,
    evidenceIds: ['original-label'],
  };
  const item = {
    product,
    offer: { price: 8000 },
    metrics: { costPerGramBeforeDelivery: 200 },
  };
  const report = {
    comparisons: [item],
    observedPrices: [item],
    ranked: [item],
    excluded: [],
    unsortable: [],
    bestByCategory: { whey: null, 'chocolate-ice-cream': item },
  };
  const original = globalThis.structuredClone(report);
  const title = await translator.translate(product.title);
  await translator.translate('sữa');
  const pending = await applyComparisonTranslations(report, translator);
  assert.equal(
    pending.comparisons[0].product.presentation.title.status,
    'review-pending'
  );
  assert.equal(
    pending.comparisons[0].product.presentation.title.text,
    product.title
  );
  assert.equal(
    pending.bestByCategory['chocolate-ice-cream'].product.presentation.title
      .status,
    'review-pending'
  );
  assert.equal(pending.bestByCategory.whey, null);
  await translator.review(title.id, {
    sourceSha256: title.sourceSha256,
    translatedSha256: title.translatedSha256,
    reviewer: 'fixture',
    decision: 'approved',
  });
  const shown = await applyComparisonTranslations(report, translator);
  assert.equal(
    shown.comparisons[0].product.presentation.title.text,
    'Merino chocolate ice cream 40 g'
  );
  assert.equal(shown.comparisons[0].product.title, product.title);
  assert.equal(
    shown.comparisons[0].product.presentation.ingredients[1].originalText,
    'sữa'
  );
  assert.deepEqual(shown.comparisons[0].metrics, item.metrics);
  assert.equal(
    shown.bestByCategory['chocolate-ice-cream'].product.presentation.title.text,
    'Merino chocolate ice cream 40 g'
  );
  assert.equal(
    shown.bestByCategory['chocolate-ice-cream'].product.title,
    product.title
  );
  assert.deepEqual(
    shown.bestByCategory['chocolate-ice-cream'].metrics,
    item.metrics
  );
  assert.deepEqual(report, original);
  assert.equal(calls.length, 2);
  await translator.review(title.id, {
    sourceSha256: title.sourceSha256,
    translatedSha256: title.translatedSha256,
    reviewer: 'fixture',
    decision: 'rejected',
  });
  const rejected = await applyComparisonTranslations(report, translator);
  assert.equal(
    rejected.comparisons[0].product.presentation.title.text,
    product.title
  );
  assert.equal(
    rejected.bestByCategory['chocolate-ice-cream'].product.presentation.title
      .text,
    product.title
  );
  assert.equal(calls.length, 2);
});

test('catalog distinguishes cached translations from human-reviewed English acceptance', async (t) => {
  const { store, translator } = await setup(
    t,
    () => 'Chocolate ice cream 40 g'
  );
  const app = new LazadaSearch({
    store,
    ocr: false,
    offline: true,
    translationProviderId: translator.providerId,
    translationProviderVersion: translator.providerVersion,
  });
  t.after(() => app.close());
  await store.put('product', { id: 'ice', title: 'Kem sô cô la 40 g' });
  const translated = await translator.translate('Kem sô cô la 40 g');
  const pending = await app.translateCatalog({ includeSources: false });
  assert.equal(pending.complete, true);
  assert.equal(pending.reviewedComplete, false);
  assert.equal(pending.counts.reviewPending, 1);
  await translator.review(translated.id, {
    sourceSha256: translated.sourceSha256,
    translatedSha256: translated.translatedSha256,
    reviewer: 'fixture',
    decision: 'approved',
  });
  const reviewed = await app.translateCatalog({ includeSources: false });
  assert.equal(reviewed.reviewedComplete, true);
  assert.equal(reviewed.counts.reviewed, 1);
  assert.equal(reviewed.catalogInventoryComplete, false);
});

test('disabled providers and oversized text preserve readable comparisons without cache/provider requests', async () => {
  const text = 'Kem sô cô la '.repeat(100000);
  const report = {
    comparisons: [
      {
        product: { title: 'Kem', description: text },
        metrics: { costPerGramBeforeDelivery: 200 },
      },
    ],
  };
  let reads = 0;
  const cached = () => {
    reads += 1;
    return undefined;
  };
  assert.equal(
    await applyComparisonTranslations(report, {
      cached,
      providerId: 'unconfigured',
    }),
    report
  );
  assert.equal(reads, 0);
  const result = await applyComparisonTranslations(report, {
    cached,
    providerId: 'configured-fixture',
  });
  assert.equal(reads, 1);
  assert.equal(result.comparisons[0].product.description, text);
  assert.equal(
    result.comparisons[0].product.presentation.description.status,
    'translation-needs-chunk-review'
  );
  assert.equal(result.comparisons[0].metrics.costPerGramBeforeDelivery, 200);
});
