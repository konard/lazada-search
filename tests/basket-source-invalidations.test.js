import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioFixture } from './helpers/checkout-scenarios.js';

const compareOptions = { requireManufacturer: false, allowStale: true };

async function quotedFixture(t) {
  const context = await scenarioFixture(t);
  const quote = await context.app.saveBasketQuote(context.mapping);
  const evidence = await context.store.get(
    'evidence',
    context.mapping.evidenceId
  );
  await context.store.put('cache', {
    id: 'checkout-cache-fixture',
    url: context.mapping.sourceUrl,
    html: evidence.html,
    observedAt: context.mapping.observedAt,
  });
  await context.store.put('evidence', {
    ...evidence,
    cacheId: 'checkout-cache-fixture',
  });
  assert.equal(
    (await context.app.compareBaskets(compareOptions)).ranked.length,
    1
  );
  return { ...context, quote };
}

async function assertWithdrawn(context) {
  const result = await context.app.compareBaskets(compareOptions);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].metrics, null);
  assert.match(result.observations[0].problems[0], /original|invalidated/iu);
  await assert.rejects(
    context.app.saveBasketQuote(context.mapping),
    /original|invalidated/iu
  );
  assert.deepEqual(
    await context.store.get('basket-quote', context.quote.id),
    context.quote
  );
  assert.equal(context.app.cache.stats.downloads, 0);
}

for (const [name, update] of [
  ['evidence boolean flag', { kind: 'evidence', invalidated: true }],
  [
    'evidence timestamp flag',
    { kind: 'evidence', invalidatedAt: 'invalid-date' },
  ],
  ['linked cache boolean flag', { kind: 'cache', invalidated: true }],
  [
    'linked cache timestamp flag',
    { kind: 'cache', invalidatedAt: 'invalid-date' },
  ],
]) {
  test(`basket save and ranking refuse an original with ${name}`, async (t) => {
    const context = await quotedFixture(t);
    const { kind, ...fields } = update;
    const id =
      kind === 'evidence'
        ? context.mapping.evidenceId
        : 'checkout-cache-fixture';
    await context.store.put(kind, {
      ...(await context.store.get(kind, id)),
      ...fields,
    });
    await assertWithdrawn(context);
    assert.deepEqual(
      await context.store.blob(context.mapping.sourceSha256),
      context.html
    );
  });
}

for (const [name, input] of [
  ['separate evidence ID binding', { evidenceIds: ['checkout-fixture'] }],
  ['separate cache ID binding', { cacheIds: ['checkout-cache-fixture'] }],
  ['separate URL binding', { url: 'https://cart.lazada.vn/cart' }],
  ['URL record identity binding', { id: 'https://cart.lazada.vn/cart' }],
  [
    'invalidated boolean without timestamp',
    {
      evidenceIds: ['checkout-fixture'],
      invalidated: true,
      invalidatedAt: undefined,
    },
  ],
  [
    'malformed invalidation timestamp',
    { evidenceIds: ['checkout-fixture'], invalidatedAt: 'invalid-date' },
  ],
  [
    'undated active invalidation',
    { evidenceIds: ['checkout-fixture'], invalidatedAt: undefined },
  ],
  [
    'malformed resolution timestamp',
    {
      evidenceIds: ['checkout-fixture'],
      invalidated: true,
      resolvedAt: 'invalid-date',
    },
  ],
]) {
  test(`basket original replay applies ${name}`, async (t) => {
    const context = await quotedFixture(t);
    await context.store.put('invalidation', {
      id: 'separate-fixture-invalidation',
      invalidatedAt: context.mapping.observedAt,
      ...input,
    });
    await assertWithdrawn(context);
  });
}

for (const [name, record] of [
  [
    'an earlier dated invalidation',
    { invalidatedAt: new Date(0).toISOString() },
  ],
  ['an inactive flag', { active: false, invalidated: true }],
  [
    'a resolved flag',
    { resolvedAt: new Date().toISOString(), invalidated: true },
  ],
  [
    'an explicit cleared flag',
    { invalidated: false, invalidatedAt: 'invalid-date' },
  ],
  [
    'a different exact source',
    {
      evidenceIds: ['another-checkout'],
      cacheIds: ['another-cache'],
      url: 'https://cart.lazada.vn/checkout',
    },
  ],
]) {
  test(`basket replay retains its exact source despite ${name}`, async (t) => {
    const context = await quotedFixture(t);
    await context.store.put('invalidation', {
      id: 'controlled-fixture-invalidation',
      evidenceIds: [context.mapping.evidenceId],
      invalidatedAt: context.mapping.observedAt,
      ...record,
    });
    assert.equal(
      (await context.app.compareBaskets(compareOptions)).ranked.length,
      1
    );
    assert.deepEqual(
      await context.app.saveBasketQuote(context.mapping),
      context.quote
    );
    assert.equal(context.app.cache.stats.downloads, 0);
  });
}

test('basket source byte length metadata is checked independently from the original content digest', async (t) => {
  const context = await quotedFixture(t);
  const evidence = await context.store.get(
    'evidence',
    context.mapping.evidenceId
  );
  await context.store.put('evidence', {
    ...evidence,
    html: { ...evidence.html, bytes: evidence.html.bytes + 1 },
  });
  const result = await context.app.compareBaskets(compareOptions);
  assert.equal(result.ranked.length, 0);
  assert.match(result.excluded[0].problems[0], /bytes.*corrupt/u);
  await assert.rejects(
    context.app.saveBasketQuote(context.mapping),
    /bytes.*corrupt/u
  );
  assert.deepEqual(
    await context.store.blob(context.mapping.sourceSha256),
    context.html
  );
});

test('nonfinite evaluation time leaves the basket quote explicitly ineligible even with stale observations allowed', async (t) => {
  const context = await quotedFixture(t);
  const result = await context.app.compareBaskets({
    ...compareOptions,
    now: NaN,
  });
  assert.equal(result.ranked.length, 0);
  assert.ok(
    result.excluded[0].problems.includes('Stale or invalid checkout quote')
  );
});
