import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractPage, LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';

const app = new LazadaSearch({
  store: configuredStore({
    dataDir: '.lazada-search',
    archiveDir: 'data/cases/vietnam-nha-trang',
  }),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
app.collector.start = () => {
  throw new Error('Public cached repair forbids browser access');
};
const sku = '13479894070_VNAMZ-117397989208';
const original = (await app.store.list('offer')).find(
  (offer) => offer.sku === sku && !offer.supersededBy
);
assert.ok(original);
const before = await app.store.get('product', original.productId);
const evidence = await app.store.get('evidence', original.evidenceId);
const bytes = await app.store.blob(evidence.html.sha256);
const parsed = parseProduct(
  extractPage({
    document: parseHTML(bytes.toString('utf8')).document,
    url: evidence.sourceUrl || evidence.url,
  })
);
assert.equal(parsed.product.sku, sku);
assert.equal(parsed.product.netMassG, undefined);
assert.equal(parsed.product.packCount, 18);
assert.equal(parsed.offer.price, original.price);
const result = await app.collect(before.url, { reprocess: true });
assert.equal(result.cacheHit, true);
assert.equal(result.product.sku, sku);
assert.equal(result.product.netMassG, undefined);
assert.equal(result.product.packCount, 18);
assert.equal(result.offer.price, original.price);
assert.equal(result.offer.observedAt, original.observedAt);
assert.equal(result.product.observedAt, before.observedAt);
assert.equal(app.cache.stats.downloads, 0);
const comparison = (await app.compare({ allowStale: true })).comparisons.find(
  (row) => row.offer.sku === sku
);
assert.equal(comparison.metrics.totalMassG, null);
const receipt = {
  repairedAt: new Date().toISOString(),
  storeLayer: 'public repository cache',
  sku,
  sourceEvidenceId: evidence.id,
  sourceHtmlSha256: evidence.html.sha256,
  previousMassG: before.netMassG ?? null,
  correctedMassG: null,
  retainedStickCount: result.product.packCount,
  selectedSkuPricePreservedVnd: result.offer.price,
  observationPreserved: result.offer.observedAt,
  cacheHit: true,
  networkDownloads: app.cache.stats.downloads,
  correctedComparisonTotalMassG: comparison.metrics.totalMassG,
  reason:
    '22g is protein per serving. The public 18-stick record cannot retain a false 396g powder denominator; exact cached reprocessing removes it without inferring package mass.',
};
await writeFile(
  'docs/acceptance/urgent-extraction-audit/public-seeq-reprocessing-receipt.json',
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
