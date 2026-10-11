import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { ManufacturerSourceCache } from '../src/manufacturer-source-cache.js';
import { MANUFACTURERS } from '../src/manufacturers.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { COLLECTION_STOP_ID } from '../src/page-challenge.js';
import { sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
assert.ok(options.offline && !options.account, 'Use a public offline store');
const directory =
  'docs/acceptance/source-integrity/natural-chocolate-manufacturer';
const receipt = JSON.parse(
  await readFile(
    `${directory}/official-natural-whey.http403.source.json`,
    'utf8'
  )
);
const bytes = gunzipSync(await readFile(receipt.publicPath));
assert.equal(sha256(bytes), receipt.publicSha256);
assert.equal(bytes.length, receipt.publicBytes);
assert.equal(receipt.httpStatus, 403);
assert.equal(receipt.isOriginalManufacturerProductHtml, false);
const store = configuredStore(options);
const cache = new ManufacturerSourceCache({
  store,
  registry: MANUFACTURERS.map((entry) => ({ ...entry, brand: entry.name })),
  offline: true,
});
try {
  await cache.importOriginal(
    {
      brand: 'Optimum Nutrition',
      url: receipt.url,
      kind: 'page',
      status: 'failed',
      httpStatus: receipt.httpStatus,
      contentType: 'text/html',
      observedAt: new Date(receipt.observedAt).toISOString(),
      sourceSha256: receipt.publicSha256,
      originalSourceSha256: receipt.originalSha256,
      redactionApplied: true,
      originalArtifact: receipt.publicPath,
    },
    bytes
  );
  assert.fail('Known original challenge must persist a collection stop');
} catch (error) {
  if (error.code !== 'COLLECTION_STOPPED') {
    throw error;
  }
  const source = await store.get(
    'manufacturer-source',
    error.challenge.sourceId
  );
  assert.equal(source.status, 'failed');
  assert.equal(source.httpStatus, 403);
  assert.equal(source.blob.sha256, receipt.publicSha256);
  const stop = await store.get('collection-stop', COLLECTION_STOP_ID);
  assert.equal(stop.active, true);
  assert.equal(stop.origin, new URL(receipt.url).origin);
  const result = {
    recordedAt: new Date().toISOString(),
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
    originalSourceSha256: source.originalSourceSha256,
    sourceObservedAt: source.observedAt,
    httpStatus: source.httpStatus,
    status: source.status,
    collectionStop: stop,
    downloads: cache.cache.stats.downloads,
    resumed: false,
    manufacturerFactsApproved: false,
  };
  assert.equal(result.downloads, 0);
  await writeFile(
    `${directory}/collection-stop.json`,
    `${JSON.stringify(result, null, 2)}\n`
  );
  console.log(JSON.stringify(result));
}
