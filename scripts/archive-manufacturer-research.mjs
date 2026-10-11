import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { configuredStore, parseArguments } from '../src/config.js';
import { AssociativeStore } from '../src/store.js';
import { ManufacturerResearch } from '../src/manufacturer-research.js';
import { MANUFACTURERS } from '../src/manufacturers.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/manufacturer-research';
const plan = JSON.parse(
  await readFile(process.argv[2] || `${directory}/cached-primary-plan.json`)
);
const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const research = new ManufacturerResearch({
  store,
  offline: true,
  registry: MANUFACTURERS.map(({ name, domains, assetDomains }) => ({
    brand: name,
    domains,
    assetDomains,
  })),
});
const imports = [];
for (const original of plan.imports || []) {
  let bytes = await readFile(original.artifact);
  if (original.artifact.endsWith('.gz')) {
    bytes = gunzipSync(bytes);
  }
  imports.push(
    await research.sources.importOriginal(
      { ...original, originalArtifact: original.artifact },
      bytes
    )
  );
}

// Optional OCR handoff accepts only records bound to these official images.
const imageHashes = new Set(
  imports
    .filter((source) => source.kind === 'label')
    .map((source) => source.blob.sha256)
);
const ocrStore = process.argv[3]
  ? new AssociativeStore({ directory: process.argv[3] })
  : store;
const importedOcr = [];
for (const record of await ocrStore.list('ocr')) {
  if (!imageHashes.has(record.imageHash)) {
    continue;
  }
  const bytes = await ocrStore.blob(record.rawTsv?.sha256);
  if (!bytes || sha256(bytes) !== record.rawTsv.sha256) {
    throw new Error('Manufacturer OCR handoff lacks intact original TSV');
  }
  await store.putBlob(bytes);
  importedOcr.push(await store.put('ocr', record));
}
const report = { ...(await research.run(plan)), imports, importedOcr };
await writeFile(
  `${directory}/replay.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(
  JSON.stringify({
    sources: report.sources.length,
    imports: imports.length,
    importedOcr: importedOcr.length,
    failures: report.failures.length,
    cache: report.cache,
    approvedReviews: report.reviews.length,
  })
);
