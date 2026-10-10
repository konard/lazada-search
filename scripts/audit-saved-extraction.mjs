import { mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { inspectPageReadiness } from '../src/page-readiness.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error('Audit redacted public product evidence, not account HTML');
}
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
const report = {
  startedAt: new Date().toISOString(),
  checked: [],
  errors: [],
  recollectionAfterInitialPass: [],
};
const sources = (await app.store.list('cache')).filter(
  (capture) =>
    capture.id.startsWith(`lazada:${app.market}:`) &&
    capture.status === 'ok' &&
    capture.html
);
const seen = new Set();
await mkdir('docs/acceptance', { recursive: true });
try {
  for (const capture of sources) {
    const expected = parseProduct(capture.snapshot).offer;
    const key = `${capture.html.sha256}:${expected.sku}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    try {
      const bytes = await app.store.blob(capture.html.sha256);
      const { document } = parseHTML(bytes.toString());
      const readiness = inspectPageReadiness({ document, url: capture.url });
      const result = await app.collect(capture.url);
      if (
        result.offer.sku !== expected.sku ||
        result.offer.price !== expected.price
      ) {
        throw new Error(
          'Saved selected SKU or price changed during extraction replay'
        );
      }
      const record = {
        id: `extraction-audit:${key}`,
        url: capture.url,
        productId: result.product.id,
        sku: result.offer.sku,
        price: result.offer.price,
        originalPrice: result.offer.originalPrice,
        netMassG: result.product.netMassG,
        netVolumeMl: result.product.netVolumeMl,
        packCount: result.product.packCount,
        sourceHtml: capture.html,
        checkedAt: new Date().toISOString(),
        priceAndSkuMatch: true,
        loadingMarkers: readiness.blockers,
        needsVisualReview: true,
      };
      await app.store.put('extraction-audit', record);
      report.checked.push(record);
      if (readiness.blockers.length) {
        report.recollectionAfterInitialPass.push({
          url: capture.url,
          reason:
            'Saved HTML still contains loading placeholders; visibility and missing content need review',
          loadingMarkers: readiness.blockers,
          priority: 'after-initial-collection',
        });
      }
    } catch (error) {
      report.errors.push({ url: capture.url, error: error.message });
    }
  }
} finally {
  await app.close();
  report.finishedAt = new Date().toISOString();
  report.cache = app.cache.stats;
  await writeFile(
    'docs/acceptance/saved-extraction-audit.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
}
console.log(
  JSON.stringify({
    checked: report.checked.length,
    errors: report.errors.length,
    recollectionAfterInitialPass: report.recollectionAfterInitialPass.length,
    cache: report.cache,
  })
);
