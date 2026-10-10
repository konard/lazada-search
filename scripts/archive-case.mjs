import { exportRepositoryArchive } from '../src/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { atomicWrite } from '../src/util.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { MARKETS } from '../src/application.js';

const options = parseArguments(process.argv.slice(2));
const store = configuredStore(options);
const result = await exportRepositoryArchive({
  store,
  directory: options.archiveDir,
  caseMetadata: {
    market: options.market,
    currency: MARKETS[options.market]?.currency,
    deliveryArea: options.deliveryArea,
    categories: ['whey', 'protein-powder', 'chocolate-ice-cream'],
    purpose:
      'Compare captured selected SKU prices, manufacturer specifications and freight using reusable public evidence',
    captureMode: 'public pages and redacted authenticated product captures',
    coverage: 'incomplete; see docs/tables/README.md',
  },
});
const manifestPath = join(options.archiveDir, 'manifest.json');
await atomicWrite(
  manifestPath,
  await format(await readFile(manifestPath, 'utf8'), {
    ...(await resolveConfig(manifestPath)),
    parser: 'json',
  })
);
console.log(JSON.stringify(result));
