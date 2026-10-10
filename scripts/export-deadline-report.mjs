import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { LazadaSearch, productFlavour } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { powderCategory, reportUnitCosts } from './report-unit-costs.mjs';
const options = parseArguments(process.argv.slice(2));
assert.ok(!options.account, 'Use redacted public sources');
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
  flavourScope: 'chocolate-or-unflavoured',
});
const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : '—';
const table = (headers, rows) =>
  [headers, headers.map(() => '---'), ...rows]
    .map(
      (row) =>
        `| ${row
          .map((value) =>
            String(value)
              .replaceAll('|', '&#124;')
              .replace(/[\r\n]/gu, ' ')
          )
          .join(' | ')} |`
    )
    .join('\n');
const link = (row) => {
  const url = new URL(row.offer.url);
  url.searchParams.set('skuId', row.offer.sku.split('_VNAMZ-').at(-1));
  return `[${row.offer.sku}](${url.href})`;
};
const englishNames = {
  3326435113: 'MusaKing soy isolate chocolate',
  3095127497: 'Nutrabolics Hydropure Extreme Chocolate',
  13430219487: 'Unverified Gold-labelled Double Rich Chocolate',
  3154800181: 'ON-labelled chocolate seller repack',
  3264177806: 'VBest Chocolate',
  966992366: 'Optimum Nutrition Extreme Milk Chocolate',
  367656830: 'Merino chocolate cocoa-crisp ice-cream stick',
  1561301337: 'Merino chocolate cocoa-crisp ice-cream stick',
  1880785864: 'Happy Gelato Belgian chocolate ice cream',
  2978009544: 'Binggrae Pongta Chocolate bottle ice cream',
  3039951845: 'Lotte Crispy Crunch Chocolate cone',
  3047790409: 'Lotte Fanfare Chocolate ice cream',
  497264871: 'Merino chocolate cone, five-cone pack',
  1561216831: 'Thai chocolate ice-cream tub',
  13392889869: 'Rule 1 unflavoured, two seller-repacked 1 kg bags',
};
const name = (row) =>
  englishNames[row.offer.sku.split('_VNAMZ-')[0]] ||
  `${row.product.brand || 'Manufacturer pending'} ${productFlavour(row.product)} protein powder`;
try {
  const report = await app.compare({ quantity: 1, allowStale: true });
  const available = report.comparisons.filter(
    (row) =>
      row.offer.price > 0 &&
      row.offer.variantConfirmed &&
      row.offer.available !== false
  );
  const powders = available.filter((row) =>
    ['whey', 'protein-powder'].includes(row.product.category)
  );
  const definite = powders.filter(
    (row) =>
      row.manufacturerVerified ||
      (row.offer.sku === '13392889869_VNAMZ-117024762283' &&
        row.product.categoryReview?.status === 'reviewed') ||
      ['chocolate', 'unflavoured'].includes(
        productFlavour({
          category: row.product.category,
          title: '',
          selectedVariant: row.product.selectedVariant,
        })
      )
  );
  const whey = definite
    .filter(
      (row) =>
        powderCategory(row.product) === 'whey' && row.metrics.totalMassG > 0
    )
    .map((row) => {
      const hydro = row.offer.sku === '3095127497_VNAMZ-14849213302';
      const costs = reportUnitCosts(
        row,
        hydro
          ? {
              productOverride: {
                netMassG: 2050,
                packCount: 1,
                proteinPer100g: (100 * 28) / 36,
              },
            }
          : {}
      );
      return {
        row,
        mass: costs.massG,
        before: costs.beforePerFoodGram,
        after: costs.afterPerFoodGram,
        costs,
        conditional: hydro,
      };
    })
    .sort((a, b) => a.before - b.before)
    .slice(0, 10);
  assert.equal(whey.length, 10);
  const verified = definite
    .filter(
      (row) =>
        row.manufacturerVerified &&
        powderCategory(row.product) === 'whey' &&
        ['chocolate', 'unflavoured'].includes(productFlavour(row.product)) &&
        row.metrics.costPerProteinGramBeforeDelivery > 0
    )
    .sort(
      (a, b) =>
        a.metrics.costPerProteinGramBeforeDelivery -
        b.metrics.costPerProteinGramBeforeDelivery
    )
    .slice(0, 10);
  const soy = definite.filter(
    (row) => powderCategory(row.product) === 'soy' && row.manufacturerVerified
  );
  const ice = report.comparisons.filter(
    (row) =>
      row.product.category === 'chocolate-ice-cream' &&
      row.offer.price > 0 &&
      row.offer.variantConfirmed
  );
  const iceIds = new Set(ice.map((row) => row.offer.sku.split('_VNAMZ-')[0]));
  const extraIds = new Map([
    [
      '2978009544',
      'Binggrae Pongta Chocolate bottle ice cream; title says 130 ml',
    ],
    ['3039951845', 'Lotte Crispy Crunch Chocolate cone; title says 160 ml'],
    ['3047790409', 'Lotte Fanfare Chocolate; title says 175 ml'],
    ['497264871', 'Merino chocolate cone; title says 60 g'],
    ['1561216831', 'Thai chocolate ice-cream tub; title says 6 L / 3 kg'],
  ]);
  const discoveries = await app.store.list('discovery');
  const extra = [];
  for (const [item, label] of extraIds) {
    if (iceIds.has(item)) {
      continue;
    }
    const d = discoveries
      .filter(
        (d) =>
          d.url?.includes(`-i${item}.html`) &&
          d.sourceUrl?.includes('bach-hoa-online-kem-') &&
          d.searchPrice > 0
      )
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    if (d) {
      extra.push({
        sku: d.sku,
        url: d.url,
        name: label,
        price: d.searchPrice,
        observedAt: d.observedAt,
        status:
          'Search-card price; selected selling option and chocolate core unverified',
      });
    }
  }
  const iceCandidates = [
    ...ice.map((row) => ({
      sku: row.offer.sku,
      url: link(row).match(/\]\((.*)\)$/u)[1],
      name: name(row),
      price: row.offer.price,
      observedAt: row.offer.observedAt,
      status:
        row.offer.available === false
          ? 'Sold out; excluded from buyable ranking'
          : 'Exact selected-SKU price; factory and frozen delivery pending',
      available: row.offer.available !== false,
      sellerTitle: row.product.title,
      selectedOptions: row.product.selectedVariant,
      originalPrice: row.offer.originalPrice ?? null,
      ...reportUnitCosts(row),
    })),
    ...extra,
  ].sort(
    (a, b) =>
      (b.available !== false) - (a.available !== false) ||
      (a.beforePerMl ?? Infinity) - (b.beforePerMl ?? Infinity) ||
      (a.beforePerFoodGram ?? Infinity) - (b.beforePerFoodGram ?? Infinity) ||
      a.price - b.price
  );
  const receipt = {
    generatedAt: new Date().toISOString(),
    market: 'Vietnam',
    deliveryArea: 'Nha Trang',
    currency: 'VND',
    complete: false,
    downloads: app.cache.stats.downloads,
    shakerBundlesExcluded: true,
    whey: whey.map(({ row, mass, before, after, conditional, costs }) => ({
      ...costs,
      category: 'whey',
      sku: row.offer.sku,
      url: row.offer.url,
      name: name(row),
      price: row.offer.price,
      massG: mass,
      beforePerFoodGram: before,
      afterPerFoodGram: after,
      conditional,
      manufacturerVerified: row.manufacturerVerified,
      observedAt: row.offer.observedAt,
    })),
    verifiedProteinCategory: 'whey',
    soyProtein: soy.map((row) => ({
      sku: row.offer.sku,
      name: name(row),
      category: 'soy',
      price: row.offer.price,
      ...reportUnitCosts(row),
      observedAt: row.offer.observedAt,
    })),
    verifiedProtein: verified.map((row) => ({
      ...reportUnitCosts(row),
      category: 'whey',
      sku: row.offer.sku,
      price: row.offer.price,
      beforePerProteinGram: reportUnitCosts(row).beforePerProteinGram,
      afterPerProteinGram: reportUnitCosts(row).afterPerProteinGram,
      observedAt: row.offer.observedAt,
    })),
    iceCream: iceCandidates,
  };
  const body = `# Partial 10.10 buying report

Updated **${receipt.generatedAt}**. Vietnam / Nha Trang, **VND**. Powder selections are chocolate or unflavoured; **whey and soy are separate categories**. Paid shaker selections are excluded. Advertised free gifts do not add food mass. This is a captured-market comparison, with timestamps; it does not establish exhaustive market coverage or seller authenticity.

**Best fresh factory-specification-matched whey: [IT'S JUST unflavoured 2268 g](https://www.lazada.vn/products/pdp-i3300919067.html?skuId=16058119853)**: 2,952,300 VND + 80,200 VND one-package freight = **3,032,500 VND; 1,470.79 VND/g protein delivered**. Captured quantity cap: three.

**Cheaper conditional lead: [Nutrabolics Hydropure Extreme Chocolate](https://www.lazada.vn/products/pdp-i3095127497.html?skuId=14849213302)**: 999,997 + 37,700 = **1,037,697 VND**. Official 2050 g / 28 g protein per 36 g serving gives **650.82 VND/g protein delivered**, conditional on the exact factory package/revision. Seller description says 2.04 kg and gallery depicts other flavours. [Manufacturer evidence and conflicts](../acceptance/urgent-whey-reviews/factory-lead-review.md). This remains a lead to verify, not an exact factory match.

## Top 10 whey: lowest price per gram of powder

These are positive selected-SKU prices and captured availability. The ranking is per gram of powder; formula verification is separately stated. **ProSupps uses the printed 907 g** as the food-mass denominator. Shipping is included only when a non-invalidated quote matches Nha Trang and one package. No price cap excludes large packages.

${table(
  [
    'Rank',
    'Product',
    'Selected SKU',
    'Sale VND',
    'Original VND',
    'Food g',
    'VND/g before',
    'VND/g delivered',
    'Specification status',
    'Observed UTC',
  ],
  whey.map(({ row, mass, before, after, conditional }, i) => [
    i + 1,
    name(row),
    link(row),
    number(row.offer.price),
    number(row.offer.originalPrice),
    number(mass),
    number(before),
    number(after),
    conditional
      ? 'Conditional exact factory package'
      : row.manufacturerVerified
        ? 'Factory specifications matched'
        : 'Factory identity/formula pending',
    row.offer.observedAt,
  ])
)}

## Top 10 whey: lowest specification-verified price per gram of protein

**Whey only.** Soy is excluded from this ranking. All selections are chocolate or unflavoured. Older observations retain their timestamps and need a purchase-time stock and price check.

${table(
  [
    'Rank',
    'Product',
    'Selected SKU',
    'Sale VND',
    'VND/protein g before',
    'VND/protein g delivered',
    'Observed UTC',
  ],
  verified.map((row, i) => [
    i + 1,
    name(row),
    link(row),
    number(row.offer.price),
    number(reportUnitCosts(row).beforePerProteinGram),
    number(reportUnitCosts(row).afterPerProteinGram),
    row.offer.observedAt,
  ])
)}

## Chocolate ice cream: separate unit-price rankings

The [ice-cream report](ice-unit-rankings.md) independently sorts **VND per gram**, **VND per millilitre**, and **VND per gram of protein**. Its compact tables contain only comparable denominators; stock, source timestamps and missing evidence are tracked separately. The [machine-readable report](ice-unit-rankings.json) retains every captured SKU, original quantity and manufacturer-source review.

Manufacturer-matched package facts override seller declarations only for the exact product. Nutrition may be expressed per package, per100g or per100ml; no assumed density is used. Current exact-formula protein facts are required for a protein-price ranking. Historical laboratory tests remain sample-specific evidence. Nha Trang frozen delivery must be confirmed before delivered prices are ranked.

## Soy protein: separate reference category

Soy is not part of either whey top 10.

${table(
  [
    'Soy product',
    'Selected SKU',
    'Sale VND',
    'VND/protein g before',
    'VND/protein g delivered',
  ],
  soy.map((row) => [
    name(row),
    link(row),
    number(row.offer.price),
    number(reportUnitCosts(row).beforePerProteinGram),
    number(reportUnitCosts(row).afterPerProteinGram),
  ])
)}

## Discounts, verification and remaining work

Sale prices already include displayed sale reductions; original prices are shown where captured. Confirmed fixed discounts and quantity tiers are recalculated once per order. Unconfirmed vouchers, gifts, payment eligibility and quantity-specific freight are not invented or subtracted. A one-package shipping quote cannot establish a bulk basket price. A dash means the specific denominator or destination quote is not established, never zero.

[Source checks and corrected arithmetic](../acceptance/top10-check/) · [Handpicked list and ranking intersections](../acceptance/top10-check/handpicked-links.md) · [Discount and bulk evidence](../acceptance/urgent-discounts/README.md) · [Requirements](../REQUIREMENTS.md) · [Full catalog](README.md) · [Open coverage/delivery issue](https://github.com/konard/lazada-search/issues/3) · [Report JSON](top-10-partial.json).

Reproduce without website requests:

\`\`\`sh
node scripts/export-deadline-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr
\`\`\`
`;

  await writeFile(
    'docs/tables/top-10-partial.json',
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  await writeFile(
    'docs/tables/top-10-partial.md',
    await format(body, { parser: 'markdown' })
  );
  console.log(
    JSON.stringify({
      whey: whey.length,
      verified: verified.length,
      ice: iceCandidates.length,
      exactSelectedIcePrices: ice.length,
      downloads: receipt.downloads,
    })
  );
} finally {
  await app.close();
}
