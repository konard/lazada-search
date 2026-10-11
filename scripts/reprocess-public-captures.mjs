import { writeFile } from 'node:fs/promises';
import { LazadaSearch } from '../src/application.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { replayHistoricalCaptures } from '../src/historical-capture-replay.js';

const options = parseArguments(process.argv.slice(2));
if (options.account || !options.offline) {
  throw Error('Reprocess public sources with --offline and no account');
}
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
try {
  const report = await replayHistoricalCaptures(app);
  await writeFile(
    'docs/acceptance/offline-reprocessing.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      captures: report.captures,
      reprocessed: report.reprocessed,
      reused: report.reused,
      errors: report.errors,
      downloads: report.downloads,
    })
  );
} finally {
  await app.close();
}
