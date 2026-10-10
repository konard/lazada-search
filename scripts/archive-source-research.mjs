import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AssociativeStore,
  RepositoryArchive,
  exportRepositoryArchive,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'evidence-archive' ||
      entry.name === 'archive-validation.json'
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    files.push(...(entry.isDirectory() ? await filesIn(path) : [path]));
  }
  return files.sort();
}

for (const name of process.argv.slice(2)) {
  assert.match(name, /^[a-z][a-z-]+$/u);
  const root = `docs/acceptance/${name}`;
  const store = new AssociativeStore({
    directory: `/private/tmp/lazada-research-${name}`,
  });
  const artifacts = [];
  for (const path of await filesIn(root)) {
    const bytes = await readFile(path);
    const original = await store.putBlob(bytes);
    artifacts.push(
      await store.put('research-artifact', {
        id: `research:${sha256(path)}`,
        path,
        original,
        contentSha256: original.sha256,
        publicEvidenceOnly: true,
      })
    );
  }
  const directory = `${root}/evidence-archive`;
  const exported = await exportRepositoryArchive({
    store,
    directory,
    caseMetadata: {
      market: 'Vietnam',
      deliveryArea: 'Nha Trang',
      scope: name,
      publicEvidenceOnly: true,
      complete: false,
      downloads: 0,
    },
  });
  const replay = new RepositoryArchive({ directory });
  const verification = await replay.verify();
  assert.equal(verification.valid, true);
  for (const artifact of artifacts) {
    assert.equal(
      sha256(await replay.blob(artifact.original.sha256)),
      artifact.contentSha256
    );
  }
  const receipt = {
    validatedAt: new Date().toISOString(),
    downloads: 0,
    originalArtifacts: artifacts.length,
    exported,
    verification,
  };
  await writeFile(
    `${root}/archive-validation.json`,
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      root,
      originalArtifacts: artifacts.length,
      valid: verification.valid,
      downloads: 0,
    })
  );
}
