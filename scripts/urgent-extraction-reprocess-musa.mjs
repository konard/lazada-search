import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractPage, LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';

const directory = 'docs/acceptance/urgent-extraction-audit';
const sku = '13345064562_VNAMZ-116655386745';
const app = new LazadaSearch({
  store: configuredStore({
    account: 'default',
    dataDir: '.lazada-search',
    archiveDir: 'data/cases/vietnam-nha-trang',
  }),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
let browserAttempts = 0;
app.collector.start = () => {
  browserAttempts += 1;
  throw new Error('Cached extraction repair forbids browser access');
};
const before = (await app.store.list('product')).find(
  (product) => product.sku === sku
);
assert.ok(before, 'The exact captured selected SKU must exist');
const originalOffer = (await app.store.list('offer')).find(
  (offer) => offer.productId === before.id && !offer.supersededBy
);
assert.ok(originalOffer?.price > 0);
const evidence = await app.store.get('evidence', originalOffer.evidenceId);
assert.ok(before.evidenceIds.includes(evidence.id));
const bytes = await app.store.blob(evidence.html.sha256);
assert.ok(bytes, 'Repair must use the attached exact source bytes');
const snapshot = extractPage({
  document: parseHTML(bytes.toString('utf8')).document,
  url: evidence.sourceUrl || evidence.url,
});
const extracted = parseProduct(snapshot, {
  market: 'vn',
  currency: 'VND',
  observedAt: before.observedAt,
  evidenceId: evidence.id,
});
assert.equal(extracted.product.sku, sku);
assert.equal(extracted.product.id, before.id);
assert.match(snapshot.title, /Combo 2 Túi/iu);
assert.ok(
  snapshot.selectedVariant.some((option) => option.text === 'Chocolate')
);
assert.equal(extracted.product.netMassG, 500);
assert.equal(extracted.product.packCount, 2);
assert.equal(extracted.offer.price, originalOffer.price);
for (const [field, value] of Object.entries({ netMassG: 500, packCount: 2 })) {
  if (before[field] !== value || !before.reviewedFields?.includes(field)) {
    await app.review(before.id, field, value, evidence.id);
  }
}
const repaired = await app.collect(before.url, { reprocess: true });
assert.equal(repaired.cacheHit, true);
assert.equal(repaired.product.sku, sku);
assert.equal(repaired.product.netMassG, 500);
assert.equal(repaired.product.packCount, 2);
assert.equal(repaired.product.observedAt, before.observedAt);
assert.equal(repaired.offer.price, originalOffer.price);
assert.equal(repaired.offer.observedAt, originalOffer.observedAt);
assert.equal(repaired.product.manufacturerVerification, undefined);
assert.equal(browserAttempts, 0);
const receipt = {
  repairedAt: new Date().toISOString(),
  sku,
  productId: before.id,
  sourceUrl: before.url,
  sourceEvidenceId: evidence.id,
  sourceHtmlSha256: evidence.html.sha256,
  storeLayer: 'private cached observation',
  sellingTitle: snapshot.title,
  selectedOptions: [...new Set(snapshot.selectedVariant.map((v) => v.text))],
  sourceDeclaredPerBagMassG: 500,
  sourceDeclaredSellingBagCount: 2,
  previous: { netMassG: before.netMassG, packCount: before.packCount ?? null },
  corrected: { netMassG: 500, packCount: 2, sellingMassG: 1000 },
  observationPreserved: repaired.product.observedAt,
  selectedSkuPricePreservedVnd: repaired.offer.price,
  cacheHit: repaired.cacheHit,
  networkDownloads: 0,
  browserAttempts,
  manufacturerVerified: false,
  correctionReason:
    '1G in the title is sugar per serving. The exact selected chocolate listing title explicitly sells two 500G bags. Marketplace selling-unit review does not prove factory nutrition or authenticity.',
};
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}/musa-combo-reprocessing-receipt.json`,
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
