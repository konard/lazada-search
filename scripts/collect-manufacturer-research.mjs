import { readFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AssociativeStore } from '../src/store.js';
import { TesseractOcr } from '../src/ocr.js';
import { ManufacturerResearch } from '../src/manufacturer-research.js';
import { atomicWrite } from '../src/util.js';

const draftRoot = resolve('.lazada-search/drafts/ice-manufacturers');

function draftPath(value) {
  const path = resolve(value);
  const suffix = relative(draftRoot, path);
  if (suffix.startsWith('..') || !suffix) {
    throw new Error(
      'Manufacturer research writes must stay inside the draft directory'
    );
  }
  return path;
}

function argumentsForResearch(argv) {
  const options = {
    store: join(draftRoot, 'store'),
    output: join(draftRoot, 'latest-report.json'),
    offline: false,
    ocr: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (['--offline', '--ocr'].includes(option)) {
      options[option.slice(2)] = true;
    } else if (['--plan', '--store', '--output'].includes(option)) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error(`${option} requires a value`);
      }
      options[option.slice(2)] = argv[++index];
    } else {
      throw new Error(`Unknown manufacturer research option: ${option}`);
    }
  }
  if (!options.plan) {
    throw new Error(
      'Use --plan <JSON plan>; captures remain unapproved drafts'
    );
  }
  options.store = draftPath(options.store);
  options.output = draftPath(options.output);
  return options;
}

const options = argumentsForResearch(process.argv.slice(2));
const plan = JSON.parse(await readFile(options.plan, 'utf8'));
const store = new AssociativeStore({ directory: options.store });
const research = new ManufacturerResearch({
  store,
  registry: plan.registry,
  offline: options.offline,
  ocr: options.ocr ? new TesseractOcr({ store }) : false,
});
const imports = [];
for (const original of plan.imports || []) {
  let bytes = await readFile(original.artifact);
  if (original.artifact.endsWith('.gz')) {
    bytes = gunzipSync(bytes);
  }
  imports.push(await research.sources.importOriginal(original, bytes));
}
const report = await research.run(plan);
await atomicWrite(
  options.output,
  `${JSON.stringify({ ...report, imports }, null, 2)}\n`
);
console.log(
  JSON.stringify({
    output: options.output,
    sourceCount: report.sources.length,
    importedSources: imports.length,
    reviews: report.reviews.length,
    failures: report.failures.length,
    cache: report.cache,
  })
);
