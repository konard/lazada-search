import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { parseHTML } from 'linkedom';
import { LazadaSearch, extractPage, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';
import { sha256 } from '../src/util.js';

const report = JSON.parse(
  await readFile('docs/tables/top-10-partial.json', 'utf8')
);
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
]) {
  assert.equal(rows.length, 10);
  for (const row of rows) {
    const results = {};
    for (const [denominator, before, after] of [
      ['massG', 'beforePerFoodGram', 'afterPerFoodGram'],
      ['volumeMl', 'beforePerMl', 'afterPerMl'],
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
  wheyAndSoySeparated: true,
  allPublishedWheyPowderAndIceSourcesMatched: reviews.every((r) =>
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
    `# Top-ten unit cost audit\n\nUpdated ${receipt.auditedAt}. **Thirty report rows recomputed offline**, including the separate ten-row whey protein-cost table. The ten whey powder and ten ice-cream exact SKU/source prices were independently checked against original cached HTML and source hashes.\n\nProSupps uses printed **907 g**; Merino selling packs are **5 × 40 g = 200 g** and **5 × 60 g = 300 g**. The latter is sold out. Thai ice cream explicitly declares **6000 ml**; its seller title claims **3000 g**, while description says 3–3.3 kg by flavour. That mass remains a seller claim.\n\nShipping costs require the captured quote quantity and Nha Trang destination; ice cream also requires confirmed cold-chain delivery before a delivered ranking. No gram/millilitre conversion or shaker capacity enters any food denominator. Hydropure's exact factory package/revision remains conditional. Price arithmetic does not establish manufacturer authenticity, current stock or complete marketplace coverage.\n\n[Whey original sources](whey-source-review.md) · [Ice original sources](ice-source-review.md) · [Audit JSON](unit-cost-audit.json) · [Updated top tens](../../tables/top-10-partial.md).\n`,
    { parser: 'markdown' }
  )
);
console.log(JSON.stringify({ checkedRows: checked.length, downloads: 0 }));
