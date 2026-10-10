import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractPage, LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
const app = new LazadaSearch({
  store: configuredStore(options),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
app.collector.start = () => {
  throw new Error('Ingredient source reparsing forbids browser access');
};
const originals = (await app.store.list('offer')).filter(
  (offer) => offer.sku?.startsWith('13430219487_') && !offer.supersededBy
);
assert.equal(originals.length, 3);
const receipts = [];
for (const original of originals) {
  const before = await app.store.get('product', original.productId);
  const evidence = await app.store.get('evidence', original.evidenceId);
  const bytes = await app.store.blob(evidence.html.sha256);
  const snapshot = extractPage({
    document: parseHTML(bytes.toString('utf8')).document,
    url: evidence.sourceUrl || evidence.url,
  });
  const parsed = parseProduct(snapshot);
  assert.equal(parsed.product.id, before.id);
  assert.equal(parsed.product.sku, original.sku);
  assert.equal(parsed.offer.price, original.price);
  assert.ok(parsed.product.ingredients.length > 0);
  assert.ok(
    parsed.product.ingredients.some((line) => /Hỗn hợp protein/u.test(line))
  );
  assert.ok(
    parsed.product.ingredients.every((line) => !/Không chứa gluten/u.test(line))
  );
  await app.review(
    before.id,
    'ingredients',
    parsed.product.ingredients,
    evidence.id
  );
  // Each variant has different immutable source bytes. The mutable main-URL
  // cache may currently hold another variant, so replay the attached capture.
  const result = await app.importCapture({
    url: evidence.sourceUrl || evidence.url,
    html: bytes.toString('utf8'),
    observedAt: original.observedAt,
  });
  assert.equal(result.cacheHit, true);
  assert.equal(result.product.sku, original.sku);
  assert.equal(result.product.observedAt, original.observedAt);
  assert.equal(result.offer.price, original.price);
  assert.equal(result.offer.observedAt, original.observedAt);
  assert.deepEqual(result.product.ingredients, parsed.product.ingredients);
  assert.equal(result.product.manufacturerVerification, undefined);
  receipts.push({
    sku: original.sku,
    sourceEvidenceId: evidence.id,
    sourceHtmlSha256: evidence.html.sha256,
    previousIngredients: before.ingredients,
    correctedMarketplaceIngredients: result.product.ingredients,
    correctedClaimedIngredientFlags: result.product.ingredientFlags,
    selectedSkuPricePreservedVnd: result.offer.price,
    observationPreserved: result.offer.observedAt,
    sourceAuthority: 'marketplace',
    manufacturerVerified: false,
    cacheHit: result.cacheHit,
  });
}
assert.equal(app.cache.stats.downloads, 0);
const report = {
  repairedAt: new Date().toISOString(),
  networkDownloads: app.cache.stats.downloads,
  storeLayer: app.store.visibility,
  sourceMethod: 'Exact immutable HTML attached to each selected SKU',
  reason:
    'Đặc điểm thành phần is a dietary feature. The genuine Thành phần line provides seller ingredient claims, with factory identity still unverified. Generic ingredients copied across flavours are retained as marketplace claims, not promoted to exact factory facts.',
  receipts,
};
await writeFile(
  `docs/acceptance/urgent-extraction-audit/${app.store.visibility}-ingredients-reprocessing-receipt.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(
  JSON.stringify({
    repairedSkuCount: receipts.length,
    preservedPricesVnd: receipts.map(
      (receipt) => receipt.selectedSkuPricePreservedVnd
    ),
    networkDownloads: report.networkDownloads,
  })
);
