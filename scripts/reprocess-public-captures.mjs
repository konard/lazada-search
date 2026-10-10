import { writeFile } from 'node:fs/promises';
import { LazadaSearch } from '../src/application.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (options.account || !options.offline) {
  throw Error('Reprocess public sources with --offline and no account');
}
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
const captures = (await app.store.list('cache')).filter(
  (record) =>
    record.id.startsWith(`lazada:${app.market}:${app.deliveryArea}:`) &&
    record.status === 'ok' &&
    record.html
);
const results = [];
try {
  for (const capture of captures) {
    try {
      const result = await app.collect(capture.url, { reprocess: true });
      results.push({
        sourceUrl: capture.url,
        sku: result.offer.sku,
        price: result.offer.price,
        observedAt: result.offer.observedAt,
        cacheHit: result.cacheHit,
        category: result.product.category,
        packCount: result.product.packCount,
        netMassG: result.product.netMassG,
        netVolumeMl: result.product.netVolumeMl,
      });
    } catch (error) {
      results.push({ sourceUrl: capture.url, error: error.message });
    }
  }
  const report = {
    reprocessedAt: new Date().toISOString(),
    mode: 'offline parser corrections; original source bytes retained',
    downloads: app.cache.stats.downloads,
    captures: results.length,
    errors: results.filter((result) => result.error).length,
    results,
  };
  await writeFile(
    'docs/acceptance/offline-reprocessing.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      captures: report.captures,
      errors: report.errors,
      downloads: report.downloads,
    })
  );
} finally {
  await app.close();
}
