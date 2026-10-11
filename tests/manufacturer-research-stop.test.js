import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AssociativeStore } from '../src/store.js';
import { DomainScheduler } from '../src/cache.js';
import { ManufacturerResearch } from '../src/manufacturer-research.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';

test('manufacturer research saves its partial receipt and throws before another source or review after a real interstitial', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'manufacturer-research-stop-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const original = gunzipSync(
    await readFile(
      new URL(
        '../docs/acceptance/source-integrity/natural-chocolate-manufacturer/official-natural-whey.http403.public.html.gz',
        import.meta.url
      )
    )
  );
  let requests = 0;
  const research = new ManufacturerResearch({
    store,
    registry: [{ brand: 'Factory fixture', domains: ['factory.example'] }],
    scheduler: new DomainScheduler({ intervalMs: 0 }),
    fetchSource: async () => {
      requests++;
      return new globalThis.Response(original, {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const plan = {
    id: 'original-challenge-plan',
    sources: ['/blocked', '/must-not-run'].map((path) => ({
      brand: 'Factory fixture',
      url: `https://factory.example${path}`,
    })),
    reviews: [{ id: 'must-not-review' }],
  };
  await assert.rejects(research.run(plan), { code: 'COLLECTION_STOPPED' });
  assert.equal(requests, 1);
  const receipt = await store.get('manufacturer-research', plan.id);
  assert.equal(receipt.status, 'stopped-security-challenge');
  assert.equal(receipt.failures.length, 1);
  assert.equal(receipt.cache.downloads, 1);
  assert.deepEqual(receipt.reviews, []);
  assert.equal((await store.list('manufacturer-source')).length, 1);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  await assert.rejects(research.run({ ...plan, id: 'restarted-plan' }), {
    code: 'COLLECTION_STOPPED',
  });
  assert.equal(requests, 1);
});
