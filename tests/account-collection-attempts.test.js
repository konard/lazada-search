import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssociativeStore } from '../src/store.js';
import {
  attemptedCollectionUrls,
  recordCollectionAttempt,
} from '../scripts/account-collection-attempts.mjs';

test('deferred collection tasks survive a restart without refetching; explicit refresh reopens them', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-collection-attempts-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const url = 'https://www.lazada.vn/products/pdp-i101.html?skuId=7';
  await recordCollectionAttempt(store, `${url}&utm_source=tracking`, {
    status: 'deferred',
    reason: 'Selected SKU is absent from the observed inventory',
  });
  const reopened = new AssociativeStore({ directory });
  assert.deepEqual(await attemptedCollectionUrls(reopened), [url]);
  assert.deepEqual(
    await attemptedCollectionUrls(reopened, { refresh: true }),
    []
  );
  const [attempt] = await reopened.list('collection-attempt');
  assert.equal(attempt.status, 'deferred');
  assert.match(attempt.reason, /absent/u);
  await reopened.put('invalidation', {
    id: url,
    url,
    invalidatedAt: new Date(
      Date.parse(attempt.attemptedAt) + 1000
    ).toISOString(),
    reason: 'Correct an incomplete SKU extraction',
  });
  assert.deepEqual(await attemptedCollectionUrls(reopened), []);
});
