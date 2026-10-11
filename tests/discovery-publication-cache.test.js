import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parseHTML } from 'linkedom';
import {
  AssociativeStore,
  LazadaSearch,
  extractPage,
  publishAccountDiscovery,
} from '../src/index.js';
import { discoveryPublicationStore } from '../src/discovery-publication-cache.js';

const url = 'https://www.lazada.vn/catalog/?q=whey&page=1&sort=priceasc';
const cacheId = `search:vn:Nha Trang:${url}`;
const firstTime = Date.parse('2026-10-09T09:00:00Z');
const secondTime = firstTime + 86400000;
const html = ({
  price = '300.000',
  token = 'fictional-private-a',
  terminal = true,
} = {}) =>
  `<div id="myAccountTrigger">Fictional private customer</div><div data-product-card><a title="Whey chocolate 500g" href="/products/pdp-i101.html"></a><span data-card-price>${price} ₫</span></div><nav class="ant-pagination"><button class="ant-pagination-next" aria-disabled="${terminal}">Next</button></nav><script>window.sessionToken='${token}';</script>`;

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-discovery-reuse-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const source = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  app.collector.start = () => {
    throw new Error('Discovery publication cannot start a browser');
  };
  return { shared, source, app };
}

async function capture(source, { fetchedAt = firstTime, ...options } = {}) {
  const content = html(options);
  return source.put('cache', {
    id: cacheId,
    url,
    status: 'ok',
    html: await source.putBlob(content),
    snapshot: extractPage({ document: parseHTML(content).document, url }),
    fetchedAt,
    checkedAt: fetchedAt,
    scrolling: { reachedBoundary: true },
  });
}

async function metadata(store, time, price) {
  const observedAt = new Date(time).toISOString();
  await store.put('discovery', {
    id: 'listing',
    cacheId,
    observedAt,
    searchPrice: price,
  });
  await store.put('crawl-page', { id: url, cacheId, observedAt, cards: 1 });
  await store.put('crawl', {
    id: 'campaign',
    startedAt: observedAt,
    finishedAt: observedAt,
    pages: [{ url, status: 'ok' }],
    discovered: 1,
  });
}

test('unchanged search source reuses hash-verified output with no blob or metadata writes', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  await metadata(source, firstTime, 300000);
  const started = performance.now();
  const first = await publishAccountDiscovery(app, source);
  const fullMs = performance.now() - started;
  assert.equal(first.reused, 0);
  const [proof] = await shared.list('discovery-publication-source');
  assert.equal(proof.sourceHtmlSha256, original.html.sha256);
  assert.match(proof.pipelineFingerprint, /^[a-f\d]{64}$/u);
  assert.equal(proof.observedAt, new Date(firstTime).toISOString());
  assert.doesNotMatch(
    JSON.stringify(proof),
    /fictional-private|Fictional private/u
  );
  assert.equal(await shared.blob(original.html.sha256), undefined);
  shared.putBlob = () => {
    throw new Error('Reuse must skip redacted output creation');
  };
  shared.putLatest = () => {
    throw new Error('Unchanged reuse must skip metadata writes');
  };
  const replayStarted = performance.now();
  const replay = await publishAccountDiscovery(app, source);
  t.diagnostic(
    `Search publication fixture full=${fullMs.toFixed(2)}ms reused=${(performance.now() - replayStarted).toFixed(2)}ms; output writes=0`
  );
  assert.deepEqual(replay.published, first.published);
  assert.equal(replay.reused, 1);
  assert.deepEqual(replay.rejected, []);
  assert.equal(replay.downloads, 0);
});

test('private HTML changes invalidate reuse even when all public cards and pagination are unchanged', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  const first = await publishAccountDiscovery(app, source);
  const changed = await capture(source, { token: 'fictional-private-b' });
  assert.notEqual(changed.html.sha256, original.html.sha256);
  assert.deepEqual(changed.snapshot.cards, original.snapshot.cards);
  const replay = await publishAccountDiscovery(app, source);
  assert.equal(replay.reused, 0);
  assert.equal(replay.published[0].id, first.published[0].id);
  assert.equal((await shared.list('discovery-publication-source')).length, 2);
  assert.equal((await publishAccountDiscovery(app, source)).reused, 1);
});

test('changed source snapshot and actual pagination each require fresh extraction', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  await publishAccountDiscovery(app, source);
  await source.put('cache', {
    ...original,
    snapshot: {
      ...original.snapshot,
      searchCoverage: {
        ...original.snapshot.searchCoverage,
        terminalConfirmed: false,
      },
    },
  });
  const snapshotChanged = await publishAccountDiscovery(app, source);
  assert.equal(snapshotChanged.reused, 0);
  assert.equal(snapshotChanged.published[0].extractionReprocessed, true);
  assert.equal(
    (await shared.get('cache', cacheId)).snapshot.searchCoverage
      .terminalConfirmed,
    true
  );
  await capture(source, { terminal: false, fetchedAt: secondTime });
  const changed = await publishAccountDiscovery(app, source);
  assert.equal(changed.reused, 0);
  assert.equal(
    (await shared.get('cache', cacheId)).snapshot.searchCoverage
      .terminalConfirmed,
    false
  );
});

test('missing or changed producer proof repairs altered cards under an existing publication ID', async (t) => {
  const { shared, source, app } = await setup(t);
  await capture(source);
  const initial = await publishAccountDiscovery(app, source);
  const [proof] = await shared.list('discovery-publication-source');
  await shared.put('discovery-publication-source', {
    ...proof,
    pipelineFingerprint: 'unrecognised-producer',
  });
  const cached = await shared.get('cache', cacheId);
  await shared.put('cache', {
    ...cached,
    snapshot: {
      ...cached.snapshot,
      cards: [{ ...cached.snapshot.cards[0], priceText: '1 ₫' }],
    },
  });
  const fixed = await publishAccountDiscovery(app, source);
  assert.equal(fixed.reused, 0);
  assert.equal(fixed.published[0].id, initial.published[0].id);
  assert.equal(
    (await shared.get('cache', cacheId)).snapshot.cards[0].priceText,
    '300.000 ₫'
  );
  await rm(shared.recordPath('discovery-publication-source', proof.id));
  assert.equal((await publishAccountDiscovery(app, source)).reused, 0);
  assert.equal((await publishAccountDiscovery(app, source)).reused, 1);
});

test('missing public output rebuilds from the original; corrupt output is explicitly rejected', async (t) => {
  const { shared, source, app } = await setup(t);
  await capture(source);
  const first = await publishAccountDiscovery(app, source);
  const blob = first.published[0].html;
  const cache = await shared.get('cache', cacheId);
  const wrongBlob = await shared.putBlob('<div>Different public page</div>');
  await shared.put('cache', {
    ...cache,
    html: wrongBlob,
    extractedHtmlSha256: wrongBlob.sha256,
  });
  const restored = await publishAccountDiscovery(app, source);
  assert.equal(restored.reused, 0);
  assert.equal((await shared.get('cache', cacheId)).html.sha256, blob.sha256);
  const path = join(
    shared.directory,
    'blobs',
    blob.sha256.slice(0, 2),
    blob.sha256
  );
  await rm(path);
  const repaired = await publishAccountDiscovery(app, source);
  assert.equal(repaired.reused, 0);
  assert.equal(repaired.rejected.length, 0);
  assert.ok((await shared.blob(blob.sha256)).length);
  await writeFile(path, 'corrupt public output');
  const corrupt = await publishAccountDiscovery(app, source);
  assert.equal(corrupt.reused, 0);
  assert.equal(corrupt.published.length, 0);
  assert.match(corrupt.rejected[0].reason, /Corrupt evidence blob/u);
});

test('invalidated or corrupt original source cannot publish updated discovery metadata', async (t) => {
  const { shared, source, app } = await setup(t);
  const original = await capture(source);
  await metadata(source, firstTime, 300000);
  await publishAccountDiscovery(app, source);
  const existing = await shared.get('discovery', 'listing');
  await source.put('cache', {
    ...original,
    invalidatedAt: new Date(secondTime).toISOString(),
  });
  await metadata(source, secondTime, 1);
  const invalid = await publishAccountDiscovery(app, source);
  assert.equal(invalid.published.length, 0);
  assert.match(invalid.rejected[0].reason, /Invalidated search source/u);
  assert.deepEqual(await shared.get('discovery', 'listing'), existing);
  await source.put('cache', {
    ...original,
    html: { ...original.html, bytes: original.html.bytes + 1 },
  });
  assert.match(
    (await publishAccountDiscovery(app, source)).rejected[0].reason,
    /digest or length/u
  );
});

test('older observations retain their receipts while protecting newer cache and crawl metadata even without legacy observedAt', async (t) => {
  const { shared, source, app } = await setup(t);
  const older = await capture(source);
  await metadata(source, firstTime, 300000);
  const first = await publishAccountDiscovery(app, source);
  await capture(source, { fetchedAt: secondTime, price: '200.000' });
  await metadata(source, secondTime, 200000);
  const latest = await publishAccountDiscovery(app, source);
  assert.notEqual(first.published[0].id, latest.published[0].id);
  const newCache = await shared.get('cache', cacheId);
  delete newCache.observedAt;
  await shared.put('cache', newCache);
  const newCrawl = await shared.get('crawl', 'campaign');
  delete newCrawl.observedAt;
  delete newCrawl.finishedAt;
  newCrawl.updatedAt = new Date(secondTime).toISOString();
  await shared.put('crawl', newCrawl);
  const currentListing = await shared.get('discovery', 'listing');
  await source.put('cache', older);
  await metadata(source, firstTime, 300000);
  const reused = await publishAccountDiscovery(app, source);
  assert.equal(reused.reused, 1);
  assert.deepEqual(reused.published, first.published);
  const oldProof = (await shared.list('discovery-publication-source')).find(
    (entry) => entry.observedAt === new Date(firstTime).toISOString()
  );
  await shared.put('discovery-publication-source', {
    ...oldProof,
    pipelineFingerprint: 'refresh-extraction',
  });
  const rebuilt = await publishAccountDiscovery(app, source);
  assert.equal(rebuilt.reused, 0);
  assert.deepEqual(rebuilt.published, first.published);
  assert.deepEqual(await shared.get('cache', cacheId), newCache);
  assert.deepEqual(await shared.get('crawl', 'campaign'), newCrawl);
  assert.deepEqual(await shared.get('discovery', 'listing'), currentListing);
});

test('chronological discovery batch writers protect legacy timestamps under one locked read view without rewriting existing records', async (t) => {
  const { shared } = await setup(t);
  const view = discoveryPublicationStore(shared);
  const current = {
    id: 'legacy-search',
    fetchedAt: secondTime,
    snapshot: { cards: [{ title: 'Newer chocolate powder', price: 200000 }] },
  };
  await shared.put('cache', current);
  const lock = shared.locked.bind(shared);
  let locked = false;
  let locks = 0;
  shared.locked = (action) => {
    locks += 1;
    return lock(async () => {
      locked = true;
      try {
        return await action();
      } finally {
        locked = false;
      }
    });
  };
  const get = shared.get.bind(shared);
  shared.get = (kind, id) => {
    assert.equal(locked, true, 'chronology must read inside the writer lock');
    return get(kind, id);
  };
  shared.project = () => {
    throw new Error('Older or undated observations cannot write projections');
  };
  const results = await view.putLatestMany('cache', [
    {
      id: current.id,
      fetchedAt: firstTime,
      observedAt: new Date(firstTime).toISOString(),
      snapshot: { cards: [{ title: 'Older chocolate powder', price: 1 }] },
    },
    { id: current.id, snapshot: { cards: [] } },
  ]);
  assert.equal(locks, 1);
  assert.deepEqual(
    results,
    Array(2).fill({
      ...current,
      observedAt: new Date(secondTime).toISOString(),
    })
  );
  assert.deepEqual(await get('cache', current.id), current);
});

test('identical public HTML at a different observation keeps separate dated receipts and removes private URL tokens', async (t) => {
  const { shared, source, app } = await setup(t);
  const first = await capture(source);
  const initial = await publishAccountDiscovery(app, source);
  await source.put('cache', {
    ...first,
    fetchedAt: secondTime,
    checkedAt: secondTime,
  });
  const later = await publishAccountDiscovery(app, source);
  assert.notEqual(initial.published[0].id, later.published[0].id);
  assert.equal(
    initial.published[0].html.sha256,
    later.published[0].html.sha256
  );
  await source.put('cache', first);
  assert.deepEqual(
    (await publishAccountDiscovery(app, source)).published,
    initial.published
  );
  const privateUrl = `${url}&sessionToken=fictional-sensitive-url`;
  await source.put('cache', {
    ...first,
    id: `search:vn:Nha Trang:${privateUrl}`,
    url: privateUrl,
    snapshot: { ...first.snapshot, url: privateUrl },
  });
  const report = await publishAccountDiscovery(app, source);
  assert.equal(report.rejected.length, 0);
  assert.doesNotMatch(JSON.stringify(report), /fictional-sensitive-url/u);
  assert.doesNotMatch(
    JSON.stringify(await shared.list('discovery-publication-source')),
    /fictional-sensitive-url/u
  );
  assert.equal(report.downloads, 0);
});
