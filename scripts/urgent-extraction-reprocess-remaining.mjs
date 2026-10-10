import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractPage, LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';

const directory = 'docs/acceptance/urgent-extraction-audit';
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
const receipts = [];
for (const sku of [
  '367656830_VNAMZ-116917756014',
  '13479894070_VNAMZ-117397989208',
]) {
  const originals = (await app.store.list('offer')).filter(
    (offer) => offer.sku === sku && !offer.supersededBy
  );
  assert.ok(originals.length > 0);
  assert.equal(new Set(originals.map((offer) => offer.price)).size, 1);
  assert.equal(new Set(originals.map((offer) => offer.observedAt)).size, 1);
  const original = originals[0];
  const product = await app.store.get('product', original.productId);
  const evidence = await app.store.get('evidence', original.evidenceId);
  const bytes = await app.store.blob(evidence.html.sha256);
  assert.ok(bytes);
  const snapshot = extractPage({
    document: parseHTML(bytes.toString('utf8')).document,
    url: evidence.sourceUrl || evidence.url,
  });
  const { product: parsed, offer: parsedOffer } = parseProduct(snapshot, {
    market: 'vn',
    currency: 'VND',
    observedAt: original.observedAt,
    evidenceId: evidence.id,
  });
  assert.equal(parsed.sku, sku);
  assert.equal(parsedOffer.price, original.price);
  if (sku.startsWith('367656830_')) {
    assert.ok(
      snapshot.selectedVariant.some((option) => option.text === 'COMBO 5 cây')
    );
    assert.match(snapshot.description, /Trọng lượng\s*:\s*40g\/ cây/u);
    assert.equal(parsed.netMassG, 40);
    assert.equal(parsed.packCount, 5);
    assert.equal(parsed.id, product.id);
    await app.review(product.id, 'netMassG', 40, evidence.id);
    await app.review(product.id, 'packCount', 5, evidence.id);
  } else {
    assert.equal(parsed.netMassG, undefined);
    assert.equal(parsed.packCount, 18);
  }
  const repaired = await app.collect(product.url, { reprocess: true });
  assert.equal(repaired.cacheHit, true);
  assert.equal(repaired.product.sku, sku);
  assert.equal(repaired.product.observedAt, original.observedAt);
  assert.equal(repaired.offer.price, original.price);
  assert.equal(repaired.offer.observedAt, original.observedAt);
  assert.equal(repaired.product.netMassG, parsed.netMassG);
  assert.equal(repaired.product.packCount, parsed.packCount);
  assert.equal(repaired.product.manufacturerVerification, undefined);
  const active = (await app.store.list('offer')).filter(
    (offer) => offer.sku === sku && !offer.supersededBy
  );
  assert.equal(active.length, 1);
  receipts.push({
    sku,
    sourceUrl: product.url,
    sourceEvidenceId: evidence.id,
    sourceHtmlSha256: evidence.html.sha256,
    selectedOptions: [...new Set(snapshot.selectedVariant.map((v) => v.text))],
    sourceDeclaredPerPackMassG: repaired.product.netMassG ?? null,
    sourceDeclaredSellingPackCount: repaired.product.packCount,
    sourceDeclaredSellingMassG: repaired.product.netMassG
      ? repaired.product.netMassG * repaired.product.packCount
      : null,
    selectedSkuPricePreservedVnd: repaired.offer.price,
    observationPreserved: repaired.offer.observedAt,
    previousActiveOfferCount: originals.length,
    correctedActiveOfferCount: active.length,
    supersededOfferIds: originals
      .filter((offer) => offer.id !== active[0].id)
      .map((offer) => offer.id),
    cacheHit: repaired.cacheHit,
    manufacturerVerified: false,
    frozenDeliveryConfirmed: false,
    correctionReason: sku.startsWith('367656830_')
      ? 'Selected COMBO 5 cây and 40g/cây give 200g total. Generic 40-stick carton description is not the selected selling unit; stale duplicate offer superseded.'
      : '22g Whey Isolate Mỗi Lần Dùng is a protein-per-serving claim. No powder net mass is declared; retain 18 selected sticks without inventing per-stick mass.',
  });
}
assert.equal(browserAttempts, 0);
const merino = (await app.compare({ allowStale: true })).comparisons.filter(
  (row) => row.offer.sku === '367656830_VNAMZ-116917756014'
);
assert.equal(merino.length, 1);
assert.equal(merino[0].metrics.totalMassG, 200);
assert.equal(merino[0].metrics.costPerGramBeforeDelivery, 195);
assert.ok(
  !merino[0].problems.some((problem) => problem.includes('Conflicting package'))
);
assert.equal(merino[0].eligible, false);
const report = {
  repairedAt: new Date().toISOString(),
  networkDownloads: 0,
  browserAttempts,
  merinoComparisonMassG: merino[0].metrics.totalMassG,
  merinoComparisonVndPerGBeforeDelivery:
    merino[0].metrics.costPerGramBeforeDelivery,
  merinoPurchaseEligible: merino[0].eligible,
  receipts,
};
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}/remaining-reprocessing-receipt.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report));
