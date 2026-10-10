import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  AssociativeStore,
  RepositoryArchive,
  exportRepositoryArchive,
} from '../src/index.js';
import { sanitizePublicHtml } from '../src/archive.js';
import { sha256 } from '../src/util.js';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-archive-provenance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    store: new AssociativeStore({ directory: join(directory, 'working') }),
    target: join(directory, 'archive'),
  };
}

test('new and reused source blobs carry their stored-reference identity through a private fallback', async (t) => {
  const { directory, store } = await setup(t);
  const bytes = Buffer.from('Original label: chocolate ☃');
  const reference = await store.putBlob(bytes);
  assert.deepEqual(reference, {
    type: 'stored-blob',
    sha256: sha256(bytes),
    bytes: bytes.length,
  });
  assert.deepEqual(await store.putBlob(bytes), reference);
  const account = new AssociativeStore({
    directory: join(directory, 'private'),
    visibility: 'private',
    fallback: store,
  });
  assert.deepEqual(await account.putBlob(bytes), reference);
  assert.deepEqual(await account.blob(reference.sha256), bytes);
});

test('typed and legacy HTML references redact together while descriptive digests and nested label references remain intact', async (t) => {
  const { store, target } = await setup(t);
  const originalHtml =
    '<h1>Chocolate ice cream 40g</h1><script>window.accessToken="private"</script>';
  const html = await store.putBlob(originalHtml);
  const label = await store.putBlob('Manufacturer chocolate label');
  const legacy = { sha256: html.sha256, bytes: html.bytes };
  const provenance = {
    sha256: html.sha256,
    bytes: html.bytes,
    artifactSha256: sha256(sanitizePublicHtml(originalHtml)),
    description: 'Original capture digest describes provenance',
    label,
  };
  const sourceDigest = {
    type: 'source-digest',
    sha256: html.sha256,
    bytes: html.bytes,
  };
  await store.put('research-attempt', {
    id: 'provenance',
    legacy: { html: legacy },
    typed: { html },
    provenance,
    sourceDigest,
  });
  const exported = await exportRepositoryArchive({ store, directory: target });
  assert.equal(exported.blobs, 2);
  const archive = new RepositoryArchive({ directory: target });
  const saved = await archive.get('research-attempt', 'provenance');
  assert.deepEqual(saved.provenance, provenance);
  assert.deepEqual(saved.sourceDigest, sourceDigest);
  assert.equal(saved.typed.html.type, 'stored-blob');
  assert.equal(saved.legacy.html.type, undefined);
  assert.equal(saved.typed.html.sha256, saved.legacy.html.sha256);
  assert.notEqual(saved.typed.html.sha256, html.sha256);
  assert.equal(await archive.blob(html.sha256), undefined);
  assert.doesNotMatch(
    (await archive.blob(saved.typed.html.sha256)).toString(),
    /accessToken|private/u
  );
  assert.deepEqual(
    await archive.blob(saved.provenance.label.sha256),
    Buffer.from('Manufacturer chocolate label')
  );
  assert.deepEqual((await archive.manifest()).sourceRewrites, [
    {
      originalSha256: html.sha256,
      archivedSha256: saved.typed.html.sha256,
      reason:
        'Remove private account/session fields and tracking/security URL parameters; remove executable HTML scripts while retaining product DOM and structured SKU data',
    },
  ]);
  assert.equal((await archive.verify()).valid, true);
  assert.equal(
    (await exportRepositoryArchive({ store, directory: target })).rebuilt,
    0
  );
});

test('the actual Merino original-capture metadata round-trips alongside its differently hashed sanitized artifact', async (t) => {
  const { directory, store, target } = await setup(t);
  const review = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/ice-dual-units/merino-review.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const sourceCapture = review.sourceCaptures.find(
    (capture) => capture.exactSku === '367656830_VNAMZ-610790405'
  );
  assert.equal(
    sourceCapture.sha256,
    'a52e71d56692a8645ba5da09fe96a7f3914691930f3d9253f2abca83a71a1414'
  );
  const bytes = gunzipSync(
    await readFile(new URL(`../${sourceCapture.artifactPath}`, import.meta.url))
  );
  const artifact = await store.putBlob(bytes);
  assert.equal(artifact.sha256, sourceCapture.artifactSha256);
  assert.notEqual(artifact.sha256, sourceCapture.sha256);
  assert.equal(await store.blob(sourceCapture.sha256), undefined);
  const record = {
    id: 'ice-review:merino',
    original: await store.putBlob(JSON.stringify({ sourceCapture })),
    review: {
      sourceCaptures: [sourceCapture],
      reviews: [{ id: 'merino-chocolate', sourceCapture }],
    },
    artifact,
  };
  await store.put('ice-review', record);
  const exported = await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  assert.equal(exported.blobs, 2);
  assert.deepEqual(await archive.get('ice-review', record.id), record);
  assert.deepEqual(await archive.blob(artifact.sha256), bytes);
  assert.equal((await archive.verify()).downloads, 0);
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  const replayTarget = join(directory, 're-export');
  await exportRepositoryArchive({ store: fresh, directory: replayTarget });
  const replay = new RepositoryArchive({ directory: replayTarget });
  assert.deepEqual(await replay.get('ice-review', record.id), record);
  assert.deepEqual(await replay.blob(artifact.sha256), bytes);
  assert.equal((await replay.verify()).valid, true);
});

test('an archive-backed re-export preserves inherited original-to-redacted relations without requiring the removed original capture', async (t) => {
  const { directory, store, target } = await setup(t);
  const url = 'https://www.lazada.vn/products/pdp-i12.html';
  const original = await store.putBlob(
    '<h1>Chocolate whey 500g</h1><script>window.sessionId="private"</script>'
  );
  await store.put('cache', { id: `page:${url}`, url, html: original });
  await exportRepositoryArchive({ store, directory: target });
  const archive = new RepositoryArchive({ directory: target });
  const captured = await archive.get('cache', `page:${url}`);
  const rewrites = (await archive.manifest()).sourceRewrites;
  const fresh = new AssociativeStore({
    directory: join(directory, 'fresh'),
    archive,
  });
  await fresh.put('review', {
    id: 'original-provenance',
    sourceCapture: {
      sha256: original.sha256,
      bytes: original.bytes,
      artifactSha256: captured.html.sha256,
      redacted: true,
    },
    artifact: captured.html,
  });
  assert.equal(await fresh.blob(original.sha256), undefined);
  const revised = join(directory, 'revised');
  await exportRepositoryArchive({ store: fresh, directory: revised });
  const replay = new RepositoryArchive({ directory: revised });
  assert.deepEqual((await replay.manifest()).sourceRewrites, rewrites);
  assert.equal(
    (await replay.get('review', 'original-provenance')).sourceCapture.sha256,
    original.sha256
  );
  assert.equal((await replay.verify()).valid, true);
});

for (const type of ['stored-blob', 'legacy']) {
  test(`a missing ${type} reference fails without replacing the earlier valid archive`, async (t) => {
    const { store, target } = await setup(t);
    await store.put('review', {
      id: 'prior',
      title: 'Verified original source',
    });
    await exportRepositoryArchive({ store, directory: target });
    const before = await readFile(join(target, 'manifest.json'));
    await store.put('review', {
      id: 'missing',
      source: {
        ...(type === 'stored-blob' ? { type } : {}),
        sha256: 'a'.repeat(64),
        bytes: 10,
      },
    });
    await assert.rejects(
      exportRepositoryArchive({ store, directory: target }),
      /Missing source evidence/u
    );
    assert.deepEqual(await readFile(join(target, 'manifest.json')), before);
    assert.equal(
      (await new RepositoryArchive({ directory: target }).verify()).valid,
      true
    );
  });
}

test('corrupt stored evidence and malformed explicit references cannot be mistaken for metadata', async (t) => {
  const { store, target } = await setup(t);
  const original = await store.putBlob('Original manufacturer nutrition label');
  await store.put('review', { id: 'verified', source: original });
  await exportRepositoryArchive({ store, directory: target });
  const before = await readFile(join(target, 'manifest.json'));
  await writeFile(
    join(
      store.directory,
      'blobs',
      original.sha256.slice(0, 2),
      original.sha256
    ),
    'Corrupted label'
  );
  await assert.rejects(
    exportRepositoryArchive({ store, directory: target }),
    /Corrupt evidence blob/u
  );
  await writeFile(
    join(
      store.directory,
      'blobs',
      original.sha256.slice(0, 2),
      original.sha256
    ),
    'Original manufacturer nutrition label'
  );
  await store.put('review', {
    id: 'malformed',
    source: { type: 'stored-blob', sha256: 'invalid', bytes: -1 },
  });
  await assert.rejects(
    exportRepositoryArchive({ store, directory: target }),
    /Invalid stored blob reference/u
  );
  assert.deepEqual(await readFile(join(target, 'manifest.json')), before);
  assert.equal(
    (await new RepositoryArchive({ directory: target }).verify()).valid,
    true
  );
});
