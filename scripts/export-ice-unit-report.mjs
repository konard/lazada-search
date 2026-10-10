import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { enrichIceRow, rankIceRows } from './ice-unit-rankings.mjs';

const input = JSON.parse(
  await readFile('docs/tables/top-10-partial.json', 'utf8')
);
const reviews = [];
const reviewFiles = [];
for (const file of ['merino', 'korean', 'gelato-thai']) {
  const path = `docs/acceptance/ice-dual-units/${file}-review.json`;
  try {
    const report = JSON.parse(await readFile(path, 'utf8'));
    reviews.push(...(report.reviews || report.rows));
    reviewFiles.push(path);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}
const rows = input.iceCream.map((row) => enrichIceRow(row, reviews));
assert.equal(new Set(rows.map((row) => row.sku)).size, rows.length);
const rankings = {};
for (const metric of [
  'beforePerFoodGram',
  'beforePerMl',
  'beforePerProteinGram',
  'afterPerFoodGram',
  'afterPerMl',
  'afterPerProteinGram',
]) {
  rankings[metric] = rankIceRows(rows, metric);
}
const number = (value) =>
  value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const table = (headers, values) =>
  [headers, headers.map(() => '---'), ...values]
    .map(
      (cells) =>
        `| ${cells
          .map((cell) =>
            String(cell)
              .replaceAll('|', '&#124;')
              .replace(/[\r\n]/gu, ' ')
          )
          .join(' | ')} |`
    )
    .join('\n');
const product = (row) => `[${row.name}](${row.url})`;
const nutrientNames = {
  proteinPerPackageG: 'Protein / package',
  energyPerPackageKcal: 'Energy / package',
  fatPerPackageG: 'Fat / package',
  carbohydratePerPackageG: 'Carbohydrate / package',
  sugarPerPackageG: 'Sugar / package',
  sodiumPerPackageMg: 'Sodium / package',
};
const section = (title, before, after, amount, unit) => {
  const values = rankings[before];
  const delivered = rankings[after];
  return `## ${title}\n\n${
    values.length
      ? table(
          [
            'Rank',
            'Selected chocolate product',
            'Sale VND',
            `Selling-unit ${unit}`,
            `VND/${unit} before delivery`,
          ],
          values.map((row, index) => [
            index + 1,
            product(row),
            number(row.totalBeforeDelivery),
            number(row[amount]),
            number(row[before]),
          ])
        )
      : 'No current exact-product denominator is established for this metric.'
  }\n\n${
    delivered.length
      ? table(
          [
            'Delivered rank',
            'Selected chocolate product',
            'Delivered VND',
            `VND/${unit} delivered`,
          ],
          delivered.map((row, index) => [
            index + 1,
            product(row),
            number(row.totalAfterDelivery),
            number(row[after]),
          ])
        )
      : '**Delivered ranking:** no captured quote confirms frozen delivery to Nha Trang for this quantity. Shipping remains unpriced; it is never assumed free.'
  }\n`;
};
const missing = rows.map((row) => ({
  sku: row.sku,
  fields: [
    ...(!(row.massG > 0) ? ['net grams'] : []),
    ...(!(row.volumeMl > 0) ? ['net millilitres'] : []),
    ...(row.proteinG === null ? ['current exact-formula protein'] : []),
    ...(!row.manufacturerIdentityMatched
      ? ['manufacturer chocolate-core identity']
      : []),
    ...(!row.deliveryQuoteMatched ? ['Nha Trang frozen-delivery quote'] : []),
  ],
  research: row.research,
}));
const receipt = {
  generatedAt: new Date().toISOString(),
  sourcePricesGeneratedAt: input.generatedAt,
  currency: 'VND',
  deliveryArea: 'Nha Trang',
  downloads: 0,
  complete: missing.every((item) => !item.fields.length),
  reviewFiles,
  coverage: {
    exactSelectedPrices: rows.length,
    bothMassAndVolume: rows.filter((row) => row.massG > 0 && row.volumeMl > 0)
      .length,
    currentProteinDenominator: rows.filter((row) => row.proteinG !== null)
      .length,
    manufacturerChocolateIdentity: rows.filter(
      (row) =>
        row.strictChocolateEligible === true && row.manufacturerIdentityMatched
    ).length,
  },
  rows,
  rankings,
  unresolved: missing,
};
const nutrients = rows.flatMap((row) =>
  Object.entries(row.specificationFacts)
    .filter(([field]) =>
      /protein|fat|carbohydrate|sugar|kcal|sodium|ingredients/iu.test(field)
    )
    .map(([field, fact]) => [
      product(row),
      nutrientNames[field] || field,
      typeof fact.value === 'number'
        ? number(fact.value)
        : fact.value.join('; '),
      [fact.unit, fact.basis].filter(Boolean).join('; ') || 'See source',
      `${fact.sourceAuthority || 'Source review'}: [source](${fact.sourceUrl})`,
    ])
);
const body = `# Chocolate ice cream: separate gram, millilitre and protein rankings

Updated ${receipt.generatedAt}. **Vietnam / Nha Trang, VND, quantity one selling unit.** Prices retain their original observation dates. Each table is independently sorted by its named denominator. No gram-to-millilitre conversion, assumed density, carton-count multiplier or price cap is used. Exact manufacturer facts take priority over original package labels and seller panels, with original claims and source authority retained in the evidence. Seller-panel nutrition can produce a labelled reference price; it does not establish manufacturer verification.

**Coverage:** ${rows.length} exact selected-SKU prices; ${receipt.coverage.bothMassAndVolume} with both grams and millilitres; ${receipt.coverage.currentProteinDenominator} with a current exact-product protein denominator. These are captured candidates, and manufacturer chocolate-core identity is reported separately. Missing facts stay in the evidence worklist, outside the ranking that requires them. Sold-out and confirmed rejected flavours cannot win.

${section('Lowest price per gram of food', 'beforePerFoodGram', 'afterPerFoodGram', 'massG', 'g')}
${section('Lowest price per millilitre', 'beforePerMl', 'afterPerMl', 'volumeMl', 'ml')}
${section('Lowest price per gram of protein — reference', 'beforePerProteinGram', 'afterPerProteinGram', 'proteinG', 'protein g')}

## Current exact-product nutrient facts and source authority

${nutrients.length ? table(['Selected product', 'Nutrient', 'Value', 'Label unit / basis', 'Evidence'], nutrients) : 'No current exact-SKU nutrition panel has passed identity matching. Historical sample tests and other flavours remain research evidence, without a current protein price.'}

Protein is calculated from an exact per-package label, or from the label's grams per100g/per100ml using the independently declared package quantity. Zero protein makes price per gram of protein undefined. Conflicting bases require review. Carbohydrate is not substituted for sugar.

## Evidence worklist and stock

${table(
  ['Selected SKU', 'Captured UTC', 'Stock / scope', 'Still required'],
  rows.map((row, index) => [
    `[${row.sku}](${row.url})`,
    row.observedAt,
    row.available === false
      ? 'Sold out'
      : row.strictChocolateEligible === false
        ? 'Rejected flavour / ingredients'
        : row.strictChocolateEligible === true &&
            row.manufacturerIdentityMatched
          ? 'Manufacturer flavour matched'
          : 'Seller chocolate candidate',
    missing[index].fields.join('; ') || 'Complete',
  ])
)}

Historical Happy Gelato2021 laboratory findings remain in the [sample-specific review](../acceptance/urgent-icecream/targeted-spec-review.json). They do not establish current tub weight, density or formula. The Thai tub's3000g is a seller title/attribute claim; its description gives3–3.3kg depending on flavour, so its gram result remains conditional until the exact chocolate label is matched.

[Manufacturer research and original source captures](../acceptance/ice-dual-units/) · [Exact marketplace price/source audit](../acceptance/top10-check/ice-source-review.md) · [All ranking data](ice-unit-rankings.json) · [Whey top tens](top-10-partial.md) · [Handpicked powder sorted by gram price](handpicked.md) · [Automation handoff](../ICE-CREAM-AUTOMATION.md).

Reproduce from committed cache with no website requests:

\`\`\`sh
node scripts/export-ice-unit-report.mjs
\`\`\`
`;
await writeFile(
  'docs/tables/ice-unit-rankings.json',
  `${JSON.stringify(receipt, null, 2)}\n`
);
await writeFile(
  'docs/tables/ice-unit-rankings.md',
  await format(body, { parser: 'markdown' })
);
console.log(JSON.stringify({ ...receipt.coverage, downloads: 0 }));
