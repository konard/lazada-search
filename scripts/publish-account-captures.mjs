import { mkdir, writeFile } from 'node:fs/promises';
import { LazadaSearch } from '../src/application.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { publishAccountCaptures } from '../src/public-captures.js';

const options = parseArguments(process.argv.slice(2));
const source = configuredStore({
  ...options,
  account: options.account || 'default',
});
const application = new LazadaSearch({
  store: source.fallback,
  offline: true,
  ocr: false,
  market: options.market,
  deliveryArea: options.deliveryArea,
});
try {
  const report = await publishAccountCaptures(application, source);
  await mkdir('docs/acceptance', { recursive: true });
  await writeFile(
    'docs/acceptance/account-publication.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      published: report.published.length,
      rejected: report.rejected.length,
      reused: report.reused,
      downloads: report.downloads,
    })
  );
} finally {
  await application.close();
}
