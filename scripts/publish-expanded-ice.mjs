import { writeFile } from 'node:fs/promises';
import { LazadaSearch } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { publishAccountCaptures } from '../src/public-captures.js';

const options = parseArguments(process.argv.slice(2));
const source = configuredStore({
  ...options,
  account: options.account || 'default',
});
const targets = new Set([
  '3047760589',
  '2042294681',
  '2042258411',
  '3040048563',
]);
const selectedSource = {
  visibility: source.visibility,
  list: async (kind) =>
    (await source.list(kind)).filter(
      (value) =>
        kind !== 'cache' ||
        targets.has(value.snapshot?.sku?.split('_VNAMZ-')[0])
    ),
  blob: (...args) => source.blob(...args),
  get: (...args) => source.get(...args),
};
const app = new LazadaSearch({
  store: source.fallback,
  offline: true,
  ocr: false,
  market: 'vn',
  deliveryArea: 'Nha Trang',
});
try {
  const report = await publishAccountCaptures(app, selectedSource);
  await writeFile(
    'docs/acceptance/ice-dual-units/expanded-publication.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      published: report.published.length,
      rejected: report.rejected,
      downloads: report.downloads,
    })
  );
} finally {
  await app.close();
}
