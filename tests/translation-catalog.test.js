import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssociativeStore,
  LazadaSearch,
  DomainScheduler,
  planCatalogTranslation,
  COLLECTION_STOP_ID,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

async function setup(t, translate) {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-catalog-translation-')
  );
  const store = new AssociativeStore({ directory });
  const calls = [];
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    translationProvider: {
      id: 'fixture-catalog',
      version: '1',
      translate: (input) => {
        calls.push(input.originalText);
        return translate
          ? translate(input)
          : `English fixture: ${input.originalText}`;
      },
    },
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, store, calls };
}

test('catalog batch defaults to cache-only, resumes bounded text, deduplicates calls and replays without credentials', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', {
    id: 'powder-a',
    title: 'Bột whey không hương vị',
    ingredients: ['sữa', 'ca cao'],
    selectedVariant: [{ text: 'Sô cô la' }],
  });
  await store.put('product', {
    id: 'powder-b',
    title: 'Bột whey không hương vị',
  });
  const original = await store.list('product');
  const pending = await app.translateCatalog({
    includeSources: false,
    limit: 2,
  });
  assert.equal(pending.cacheOnly, true);
  assert.equal(pending.counts.pending, 2);
  assert.equal(calls.length, 0);
  const partial = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 2,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.lastRun.processed, 2);
  const completed = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 100,
  });
  assert.equal(completed.complete, true);
  assert.equal(calls.length, 4);
  assert.equal(completed.counts.total, 5);
  assert.deepEqual(await store.list('product'), original);
  const offline = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    translationProviderId: 'fixture-catalog',
    translationProviderVersion: '1',
  });
  t.after(() => offline.close());
  const replay = await offline.translateCatalog({ includeSources: false });
  assert.equal(replay.complete, true);
  assert.equal(replay.lastRun.processed, 0);
  assert.equal(replay.lastRun.cacheHits, 5);
  assert.equal(
    (await offline.translationStatus({ jobId: replay.id })).complete,
    true
  );
});

test('changed source bytes make new tasks and regenerate only changed text', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    ingredients: ['sữa'],
  });
  const first = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
  });
  const firstSources = await store.list('translation-catalog-source');
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la 40 g',
    ingredients: ['sữa'],
  });
  const next = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
  });
  assert.notEqual(next.fingerprint, first.fingerprint);
  assert.equal(calls.length, 3);
  assert.equal(next.lastRun.providerResults, 1);
  assert.equal(next.lastRun.cacheHits, 1);
  for (const old of firstSources) {
    assert.equal(
      (await store.get('translation-catalog-source', old.id)).originalText,
      old.originalText
    );
  }
});

test('failed early translations do not starve later unprocessed catalog fields', async (t) => {
  const control = { bad: undefined };
  const { app, store, calls } = await setup(t, ({ originalText }) => {
    if (originalText === control.bad) {
      throw new Error('Fixture failure');
    }
    return `English fixture: ${originalText}`;
  });
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    ingredients: ['sữa', 'ca cao'],
  });
  const plan = await planCatalogTranslation(app, { includeSources: false });
  control.bad = plan.items[0].originalText;
  const failed = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 1,
  });
  assert.equal(failed.counts.pending, 1);
  await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 1,
  });
  const second = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 1,
  });
  assert.equal(second.counts.translated, 2);
  assert.equal(calls.filter((text) => text === control.bad).length, 1);
  assert.equal(second.counts.pending, 1);
});

test('snapshot/OCR texts retain whole-source hashes, offsets and exact Unicode across chunks', async (t) => {
  const { app, store } = await setup(t);
  const image = await store.putBlob('Original image bytes for fixture label');
  const html = await store.putBlob('<h1>Kem sô cô la</h1>');
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    url: 'https://www.lazada.vn/products/fixture-i111.html',
    evidenceIds: ['label'],
  });
  await store.put('evidence', { id: 'label', html, image });
  const source = 'Thành phần: sữa, ca cao. 🍫\nKhông hương liệu.';
  await store.put('ocr', {
    id: 'label-ocr',
    imageHash: image.sha256,
    text: source,
    words: [{ text: 'Do not translate separately' }],
  });
  await store.put('cache', {
    id: 'page',
    url: 'https://www.lazada.vn/products/fixture-i111.html',
    html,
    snapshot: {
      description: 'Kem ngon',
      variants: [{ text: 'Sô cô la', selected: true }],
    },
  });
  const plan = await planCatalogTranslation(app, {
    productIds: ['ice'],
    maxChunkBytes: 12,
  });
  const items = plan.items
    .filter((item) => item.sourceKind === 'ocr')
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
  assert.equal(items.map((item) => item.originalText).join(''), source);
  assert.ok(
    items.every((item) => Buffer.byteLength(item.originalText, 'utf8') <= 12)
  );
  assert.ok(
    items.every(
      (item) =>
        item.originalSourceSha256 === sha256(source) &&
        item.sourceEvidenceHash === image.sha256
    )
  );
  let offset = 0;
  for (const item of items) {
    assert.equal(item.offset, offset);
    offset += item.originalText.length;
  }
  assert.ok(plan.items.some((item) => item.path.includes('variants')));
  assert.ok(!plan.items.some((item) => item.path.includes('words')));
  assert.deepEqual(plan.gaps, []);
});

test('missing original evidence stays an acceptance gap and private body/account text is excluded', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    evidenceIds: ['missing-label'],
  });
  await store.put('cache', {
    id: 'private',
    visibility: 'private',
    snapshot: {
      title: 'Kem sô cô la',
      rawText: 'Private account name',
      headers: { text: 'Private credential fixture' },
    },
  });
  const plan = await planCatalogTranslation(app);
  assert.ok(
    plan.gaps.some((item) => item.reason === 'source-evidence-not-cached')
  );
  assert.ok(!plan.items.some((item) => item.originalText.includes('Private')));
  const result = await app.translateCatalog({ cacheOnly: false });
  assert.equal(result.complete, false);
  assert.equal(result.status, 'partial');
  assert.equal(calls.length, 1);
  assert.equal(result.catalogInventoryComplete, false);
});

test('CAPTCHA stops new batch requests immediately but all successful text can still replay', async (t) => {
  const control = { store: undefined };
  const { app, store, calls } = await setup(t, async ({ originalText }) => {
    await control.store.put('collection-stop', {
      id: COLLECTION_STOP_ID,
      active: true,
    });
    return `English fixture: ${originalText}`;
  });
  control.store = store;
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    ingredients: ['sữa'],
  });
  const stopped = await app.translateCatalog({
    cacheOnly: false,
    includeSources: false,
  });
  assert.equal(stopped.status, 'stopped');
  assert.equal(calls.length, 1);
  assert.equal(stopped.counts.translated, 0);
  const pending = await app.translateCatalog({ includeSources: false });
  assert.equal(pending.cacheOnly, true);
  assert.equal(calls.length, 1);
});

test('refresh catalog work resumes without re-translating completed refreshed chunks', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    ingredients: ['sữa'],
  });
  await app.translateCatalog({ includeSources: false, cacheOnly: false });
  const refreshed = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    refresh: true,
    limit: 1,
  });
  assert.equal(refreshed.counts.translated, 1);
  const completed = await app.translateCatalog({
    includeSources: false,
    cacheOnly: false,
    limit: 1,
  });
  assert.equal(completed.complete, true);
  assert.equal(calls.length, 4);
  assert.equal(completed.refreshId, refreshed.refreshId);
});

test('current cached catalog acceptance rechecks each original translation and semantic approval without requests', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', { id: 'ice', title: 'Kem sô cô la 40 g' });
  const job = await app.translateCatalog({ cacheOnly: false });
  assert.equal(job.complete, true);
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    false
  );
  const records = await store.list('translation');
  for (const record of records) {
    await app.translator.review(record.id, {
      sourceSha256: record.sourceSha256,
      translatedSha256: record.translatedSha256,
      decision: 'approved',
      reviewer: 'Synthetic Vietnamese reviewer',
    });
  }
  await store.put('collection-stop', { id: COLLECTION_STOP_ID, active: true });
  const before = calls.length;
  const accepted = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(accepted.completeCachedCatalogEnglishAccepted, true);
  assert.equal(accepted.completeCatalogEnglishAccepted, false);
  assert.equal(accepted.reviewed, accepted.total);
  assert.equal(calls.length, before);
  await store.put('translation', {
    ...records[0],
    translatedText: 'Corrupt translated bytes',
  });
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    false
  );
  assert.equal(calls.length, before);
});

test('title-only or obsolete translation jobs cannot approve the current catalog and originals', async (t) => {
  const { app, store, calls } = await setup(t);
  await store.put('product', { id: 'ice', title: 'Kem sô cô la' });
  await app.translateCatalog({ includeSources: false, cacheOnly: false });
  const limited = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(limited.completeCachedCatalogEnglishAccepted, false);
  assert.equal(limited.jobId, null);
  await app.translateCatalog({ cacheOnly: false });
  for (const record of await store.list('translation')) {
    await app.translator.review(record.id, {
      sourceSha256: record.sourceSha256,
      translatedSha256: record.translatedSha256,
      decision: 'approved',
      reviewer: 'Synthetic Vietnamese reviewer',
    });
  }
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    true
  );
  await store.put('product', { id: 'ice', title: 'Kem sô cô la 40 g' });
  const before = calls.length;
  const changed = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(changed.completeCachedCatalogEnglishAccepted, false);
  assert.equal(changed.jobId, null);
  assert.equal(calls.length, before);
});

test('empty catalog and missing original source bytes never receive translation acceptance', async (t) => {
  const { app, store } = await setup(t);
  await app.translateCatalog({ cacheOnly: false });
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    false
  );
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    evidenceIds: ['missing-label'],
  });
  const status = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(status.completeCachedCatalogEnglishAccepted, false);
  assert.ok(
    status.sourceGaps.some((gap) => gap.reason === 'source-evidence-not-cached')
  );
});

test('catalog original acceptance validates attached image bytes and withdraws invalidated source text', async (t) => {
  const { app, store, calls } = await setup(t);
  const image = await store.putBlob('Synthetic original package image bytes');
  const observedAt = new Date().toISOString();
  await store.put('product', {
    id: 'ice',
    title: 'Kem sô cô la',
    evidenceIds: ['label'],
  });
  await store.put('evidence', {
    id: 'label',
    role: 'ocr',
    image,
    observedAt,
    url: 'https://img.lazcdn.com/fixture.webp',
  });
  await app.translateCatalog({ cacheOnly: false });
  for (const record of await store.list('translation')) {
    await app.translator.review(record.id, {
      sourceSha256: record.sourceSha256,
      translatedSha256: record.translatedSha256,
      decision: 'approved',
      reviewer: 'Synthetic Vietnamese reviewer',
    });
  }
  const before = calls.length;
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    true
  );
  await store.put('invalidation', {
    id: 'withdraw-label',
    evidenceIds: ['label'],
    invalidatedAt: observedAt,
  });
  const withdrawn = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(withdrawn.completeCachedCatalogEnglishAccepted, false);
  assert.ok(
    withdrawn.sourceGaps.some((gap) => gap.reason === 'source-invalidated')
  );
  await store.put('invalidation', {
    id: 'withdraw-label',
    evidenceIds: ['label'],
    invalidatedAt: observedAt,
    resolvedAt: new Date().toISOString(),
  });
  assert.equal(
    (await app.translationStatus({ verifyCurrentCatalog: true }))
      .completeCachedCatalogEnglishAccepted,
    true
  );
  await store.put('evidence', {
    id: 'label',
    role: 'ocr',
    image: { ...image, sha256: '0'.repeat(64) },
    observedAt,
  });
  const missing = await app.translationStatus({ verifyCurrentCatalog: true });
  assert.equal(missing.completeCachedCatalogEnglishAccepted, false);
  assert.ok(
    missing.sourceGaps.some(
      (gap) => gap.reason === 'source-bytes-not-cached-or-invalid'
    )
  );
  assert.equal(calls.length, before);
});
