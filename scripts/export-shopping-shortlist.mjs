import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { LazadaSearch, productFlavour } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { powderCategory } from './report-unit-costs.mjs';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error('Shopping tables require previously redacted public sources');
}
const scope = 'chocolate-or-unflavoured';
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
  flavourScope: scope,
});
const money = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : 'Not established';
const cell = (value) =>
  String(value)
    .replaceAll('|', '&#124;')
    .replace(/[\r\n]/gu, ' ');
const table = (headers, rows) =>
  [headers, headers.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
function skuLink(row) {
  const url = new URL(row.offer.url);
  url.searchParams.set('skuId', row.offer.sku.split('_VNAMZ-').at(-1));
  return `[${row.offer.sku}](${url.href})`;
}
try {
  const report = await app.compare({
    quantity: 1,
    allowStale: true,
    sort: 'costPerProteinGramBeforeDelivery',
  });
  const rows = report.comparisons.filter(
    (row) =>
      row.offer.price > 0 &&
      row.offer.variantConfirmed &&
      row.offer.available !== false
  );
  const exact = rows.filter(
    (row) =>
      row.manufacturerVerified &&
      row.product.category !== 'chocolate-ice-cream' &&
      ['chocolate', 'unflavoured'].includes(productFlavour(row.product))
  );
  exact.sort(
    (a, b) =>
      a.metrics.costPerProteinGramBeforeDelivery -
      b.metrics.costPerProteinGramBeforeDelivery
  );
  const now = Date.now();
  const fresh = (row) => now - Date.parse(row.offer.observedAt) <= 21600000;
  const whey = exact.filter((row) => powderCategory(row.product) === 'whey');
  const soy = exact.filter((row) => powderCategory(row.product) === 'soy');
  const verifiedRows = (products) =>
    products.map((row) => [
      skuLink(row),
      row.product.brand,
      powderCategory(row.product),
      productFlavour(row.product),
      money(row.product.netMassG * (row.product.packCount || 1)),
      money(row.product.proteinPer100g),
      money(row.offer.price),
      money(row.offer.originalPrice),
      money(row.offer.shippingQuantity === 1 ? row.offer.shipping : null),
      money(row.metrics.costPerGramBeforeDelivery),
      money(row.metrics.costPerGramAfterDelivery),
      money(row.metrics.costPerProteinGramBeforeDelivery),
      money(row.metrics.costPerProteinGramAfterDelivery),
      row.offer.maxQuantity ?? 'Not stated',
      row.offer.observedAt,
      fresh(row) ? 'Within 6 hours' : 'Historical; refresh before buying',
    ]);
  const ice = rows.filter(
    (row) => row.product.category === 'chocolate-ice-cream'
  );
  const inventory = rows
    .map((row) => [
      skuLink(row),
      row.product.title,
      row.product.category === 'chocolate-ice-cream'
        ? 'chocolate-ice-cream'
        : powderCategory(row.product),
      [...new Set((row.product.selectedVariant || []).map((v) => v.text))].join(
        '; '
      ),
      money(row.offer.price),
      money(row.offer.originalPrice),
      row.manufacturerVerified
        ? 'Exact factory label'
        : 'Factory match pending',
      row.offer.observedAt,
    ])
    .sort(
      (a, b) =>
        Number(a[4].replaceAll(',', '')) - Number(b[4].replaceAll(',', ''))
    );
  const scopeText =
    'Powders must be unflavoured/plain/natural or chocolate. Ice cream must have chocolate ice cream as the core flavour; vanilla cores under chocolate coating, fruit, nuts and mixed tubs are excluded. Unknown flavours are excluded. Broad discovery and rejected observations remain in the audit inventory.';
  const body = `# Strict-flavour buying table\n\nUpdated ${new Date().toISOString()}. Destination: **Nha Trang**, currency: **VND**. ${scopeText}\n\nThe two IT’S JUST unflavoured 5 lb options were refreshed online on 10 October. **SKU 16058119853: 2,952,300 + 80,200 = 3,032,500 VND delivered for one container, 1,470.79 VND/g protein.** SKU 15339529115: 3,024,000 + 80,200 = 3,104,200 VND, 1,505.56 VND/g protein. These are the lowest confirmed fresh whey comparisons in this captured set. Soy chocolate is a separate protein source.\n\n**The current238-page relevant list pass is terminal-confirmed; product details and exhaustive marketplace coverage remain incomplete. Bulk freight needs an exact quantity and delivery-address quote. No frozen delivery to Nha Trang is confirmed. No whole-market cheapest claim is made.**\n\n## Exact whey manufacturer specifications, cheapest whey protein cost first\n\n${table(['Selected SKU', 'Brand', 'Category', 'Flavour', 'Food mass g', 'Protein g/100g', 'Sale VND', 'Original VND', 'One-package freight VND', 'VND/food g before', 'VND/food g delivered', 'VND/protein g before', 'VND/protein g delivered', 'Quantity cap', 'Observed UTC', 'Freshness'], verifiedRows(whey))}\n\nWhey and soy are ranked separately by their reviewed protein-bearing ingredients. Soy lecithin in a whey formula does not classify the powder as soy.\n\n## Exact soy manufacturer specifications, cheapest soy protein cost first\n\n${table(['Selected SKU', 'Brand', 'Category', 'Flavour', 'Food mass g', 'Protein g/100g', 'Sale VND', 'Original VND', 'One-package freight VND', 'VND/food g before', 'VND/food g delivered', 'VND/protein g before', 'VND/protein g delivered', 'Quantity cap', 'Observed UTC', 'Freshness'], verifiedRows(soy))}\n\nManufacturers’ exact matched labels determine powder mass and protein. Sale prices already include the displayed sale reduction. Conditional gifts and unconfirmed vouchers are not subtracted. Powder millilitres are not inferred from grams. A one-container freight quote cannot price a bulk basket.\n\n## Strict chocolate ice-cream candidates\n\n${table(
    [
      'Selected SKU',
      'Listing',
      'Captured VND',
      'Declared g',
      'Declared ml',
      'VND/g before delivery',
      'VND/g delivered',
      'VND/ml before delivery',
      'VND/ml delivered',
      'Nha Trang frozen delivery',
    ],
    ice.map((row) => [
      skuLink(row),
      row.product.title,
      money(row.offer.price),
      money(row.metrics.totalMassG),
      money(row.metrics.totalVolumeMl),
      money(row.metrics.costPerGramBeforeDelivery),
      money(row.metrics.costPerGramAfterDelivery),
      money(row.metrics.costPerMlBeforeDelivery),
      money(row.metrics.costPerMlAfterDelivery),
      'Unconfirmed',
    ])
  )}\n\nThese are preliminary marketplace declarations. Manufacturer nutrition and cold-chain delivery must be verified before a purchase ranking.\n\n## All captured available selected prices matching the flavour scope\n\n${rows.length} rows have positive selected-SKU prices. Exact manufacturer rows above are the only specification-verified subset.\n\n${table(['Selected SKU', 'Listing', 'Category', 'Selected option', 'Sale VND', 'Original VND', 'Specification status', 'Observed UTC'], inventory)}\n\nRecalculate offline:\n\n\`\`\`sh\nnode bin/lazada-search.js compare --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr --quantity 1 --sort costPerProteinGramAfterDelivery\n\`\`\`\n\n[Reviewed discounts and bulk projections](../acceptance/urgent-discounts/README.md) · [Exact whey labels](../acceptance/urgent-whey-reviews/README.md) · [Ice-cream exclusions](../acceptance/urgent-icecream/README.md) · [Full collection audit](README.md)\n`;
  const style = await resolveConfig('docs/tables/shopping-shortlist.md');
  await writeFile(
    'docs/tables/shopping-shortlist.md',
    await format(body, { ...style, parser: 'markdown' })
  );
  console.log(
    JSON.stringify({
      rows: rows.length,
      exact: exact.length,
      whey: whey.length,
      soy: soy.length,
      ice: ice.length,
      downloads: app.cache.stats.downloads,
    })
  );
} finally {
  await app.close();
}
