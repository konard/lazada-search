import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  CachedTranslator,
  DomainScheduler,
  LazadaSearch,
  COLLECTION_STOP_ID,
  createHttpTranslationProvider,
} from '../src/index.js';
import { sha256 } from '../src/util.js';
import { parseArguments } from '../src/config.js';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/translation/vi-en.json', import.meta.url))
);
const scheduler = () => new DomainScheduler({ intervalMs: 0 });
async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-translation-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new AssociativeStore({ directory });
}
const adapter = (translate, version = '1') => ({
  id: 'fixture-human',
  version,
  translate,
});

test('disabled translation retains exact Unicode and leaves English pending with no requests', async (t) => {
  const store = await temporaryStore(t);
  const translator = new CachedTranslator({ store });
  const original = `  ${fixture.pairs[0].vi}\n`;
  const evidenceHash = sha256('original HTML bytes');
  const result = await translator.translate(original, {
    sourceEvidenceId: 'fixture-original',
    sourceEvidenceHash: evidenceHash,
  });
  assert.equal(result.originalText, original);
  assert.equal(result.sourceSha256, sha256(Buffer.from(original, 'utf8')));
  assert.equal(result.sourceEvidenceHash, evidenceHash);
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'provider-not-configured');
  assert.equal(result.translatedText, undefined);
  assert.equal(result.authoritative, false);
  assert.equal((await store.list('translation-source')).length, 1);
});

test('cache uses exact source bytes, pair and provider version and deduplicates concurrent calls', async (t) => {
  const store = await temporaryStore(t);
  let calls = 0;
  const provider = adapter(async ({ originalText }) => {
    calls += 1;
    return `English: ${originalText}`;
  });
  const translator = new CachedTranslator({
    store,
    provider,
    scheduler: scheduler(),
  });
  const source = fixture.pairs[0].vi;
  const [first, concurrent] = await Promise.all([
    translator.translate(source),
    translator.translate(source),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.id, concurrent.id);
  assert.equal((await translator.translate(source)).cacheHit, true);
  await translator.translate(`${source} `);
  await translator.translate(source.normalize('NFD'));
  await translator.translate(source, { targetLanguage: 'fr' });
  await new CachedTranslator({
    store,
    provider: adapter(provider.translate, '2'),
    scheduler: scheduler(),
  }).translate(source);
  assert.equal(calls, 5);
  await translator.translate(source, { refresh: true });
  assert.equal(calls, 6);
});

test('offline replay needs identity but no provider or credentials and refresh remains pending', async (t) => {
  const store = await temporaryStore(t);
  const pair = fixture.pairs[0];
  const online = new CachedTranslator({
    store,
    provider: adapter(() => pair.en),
    scheduler: scheduler(),
  });
  await online.translate(pair.vi);
  const offline = new CachedTranslator({
    store,
    providerId: 'fixture-human',
    providerVersion: '1',
    offline: true,
  });
  const replay = await offline.translate(pair.vi, {
    sourceEvidenceId: 'second-source',
  });
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.translatedText, pair.en);
  assert.equal(replay.sourceEvidenceId, 'second-source');
  const refreshed = await offline.translate(pair.vi, { refresh: true });
  assert.equal(refreshed.status, 'pending');
  assert.equal(refreshed.reason, 'offline-refresh-pending');
  assert.equal(refreshed.translatedText, undefined);
  assert.equal((await offline.translate(pair.vi)).status, 'pending');
});

test('provider failures never invent English or persist error secrets and retry successfully', async (t) => {
  const store = await temporaryStore(t);
  let fail = true;
  const provider = adapter(() => {
    if (fail) {
      throw new Error('secret-fixture-token response body');
    }
    return fixture.pairs[0].en;
  });
  const translator = new CachedTranslator({
    store,
    provider,
    scheduler: scheduler(),
  });
  const result = await translator.translate(fixture.pairs[0].vi);
  assert.equal(result.reason, 'provider-failed');
  assert.equal(result.translatedText, undefined);
  assert.ok(
    !JSON.stringify(await store.list('translation')).includes(
      'secret-fixture-token'
    )
  );
  fail = false;
  assert.equal(
    (await translator.translate(fixture.pairs[0].vi)).status,
    'translated'
  );
});

test('a provider throwing null remains pending without losing the original source', async (t) => {
  const store = await temporaryStore(t);
  const translator = new CachedTranslator({
    store,
    provider: adapter(() => {
      throw null;
    }),
    scheduler: scheduler(),
  });
  const result = await translator.translate(fixture.pairs[0].vi);
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'provider-failed');
  assert.equal(result.originalText, fixture.pairs[0].vi);
  assert.equal(result.translatedText, undefined);
});

test('a stop activated during an in-flight translation prevents caching its successful English response', async (t) => {
  const store = await temporaryStore(t);
  let started, finish;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const provider = adapter(() => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const translator = new CachedTranslator({
    store,
    provider,
    scheduler: scheduler(),
  });
  const operation = translator.translate(fixture.pairs[0].vi);
  await ready;
  await store.put('collection-stop', { id: COLLECTION_STOP_ID, active: true });
  finish(fixture.pairs[0].en);
  const result = await operation;
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'collection-stopped');
  assert.equal(result.translatedText, undefined);
  assert.equal(
    (await store.get('translation', result.id)).translatedText,
    undefined
  );
});

test('HTTP adapter releases rejected response bodies without persisting provider error content', async (t) => {
  const store = await temporaryStore(t);
  let cancelled = 0;
  const fetch = async () => ({
    status: 503,
    ok: false,
    body: {
      cancel: async () => {
        cancelled += 1;
      },
    },
  });
  const provider = createHttpTranslationProvider({
    endpoint: 'http://127.0.0.1/translation-fixture',
    id: 'fixture-http',
    version: '1',
    fetch,
  });
  const translator = new CachedTranslator({
    store,
    provider,
    scheduler: scheduler(),
  });
  assert.equal(
    (await translator.translate(fixture.pairs[0].vi)).reason,
    'provider-failed'
  );
  assert.equal(cancelled, 1);
});

test('product translations cannot overwrite price, nutrition, ingredients, original hashes or evidence', async (t) => {
  const store = await temporaryStore(t);
  const product = {
    id: 'translation-product',
    title: fixture.pairs[0].vi,
    ingredients: ['sữa', 'ca cao'],
    proteinPer100g: 3.5,
    netMassG: 200,
    evidenceIds: ['source-label'],
  };
  await store.put('product', product);
  await store.put('offer', {
    id: 'translation-offer',
    productId: product.id,
    price: 39000,
  });
  const original = await store.get('product', product.id);
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: scheduler(),
    translationProvider: adapter(() => 'Misleading 999 g protein, price 1 VND'),
  });
  t.after(() => app.close());
  const result = await app.translateProduct(product.id);
  assert.equal(result.complete, true);
  assert.ok(
    result.translations.every(
      (row) => row.presentationOnly && !row.authoritative
    )
  );
  assert.deepEqual(await store.get('product', product.id), original);
  assert.equal((await store.get('offer', 'translation-offer')).price, 39000);
});

test('product translation provenance preserves original sparse ingredient positions', async (t) => {
  const store = await temporaryStore(t);
  const ingredients = [];
  ingredients[1] = null;
  ingredients[2] = 'sữa';
  ingredients[3] = 42;
  ingredients[4] = 'ca cao';
  ingredients[5] = '';
  await store.put('product', {
    id: 'sparse-translation-product',
    title: fixture.pairs[0].vi,
    ingredients,
  });
  const app = new LazadaSearch({
    store,
    ocr: false,
    scheduler: scheduler(),
    translationProvider: adapter(
      ({ originalText }) => `English: ${originalText}`
    ),
  });
  t.after(() => app.close());
  const result = await app.translateProduct('sparse-translation-product');
  assert.deepEqual(
    result.translations
      .filter((item) => item.field === 'ingredients')
      .map((item) => [item.index, item.originalText]),
    [
      [2, 'sữa'],
      [4, 'ca cao'],
    ]
  );
  const links = (await store.list('translation-source')).filter(
    (item) => item.field === 'ingredients'
  );
  assert.deepEqual(links.map((item) => item.index).sort(), [2, 4]);
  assert.deepEqual(
    (await store.get('product', 'sparse-translation-product')).ingredients,
    [null, null, 'sữa', 42, 'ca cao', '']
  );
});

test('CAPTCHA stop prohibits provider calls but permits already cached translations', async (t) => {
  const store = await temporaryStore(t);
  let calls = 0;
  const translator = new CachedTranslator({
    store,
    provider: adapter(() => {
      calls += 1;
      return fixture.pairs[0].en;
    }),
    scheduler: scheduler(),
  });
  await translator.translate(fixture.pairs[0].vi);
  await store.put('collection-stop', { id: COLLECTION_STOP_ID, active: true });
  assert.equal(
    (await translator.translate(fixture.pairs[0].vi)).cacheHit,
    true
  );
  assert.equal(
    (await translator.translate(fixture.pairs[1].vi)).reason,
    'collection-stopped'
  );
  assert.equal(calls, 1);
});

test('invalid adapter results and identity mismatches are rejected and configuration preserves checkpoints', async (t) => {
  const store = await temporaryStore(t);
  assert.throws(
    () => new CachedTranslator({ store, provider: () => 'English' }),
    /explicit provider identity/
  );
  assert.throws(
    () =>
      new CachedTranslator({
        store,
        provider: adapter(() => ''),
        providerVersion: '2',
      }),
    /identity differs/
  );
  const translator = new CachedTranslator({
    store,
    provider: adapter(() => ({ text: 'Unvalidated shape' })),
    scheduler: scheduler(),
  });
  assert.equal(
    (await translator.translate(fixture.pairs[0].vi)).status,
    'pending'
  );
  assert.throws(
    () =>
      createHttpTranslationProvider({
        endpoint: 'https://user:secret@provider.invalid',
        id: 'provider',
        version: '1',
      }),
    /without credentials/
  );
  const config = parseArguments([
    'translate',
    fixture.pairs[0].vi,
    '--commit-checkpoints',
    '--translation-provider',
    'fixture-human',
    '--translation-version',
    '2',
  ]);
  assert.equal(config.commitCheckpoints, true);
  assert.equal(config.translationProvider, 'fixture-human');
  assert.equal(config.translationVersion, '2');
});
