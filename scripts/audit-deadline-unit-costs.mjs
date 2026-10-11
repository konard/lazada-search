import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { parseHTML } from 'linkedom';
import { LazadaSearch, extractPage, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';
import { sha256 } from '../src/util.js';
import { auditHandpickedGramOrder } from './audit-report-order.mjs';

const report = JSON.parse(
  await readFile('docs/tables/top-10-partial.json', 'utf8')
);
const iceUnits = JSON.parse(
  await readFile('docs/tables/ice-unit-rankings.json', 'utf8')
);
const handpicked = JSON.parse(
  await readFile('docs/tables/handpicked.json', 'utf8')
);
for (const [metric, rows] of Object.entries(iceUnits.rankings)) {
  assert.ok(rows.length <= 10, metric);
  assert.equal(new Set(rows.map((row) => row.sku)).size, rows.length, metric);
  for (const [index, row] of rows.entries()) {
    assert.ok(Number.isFinite(row[metric]) && row[metric] > 0, row.sku);
    assert.notEqual(row.available, false, row.sku);
    assert.notEqual(row.strictChocolateEligible, false, row.sku);
    assert.ok(index === 0 || rows[index - 1][metric] <= row[metric], metric);
    if (metric.startsWith('after')) {
      assert.equal(row.deliveryQuoteMatched, true, row.sku);
    }
  }
}
assert.equal(handpicked.rows.length, 6);
const handpickedOrder = auditHandpickedGramOrder(handpicked.rows);
const reviews = await Promise.all(
  ['whey', 'ice'].map(async (type) =>
    JSON.parse(
      await readFile(
        `docs/acceptance/top10-check/${type}-source-review.json`,
        'utf8'
      )
    )
  )
);
const checked = [];
const app = new LazadaSearch({
  store: configuredStore({}),
  offline: true,
  ocr: false,
});
const comparisons = (await app.compare({ allowStale: true })).comparisons;
for (const [group, rows] of [
  ['whey', report.whey],
  ['whey-protein', report.verifiedProtein],
  ['ice-cream', report.iceCream],
  ['ice-unit', iceUnits.rows],
  [
    'handpicked',
    handpicked.rows.map((row) => ({
      ...row.costs,
      sku: row.exactSku,
      price: row.priceVnd,
      manufacturerVerified: row.manufacturerVerified,
    })),
  ],
]) {
  if (group.startsWith('whey')) {
    assert.equal(rows.length, 10);
  } else {
    assert.ok(rows.length > 0, 'Every published selected SKU must be audited');
  }
  for (const row of rows) {
    const results = {};
    for (const [denominator, before, after] of [
      ['massG', 'beforePerFoodGram', 'afterPerFoodGram'],
      ['volumeMl', 'beforePerMl', 'afterPerMl'],
      ['proteinG', 'beforePerProteinGram', 'afterPerProteinGram'],
    ]) {
      if (row[denominator] > 0) {
        assert.ok(
          Math.abs(row[before] - row.totalBeforeDelivery / row[denominator]) <
            1e-9,
          row.sku
        );
        if (row.totalAfterDelivery !== null) {
          assert.ok(
            Math.abs(row[after] - row.totalAfterDelivery / row[denominator]) <
              1e-9,
            row.sku
          );
        } else {
          assert.equal(row[after], null);
        }
        results[denominator] = 'arithmetic matched';
      } else {
        assert.equal(row[before], null);
        assert.equal(row[after], null);
        results[denominator] = 'not declared; no conversion';
      }
    }
    const original = comparisons.find((r) => r.offer.sku === row.sku);
    assert.ok(original, row.sku);
    const evidence = await app.store.get('evidence', original.offer.evidenceId);
    assert.ok(evidence?.html, row.sku);
    const html = await app.store.blob(evidence.html.sha256);
    assert.equal(sha256(html), evidence.html.sha256);
    const parsed = parseProduct(
      extractPage({
        document: parseHTML(html.toString()).document,
        url: evidence.sourceUrl || evidence.url,
      })
    );
    assert.equal(parsed.offer.sku, row.sku);
    assert.equal(parsed.offer.price, row.price);
    checked.push({
      group,
      sku: row.sku,
      price: row.price,
      massG: row.massG,
      volumeMl: row.volumeMl,
      proteinG: row.proteinG,
      results,
      exactSourcePriceMatched: true,
      sourceHash: evidence.html.sha256,
      specificationVerified: row.manufacturerVerified ?? false,
    });
  }
}
await app.close();
const receipt = {
  auditedAt: new Date().toISOString(),
  inputGeneratedAt: report.generatedAt,
  downloads: 0,
  checkedRows: checked.length,
  inputs: {
    top10: report.generatedAt,
    iceUnits: iceUnits.generatedAt,
    handpicked: handpicked.generatedAt,
  },
  iceRankingsSortedAndEligible: true,
  handpickedGramPricesSorted: true,
  handpickedGramCoverage: handpickedOrder,
  wheyAndSoySeparated: true,
  allPublishedWheyPowderAndIceSourcesMatched: checked.every(
    (row) => row.exactSourcePriceMatched
  ),
  previousManualSourceReviewsMatched: reviews.every((r) =>
    r.rows.every(
      (row) => row.priceMatches === true || row.selectedPriceMatches === true
    )
  ),
  factoryAndFrozenDeliveryNotImpliedByArithmetic: true,
  rows: checked,
};
await writeFile(
  'docs/acceptance/top10-check/unit-cost-audit.json',
  `${JSON.stringify(receipt, null, 2)}\n`
);
await writeFile(
  'docs/acceptance/top10-check/unit-cost-audit.md',
  await format(
    `# Top-ten unit cost audit\n\nUpdated ${receipt.auditedAt}. **${checked.length} report rows recomputed offline**, covering both ten-row whey rankings, all selected ice rows in both reports, and all six handpicked options. Every price and exact SKU was independently re-extracted from original cached HTML with its SHA256 verified. Gram, millilitre and protein arithmetic, missing-field propagation and published sorting were checked.\n\nHydropure uses the selected seller's **2040 g**, giving **490.19 VND/g before delivery**; the unmatched factory2050g/protein profile remains a separate conditional reference. ProSupps uses printed **907 g**. Merino selling packs are **5 × 40 g = 200 g** and **5 × 60 g = 300 g**; the latter is sold out. Thai ice cream declares **6000 ml**; its conflicting seller3kg claim stays withheld.\n\nShipping costs require the captured quote quantity and Nha Trang destination; ice cream also requires confirmed cold-chain delivery before a delivered ranking. No gram/millilitre conversion or shaker capacity enters any food denominator. Exact current label coverage remains incomplete. Correct arithmetic and source matching do not establish current stock, manufacturer authenticity or complete marketplace coverage.\n\n[Whey original sources](whey-source-review.md) · [Ice original sources](ice-source-review.md) · [Audit JSON](unit-cost-audit.json) · [Updated top tens](../../tables/top-10-partial.md).\n`,
    { parser: 'markdown' }
  )
);
console.log(JSON.stringify({ checkedRows: checked.length, downloads: 0 }));
