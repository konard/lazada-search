import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceInvalidationApplies,
  workflowSourceInvalidated,
} from '../src/source-invalidation.js';

const observedAt = new Date(1000000000).toISOString();
const at = Date.parse(observedAt);
const source = {
  id: 'source-fixture',
  cacheId: 'source-cache-fixture',
  sourceUrl: 'https://factory.example/exact-label',
  observedAt,
};

for (const [name, record] of [
  ['missing timestamp', {}],
  ['malformed timestamp', { invalidatedAt: 'invalid-date' }],
  ['empty timestamp', { invalidatedAt: '' }],
  ['numeric timestamp', { invalidatedAt: at }],
  ['invalidated flag', { invalidated: true }],
  ['malformed resolved timestamp', { resolvedAt: 'invalid-date' }],
  ['numeric resolved timestamp', { resolvedAt: at }],
  ['concurrent timestamp', { invalidatedAt: observedAt }],
]) {
  test(`a bound source invalidation blocks ${name}`, () => {
    assert.equal(
      sourceInvalidationApplies(record, at, { requireTimestamp: true }),
      true
    );
    assert.equal(
      workflowSourceInvalidated(
        source,
        [],
        [{ evidenceIds: [source.id], ...record }]
      ),
      true
    );
  });
}

for (const [name, record] of [
  ['explicit inactive state', { active: false, invalidated: true }],
  [
    'explicit cleared state',
    { invalidated: false, invalidatedAt: 'invalid-date' },
  ],
  [
    'valid resolved state',
    { invalidated: true, resolvedAt: new Date(at + 1).toISOString() },
  ],
  [
    'prior dated invalidation',
    { invalidatedAt: new Date(at - 1).toISOString() },
  ],
]) {
  test(`unchanged source bytes can be replayed after ${name}`, () => {
    assert.equal(
      sourceInvalidationApplies(record, at, { requireTimestamp: true }),
      false
    );
    assert.equal(
      workflowSourceInvalidated(
        source,
        [],
        [{ evidenceIds: [source.id], ...record }]
      ),
      false
    );
    assert.equal(
      workflowSourceInvalidated({ ...source, ...record }, [], []),
      false
    );
  });
}

for (const [name, binding] of [
  ['source URL on the original', { url: source.sourceUrl }],
  ['sourceUrl alias on invalidation', { sourceUrl: source.sourceUrl }],
  ['source URL as invalidation identity', { id: source.sourceUrl }],
  ['exact source ID', { sourceIds: [source.id] }],
  ['exact evidence ID', { evidenceIds: [source.id] }],
  ['exact linked cache ID', { cacheIds: [source.cacheId] }],
]) {
  test(`missing invalidation time fails closed through ${name}`, () => {
    assert.equal(workflowSourceInvalidated(source, [], [binding]), true);
  });
}

test('ordinary bound cache metadata has no implicit invalidation and unrelated undated records cannot bind absent URLs', () => {
  const cache = { id: source.cacheId, url: source.sourceUrl, fetchedAt: at };
  assert.equal(workflowSourceInvalidated(source, [cache], []), false);
  assert.equal(sourceInvalidationApplies(cache, at), false);
  assert.equal(
    workflowSourceInvalidated(
      source,
      [cache],
      [{ evidenceIds: ['another-source'] }]
    ),
    false
  );
  assert.equal(
    workflowSourceInvalidated(
      { id: 'url-less-original', observedAt },
      [{ id: 'different-cache' }],
      [{ id: 'unrelated' }]
    ),
    false
  );
});

test('malformed cache timestamps and resolution cannot restore a retained linked source', () => {
  for (const change of [
    { invalidatedAt: 'invalid-date' },
    { invalidated: true, resolvedAt: 'invalid-date' },
    { resolvedAt: 'invalid-date' },
  ]) {
    assert.equal(
      workflowSourceInvalidated(
        source,
        [{ id: source.cacheId, ...change }],
        []
      ),
      true
    );
  }
});

test('cache sourceUrl aliases bind cache-ID invalidations and numeric fetchedAt remains an observation time', () => {
  const original = {
    id: 'cache-original',
    sourceUrl: source.sourceUrl,
    fetchedAt: at,
  };
  const cache = { id: 'other-cache-key', sourceUrl: source.sourceUrl };
  assert.equal(
    workflowSourceInvalidated(
      original,
      [cache],
      [{ cacheIds: [cache.id], invalidatedAt: new Date(at - 1).toISOString() }]
    ),
    false
  );
  assert.equal(
    workflowSourceInvalidated(
      original,
      [cache],
      [{ cacheIds: [cache.id], invalidatedAt: observedAt }]
    ),
    true
  );
});
