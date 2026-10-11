import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import {
  exportRepositoryArchive,
  RepositoryArchive,
  redactPublicSecrets,
  sanitizePublicData,
} from '../src/archive.js';
import { ManufacturerSourceCache } from '../src/manufacturer-source-cache.js';
import { sha256 } from '../src/util.js';

const secret = ['sk', 'eyJzeW50aGV0aWM', 'fake_fixture_signature'].join('.');

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'public-source-redaction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    store: new AssociativeStore({ directory: join(directory, 'working') }),
  };
}

test('embedded secret redaction retains product facts and removes both public and secret access tokens', () => {
  const text = `<h1>Chocolate 450ml</h1><script>const access='${secret}'</script>`;
  assert.equal(
    redactPublicSecrets(text),
    "<h1>Chocolate 450ml</h1><script>const access='[REDACTED_MAPBOX_TOKEN]'</script>"
  );
  const publicKey = ['pk', 'eyJzeW50aGV0aWM', 'public_fixture'].join('.');
  assert.equal(sanitizePublicData(publicKey), '[REDACTED_MAPBOX_TOKEN]');
  assert.doesNotMatch(
    JSON.stringify(sanitizePublicData({ text })),
    /fake_fixture_signature/u
  );
});

test('manufacturer archive redacts embedded secrets and preserves original digests', async (t) => {
  const { directory, store } = await setup(t);
  const bytes = Buffer.from(
    `<h1>Chocolate 450ml</h1><script>'${secret}'</script>`
  );
  const blob = await store.putBlob(bytes);
  await store.put('manufacturer-source', {
    id: 'official-page',
    contentType: 'text/html; charset=utf-8',
    blob,
    sourceSha256: sha256(bytes),
    status: 'captured',
  });
  const target = join(directory, 'archive');
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const record = await archive.get('manufacturer-source', 'official-page');
  assert.equal(record.sourceSha256, sha256(bytes));
  assert.notEqual(record.blob.sha256, blob.sha256);
  assert.match(
    (await archive.blob(record.blob.sha256)).toString(),
    /Chocolate 450ml/u
  );
  assert.doesNotMatch(
    (await archive.blob(record.blob.sha256)).toString(),
    /fake_fixture_signature/u
  );
  assert.equal(await archive.blob(blob.sha256), undefined);
  assert.ok(
    (await archive.manifest()).sourceRewrites.some(
      (row) =>
        row.originalSha256 === blob.sha256 &&
        row.archivedSha256 === record.blob.sha256
    )
  );
  assert.equal((await archive.verify()).valid, true);
});

test('redacted manufacturer imports bind both original provenance and current artifact', async (t) => {
  const { store } = await setup(t);
  const cache = new ManufacturerSourceCache({
    store,
    registry: [{ brand: 'Factory', domains: ['manufacturer.example'] }],
    offline: true,
  });
  const original = Buffer.from(`<h1>Chocolate 450ml</h1>${secret}`);
  const bytes = Buffer.from(redactPublicSecrets(original.toString()));
  const request = {
    brand: 'Factory',
    url: 'https://manufacturer.example/product',
    sourceSha256: sha256(bytes),
    originalSourceSha256: sha256(original),
    redactionApplied: true,
    observedAt: '2026-10-11T00:00:00Z',
    contentType: 'text/html',
  };
  await assert.rejects(
    cache.importOriginal({ ...request, redactionApplied: false }, bytes),
    /original digest and receipt/u
  );
  await assert.rejects(
    cache.importOriginal(
      { ...request, originalSourceSha256: 'invalid' },
      bytes
    ),
    /original digest and receipt/u
  );
  const saved = await cache.importOriginal(request, bytes);
  assert.equal(saved.originalSourceSha256, sha256(original));
  assert.equal(saved.blob.sha256, sha256(bytes));
  assert.equal(saved.redactionApplied, true);
  assert.equal(saved.identityVerified, false);
  const replay = await cache.capture(request);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.originalSourceSha256, sha256(original));
});
