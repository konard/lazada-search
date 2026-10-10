import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { LazadaSearch, productFlavour } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
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
      (row) => row.product.category === 'whey' && row.metrics.totalMassG > 0
    )
    .map((row) => {
      const hydro = row.offer.sku === '3095127497_VNAMZ-14849213302';
      return {
        row,
        mass: hydro ? 2050 : row.metrics.totalMassG,
        before: row.offer.price / (hydro ? 2050 : row.metrics.totalMassG),
        after: hydro
          ? (row.offer.price + 37700) / 2050
          : row.metrics.costPerGramAfterDelivery,
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
        row.metrics.costPerProteinGramBeforeDelivery > 0
    )
    .sort(
      (a, b) =>
        a.metrics.costPerProteinGramBeforeDelivery -
        b.metrics.costPerProteinGramBeforeDelivery
    )
    .slice(0, 10);
  const ice = available.filter(
    (row) => row.product.category === 'chocolate-ice-cream'
  );
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
      url: row.offer.url,
      name: name(row),
      price: row.offer.price,
      observedAt: row.offer.observedAt,
      status: 'Exact selected-SKU price; factory and frozen delivery pending',
      g: row.metrics.costPerGramBeforeDelivery,
      ml: row.metrics.costPerMlBeforeDelivery,
    })),
    ...extra,
  ]
    .sort((a, b) => a.price - b.price)
    .slice(0, 10);
  assert.equal(iceCandidates.length, 10);
  const receipt = {
    generatedAt: new Date().toISOString(),
    market: 'Vietnam',
    deliveryArea: 'Nha Trang',
    currency: 'VND',
    complete: false,
    downloads: app.cache.stats.downloads,
    shakerBundlesExcluded: true,
    whey: whey.map(({ row, mass, before, after, conditional }) => ({
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
    verifiedProtein: verified.map((row) => ({
      sku: row.offer.sku,
      price: row.offer.price,
      beforePerProteinGram: row.metrics.costPerProteinGramBeforeDelivery,
      afterPerProteinGram: row.metrics.costPerProteinGramAfterDelivery,
      observedAt: row.offer.observedAt,
    })),
    iceCream: iceCandidates,
  };
  const body = `# Partial 10.10 buying report\n\nUpdated **${receipt.generatedAt}**. Vietnam / Nha Trang, **VND**. This is a partial captured-market report; product availability, discounts and freight can change. Original Vietnamese titles and original evidence remain in the archived catalog. These product labels are English summaries. Paid protein-plus-shaker options are excluded; ordinary powder selections with advertised free gifts remain eligible.\n\n**Fresh strongest lead: [Hydropure Extreme Chocolate](https://www.lazada.vn/products/pdp-i3095127497.html?skuId=14849213302), 999,997 + 37,700 = 1,037,697 VND for one package.** Its official 2,050 g Extreme Chocolate label declares 28 g protein per 36 g scoop: **627.18 VND/g protein before freight; 650.82 delivered**. This calculation is conditional on the seller supplying that exact factory package/formula: the shared seller gallery shows other flavours. [Exact manufacturer evidence and conflicts](../acceptance/urgent-whey-reviews/factory-lead-review.md). Do not infer total protein from rounded servings.\n\n**Best freshly captured specification-verified whey: [IT'S JUST unflavoured 5 lb](https://www.lazada.vn/products/pdp-i3300919067.html?skuId=16058119853), 2,952,300 + 80,200 = 3,032,500 VND; 1,470.79 VND/g protein delivered**, captured 10 October 13:48 UTC. Maximum captured quantity: three. Published identity matching does not establish seller authenticity.\n\n## Ten lowest captured whey costs per gram of powder\n\nOnly positive selected-SKU prices with captured availability are included. This provisional list ranks food mass, not protein content. Manufacturer matching is required to make a reliable protein-cost comparison. The official Hydropure mass replaces the title's mathematical pound conversion **for this conditional report only**; the unresolved catalog record is preserved. Other pending masses are marketplace declarations.\n\n${table(
    [
      'Rank',
      'English product summary',
      'Exact selected SKU',
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
        ? 'Conditional exact factory match'
        : row.manufacturerVerified
          ? 'Factory specifications matched'
          : 'Factory identity/formula pending',
      row.offer.observedAt,
    ])
  )}\n\nA dash means the corresponding freight or original price was not established. It is never treated as zero and does not affect the before-delivery sort. One-package freight cannot price a bulk basket.\n\n## Ten cheapest specification-verified protein costs\n\nSoy is identified separately from whey. Historical observations remain visible with timestamps and need a fresh purchase check.\n\n${table(
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
      number(row.metrics.costPerProteinGramBeforeDelivery),
      number(row.metrics.costPerProteinGramAfterDelivery),
      row.offer.observedAt,
    ])
  )}\n\n## Ten chocolate ice-cream price observations and leads\n\n**No frozen delivery to Nha Trang is confirmed.** Only ${ice.length} rows have confirmed selected-SKU prices in the strict flavour set; ${extra.length} additional relevant ice-cream-category leads complete this ten-row partial table. These leads require selected-option and chocolate-core checks. Package prices alone cannot identify the cheapest per gram or ml. Known vanilla cores with chocolate coatings, nuts, mixed flavours, Samanco chocolate filling, snacks and ice-cream ingredients are excluded.\n\n${table(
    [
      'Order by package price',
      'English product summary',
      'Source / SKU',
      'Captured VND',
      'VND/g before',
      'VND/ml before',
      'Evidence status',
      'Observed UTC',
    ],
    iceCandidates.map((row, i) => [
      i + 1,
      row.name,
      `[${row.sku}](${row.url})`,
      number(row.price),
      number(row.g),
      number(row.ml),
      row.status,
      row.observedAt,
    ])
  )}\n\nThe two Happy Gelato options are **475 ml at 150,000 VND (315.79 VND/ml)** and **125 ml at 45,000 VND (360 VND/ml)**. Merino's selected five-stick bundle is **200 g at 39,000 VND (195 VND/g)**; the two separately captured single-stick offers are **40 g at 8,000 VND (200 VND/g)**. Grams and millilitres are not converted without measured density. Their manufacturer specifications and Nha Trang cold-chain availability remain unresolved.\n\n## Sold-out price leads and discount handling\n\nThe fresh exact selections for Warrior Double Rich Chocolate 2 kg (970,000 VND), Critical Whey Chocolate 2 kg (2,499,500 VND), and Mutant Chocolate 5 lb (3,299,500 VND) were unavailable when captured. They are excluded from buyable rankings. Cheap search cards for Critical/Mutant referred to smaller seller trial bags, not these sealed packages.\n\nSale prices already include the displayed sale reduction. Original prices are shown where captured. Unverified vouchers, gifts, loyalty and payment conditions are not subtracted. [Discount conditions and bulk arithmetic](../acceptance/urgent-discounts/README.md). Exact bulk quantities, account eligibility and destination freight still require a basket-specific quote.\n\n[Full requirement tracker](../REQUIREMENTS.md) · [Complete captured tables](README.md) · [Reported defects](https://github.com/konard/lazada-search/issues/3) · [Raw report JSON](top-10-partial.json)\n\nReproduce without website requests:\n\n\`\`\`sh\nnode scripts/export-deadline-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr\n\`\`\`\n`;
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
      confirmedIce: ice.length,
      downloads: receipt.downloads,
    })
  );
} finally {
  await app.close();
}
