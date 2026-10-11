import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { configuredStore, parseArguments } from '../src/config.js';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { sha256 } from '../src/util.js';

const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const rows = [];
let historicalSuperseded = 0;
for (const offer of await store.list('offer')) {
  if (offer.supersededBy) {
    historicalSuperseded += 1;
    continue;
  }
  if (!offer.variantConfirmed || !(offer.price > 0)) {
    continue;
  }
  const row = {
    offerId: offer.id,
    sku: offer.sku,
    price: offer.price,
    observedAt: offer.observedAt,
    evidenceId: offer.evidenceId,
  };
  try {
    const evidence = await store.get('evidence', offer.evidenceId);
    if (!evidence?.html || evidence.role !== 'listing') {
      throw new Error('Current price has no original selected listing HTML');
    }
    const bytes = await store.blob(evidence.html.sha256);
    if (!bytes || sha256(bytes) !== evidence.html.sha256) {
      throw new Error('Original selected listing HTML digest mismatch');
    }
    const snapshot = extractPage({
      document: parseHTML(bytes.toString('utf8')).document,
      url: evidence.sourceUrl || evidence.url,
    });
    const parsed = parseProduct(snapshot, { market: 'vn', currency: 'VND' });
    row.sourceSha256 = evidence.html.sha256;
    row.sourceSelectedSku = parsed.offer.sku;
    row.sourceSelectedPrice = parsed.offer.price;
    if (
      !parsed.offer.variantConfirmed ||
      parsed.offer.sku !== offer.sku ||
      parsed.offer.price !== offer.price
    ) {
      throw new Error(
        'Current price does not match the exact selected SKU in its attached original'
      );
    }
    row.matched = true;
  } catch (error) {
    row.matched = false;
    row.reason = error.message;
  }
  rows.push(row);
}
const report = {
  auditedAt: new Date().toISOString(),
  downloads: 0,
  currentConfirmedPrices: rows.length,
  matched: rows.filter((row) => row.matched).length,
  unresolved: rows.filter((row) => !row.matched).length,
  historicalSuperseded,
  rows,
};
await writeFile(
  'docs/acceptance/current-offer-source-audit.json',
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify({ ...report, rows: undefined }));
if (process.argv.includes('--strict') && report.unresolved) {
  process.exitCode = 1;
}
