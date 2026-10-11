import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { EvidenceCache } from '../src/cache.js';
import {
  exportRepositoryArchive,
  RepositoryArchive,
  sanitizePublicHtml,
} from '../src/archive.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';
import { sha256 } from '../src/util.js';

test('challenge image and manufacturer originals publish safe derivatives while preserving local bytes and a durable stop', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-challenge-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'working') });
  const url = 'https://img.lazcdn.com/challenge.jpg';
  const original =
    '<html><head><title>Just a moment...</title></head><body><div id="challenge-running">Verify you are human</div><a href="https://img.lazcdn.com/challenge.jpg?__cf_chl_tk=private-value&size=large">Retry</a><script>window.sessionToken="private-value"</script></body></html>';
  const blob = await store.putBlob(original);
  const challenge = { detected: true, url, signals: ['challenge-markup'] };
  for (const [kind, id] of [
    ['cache', `image:${url}`],
    ['manufacturer-source', 'maker-challenge'],
  ]) {
    await store.put(kind, {
      id,
      url,
      blob,
      sourceSha256: blob.sha256,
      status: 'failed',
      contentType: 'image/jpeg',
      challenge,
    });
  }
  await store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    url,
    challenge,
  });
  const target = join(directory, 'archive');
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const saved = await archive.get('cache', `image:${url}`);
  const publicBytes = await archive.blob(saved.blob.sha256);
  assert.equal(saved.blob.sha256, sha256(sanitizePublicHtml(original)));
  assert.notEqual(saved.blob.sha256, blob.sha256);
  assert.doesNotMatch(
    publicBytes.toString(),
    /private-value|__cf_chl_tk|<script/u
  );
  assert.match(publicBytes.toString(), /Verify you are human|size=large/u);
  assert.equal(saved.sourceSha256, blob.sha256);
  assert.deepEqual(await store.blob(blob.sha256), Buffer.from(original));
  assert.equal(
    (await archive.get('manufacturer-source', 'maker-challenge')).blob.sha256,
    saved.blob.sha256
  );
  assert.equal(
    (await archive.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.deepEqual(
    (await archive.manifest()).sourceRewrites.map(
      ({ originalSha256, archivedSha256 }) => ({
        originalSha256,
        archivedSha256,
      })
    ),
    [{ originalSha256: blob.sha256, archivedSha256: saved.blob.sha256 }]
  );
  assert.equal((await archive.verify()).valid, true);
  assert.equal((await archive.verify()).downloads, 0);
});

test('zero-byte image failures survive archive replay without a repeated download while safe images stay exact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-negative-archive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory: join(directory, 'working') });
  const failedUrl = 'https://img.lazcdn.com/missing.jpg';
  const empty = await store.putBlob(Buffer.alloc(0));
  await store.put('cache', {
    id: `image:${failedUrl}`,
    url: failedUrl,
    blob: empty,
    status: 'failed',
    httpStatus: 404,
    contentType: 'image/jpeg',
    sourceSha256: empty.sha256,
    error: 'Image HTTP 404',
    retryAfter: 999999,
    checkedAt: 1,
  });
  await store.put('cache', {
    id: 'image:https://img.lazcdn.com/pixel.gif',
    url: 'https://img.lazcdn.com/pixel.gif',
    blob: empty,
  });
  const imageUrl = 'https://img.lazcdn.com/label.png';
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const image = await store.putBlob(bytes);
  await store.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    blob: image,
    contentType: 'image/png',
    checkedAt: 1,
  });
  const text = await store.putBlob('Protein 20g per serving');
  await store.put('manufacturer-source', {
    id: 'plain-label',
    contentType: 'text/plain',
    blob: text,
  });
  const target = join(directory, 'archive');
  const exported = await exportRepositoryArchive({ store, directory: target });
  assert.equal(exported.records, 3);
  const archive = new RepositoryArchive({ directory: target });
  assert.equal((await archive.manifest()).excluded.emptyTrackingResponses, 1);
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  const cache = new EvidenceCache({
    store: fresh,
    offline: true,
    now: () => 100,
  });
  await assert.rejects(cache.image(failedUrl), /Image HTTP 404/u);
  assert.deepEqual(
    await fresh.blob((await cache.image(imageUrl)).blob.sha256),
    bytes
  );
  assert.deepEqual(
    await archive.blob(text.sha256),
    Buffer.from('Protein 20g per serving')
  );
  assert.equal(cache.stats.downloads, 0);
  assert.equal((await archive.verify()).valid, true);
});
