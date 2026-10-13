import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  reviewNonBrowserCollectionStop,
} from '../src/index.js';
import {
  stopForChallenge,
  assertCollectionRunning,
} from '../src/page-challenge.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-operator-stop-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  await stopForChallenge(store, {
    url: 'https://factory.example/chocolate-whey',
    signals: ['visible-cloudflare-interstitial'],
  });
  const expectedStop = await store.get('collection-stop', 'browser-collection');
  const input = {
    decision: 'dismiss-non-browser-stop',
    reason:
      'The operator reviewed the visible marketplace and requested collection.',
    expectedStop,
    observedPageUrl: 'https://www.lazada.vn/?account=private-value',
  };
  return { directory, store, expectedStop, input };
}

test('an explicit operator decision releases only the reviewed HTTP checkpoint and survives restart', async (t) => {
  const { directory, store, expectedStop, input } = await fixture(t);
  const result = await reviewNonBrowserCollectionStop(store, input);
  assert.equal(result.active, false);
  assert.equal(result.origin, expectedStop.origin);
  assert.equal(result.detectedAt, expectedStop.detectedAt);
  assert.deepEqual(result.signals, expectedStop.signals);
  assert.equal(result.challengedSourceRecoveryConfirmed, false);
  await assertCollectionRunning(store);
  const restarted = new AssociativeStore({ directory });
  assert.deepEqual(
    await restarted.get('collection-stop', expectedStop.id),
    result
  );
  const history = await restarted.get(
    'collection-stop-review',
    result.operatorReviewId
  );
  assert.deepEqual(history.checkpoint, expectedStop);
  assert.equal(history.observedPageOrigin, 'https://www.lazada.vn');
  assert.equal(history.status, 'requested');
  assert.doesNotMatch(JSON.stringify(history), /private-value|account=/u);
  for (const file of [
    'browser-window.json',
    'browser-profile',
    'browser-window-options.json',
  ]) {
    assert.equal(
      await stat(join(directory, file)).catch(() => undefined),
      undefined
    );
  }
});

test('a later challenge stops again and keeps the earlier operator decision record', async (t) => {
  const { store, input } = await fixture(t);
  const dismissed = await reviewNonBrowserCollectionStop(store, input);
  const next = await stopForChallenge(store, {
    url: 'https://www.lazada.vn/_____tmd_____/punish',
    signals: ['challenge-url'],
  });
  assert.equal(next.active, true);
  assert.equal(next.origin, 'https://www.lazada.vn');
  assert.equal(next.precedingOperatorReviewId, dismissed.operatorReviewId);
  assert.ok(
    await store.get('collection-stop-review', dismissed.operatorReviewId)
  );
  await assert.rejects(assertCollectionRunning(store), {
    code: 'COLLECTION_STOPPED',
  });
});

test('missing consent, checkpoint and reason leave the checkpoint and history untouched', async (t) => {
  const { store, expectedStop, input } = await fixture(t);
  for (const bad of [
    {},
    { ...input, decision: 'resume' },
    { ...input, reason: '' },
    { ...input, reason: '   ' },
    { ...input, expectedStop: null },
    { ...input, expectedStop: [] },
    { ...input, observedPageUrl: 'file:///tmp/label' },
  ]) {
    await assert.rejects(reviewNonBrowserCollectionStop(store, bad));
    assert.deepEqual(
      await store.get('collection-stop', expectedStop.id),
      expectedStop
    );
  }
  assert.deepEqual(await store.list('collection-stop-review'), []);
});

test('every browser binding including incomplete metadata requires ordinary browser resume', async (t) => {
  const { store, expectedStop, input } = await fixture(t);
  for (const browser of [
    { targetId: 'original', mode: 'persistent' },
    {},
    null,
    false,
  ]) {
    const bound = { ...expectedStop, browser };
    await store.put('collection-stop', bound);
    await assert.rejects(
      reviewNonBrowserCollectionStop(store, { ...input, expectedStop: bound }),
      /retained original page/u
    );
    assert.deepEqual(
      await store.get('collection-stop', expectedStop.id),
      bound
    );
  }
  assert.deepEqual(await store.list('collection-stop-review'), []);
});

test('a replaced checkpoint cannot be dismissed using the old decision', async (t) => {
  const { store, expectedStop, input } = await fixture(t);
  const changed = {
    ...expectedStop,
    origin: 'https://www.lazada.vn',
    signals: ['challenge-instructions'],
  };
  await store.put('collection-stop', changed);
  await assert.rejects(
    reviewNonBrowserCollectionStop(store, input),
    /stop changed/u
  );
  assert.deepEqual(
    await store.get('collection-stop', expectedStop.id),
    changed
  );
  assert.deepEqual(await store.list('collection-stop-review'), []);
});

test('competing operator decisions apply the exact checkpoint only once', async (t) => {
  const { store, input } = await fixture(t);
  const results = await Promise.allSettled([
    reviewNonBrowserCollectionStop(store, input),
    reviewNonBrowserCollectionStop(store, {
      ...input,
      reason: 'A second operator request',
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.equal((await store.list('collection-stop-review')).length, 1);
});

test('a failed stop commit preserves an active checkpoint and only records the requested decision', async (t) => {
  const { store, expectedStop, input } = await fixture(t);
  const write = store.writeRecord.bind(store);
  store.writeRecord = (kind, entry) => {
    if (kind === 'collection-stop') {
      throw new Error('Injected durable stop failure');
    }
    return write(kind, entry);
  };
  await assert.rejects(
    reviewNonBrowserCollectionStop(store, input),
    /durable stop failure/u
  );
  assert.deepEqual(
    await store.get('collection-stop', expectedStop.id),
    expectedStop
  );
  const [review] = await store.list('collection-stop-review');
  assert.equal(review.status, 'requested');
  assert.equal(review.appliedAt, undefined);
  assert.equal(review.challengedSourceRecoveryConfirmed, false);
});

test('status handoff metadata and property ordering do not invalidate the same exact checkpoint', async (t) => {
  const { store, expectedStop, input } = await fixture(t);
  const reordered = Object.fromEntries(Object.entries(expectedStop).reverse());
  reordered.handoff = { status: 'no-browser-page', pageOpen: false };
  assert.equal(
    (
      await reviewNonBrowserCollectionStop(store, {
        ...input,
        expectedStop: reordered,
      })
    ).active,
    false
  );
});
