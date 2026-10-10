import { writeFile } from 'node:fs/promises';
import { LazadaSearch, publishAccountDiscovery } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

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
  // Only search cards and pagination are published. Product/checkout captures
  // are outside this publication path.
  const selectedUrls = options._;
  const selectedSource = selectedUrls.length
    ? {
        visibility: source.visibility,
        blob: (digest) => source.blob(digest),
        list: async (kind) =>
          (await source.list(kind)).filter(
            (record) => kind !== 'cache' || selectedUrls.includes(record.url)
          ),
      }
    : source;
  const report = await publishAccountDiscovery(application, selectedSource);
  const selectedPublished = report.published.length;
  report.published = await application.store.list('discovery-publication');
  await writeFile(
    'docs/acceptance/discovery-publication.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      searchPages: report.published.length,
      selectedPublished,
      rejected: report.rejected.length,
      downloads: report.downloads,
    })
  );
} finally {
  await application.close();
}
