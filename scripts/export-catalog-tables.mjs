import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import {
  LazadaSearch,
  AssociativeStore,
  calculateOffer,
  compareOffers,
  manufacturerCandidates,
  specificationProblems,
} from '../src/index.js';
import { parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
const style = await resolveConfig('docs/tables/README.md');
async function writeFormatted(path, content) {
  await writeFile(
    path,
    await format(content, {
      ...style,
      parser: path.endsWith('.json') ? 'json' : 'markdown',
    })
  );
}
const app = new LazadaSearch({
  store: new AssociativeStore({ directory: options.dataDir }),
  offline: true,
  ocr: false,
  deliveryArea: options.deliveryArea,
  market: options.market,
});
const review = JSON.parse(
  await readFile('docs/acceptance/manual-catalog-review.json', 'utf8')
);
const reviewByUrl = new Map(review.items.map((item) => [item.url, item]));
const offers = (await app.store.list('offer')).filter(
  (offer) => !offer.supersededBy
);
const products = await app.store.list('product');
const audit = await app.audit();
const discoveries = await app.store.list('discovery');
const skuInventories = await app.store.list('sku-inventory');
const comparison = await app.compare({ quantity: 1, allowStale: true });
const entries = comparison.comparisons.filter(
  (row) => row.product.category !== 'unknown' || reviewByUrl.has(row.offer.url)
);
// Keep any manually quarantined candidate in the audit inventory as well.
for (const offer of offers.filter((offer) => reviewByUrl.has(offer.url))) {
  if (!entries.some((row) => row.offer.id === offer.id)) {
    const product = products.find((product) => product.id === offer.productId);
    entries.push(
      calculateOffer(product, offer, {
        quantity: 1,
        allowStale: true,
        deliveryArea: options.deliveryArea,
      })
    );
  }
}
entries.sort((left, right) => left.offer.url.localeCompare(right.offer.url));
const cell = (value) =>
  String(value ?? 'Unknown')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\|/gu, '&#124;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : 'Unknown';
const link = (label, url) =>
  `[${cell(label).replaceAll('[', '').replaceAll(']', '')}](${url.replace(/[()\s]/gu, (character) => `%${character.codePointAt(0).toString(16).toUpperCase()}`)})`;
const table = (headers, rows) =>
  [headers, headers.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
const variant = (product) =>
  [
    ...new Set((product.selectedVariant || []).map((option) => option.text)),
  ].join('; ') || 'No option selected';
const pair = (before, after) => `${number(before)} → ${number(after)}`;
const intro =
  'These are **unranked, provisional observations**, not manufacturer-verified purchase comparisons. Unknown means no confirmed value; it never means zero. Every row is retained, including conflicting and unavailable offers. Prices refer only to the captured selected SKU. Destination: **Nha Trang, Vietnam**, currency: **VND**, quantity: **one package**. Delivery for bulk quantities must be quoted separately.\n\n';
function priceRows(rows) {
  return rows.map(({ product, offer, metrics }) => [
    link(product.title, offer.url),
    variant(product),
    offer.sku || 'Unknown',
    number(offer.price),
    number(offer.shipping),
    offer.deliveryAvailable === false
      ? 'Unavailable'
      : offer.deliveryArea || 'Unknown',
    number(product.netMassG),
    number(product.netVolumeMl),
    number(metrics.totalAfterDelivery),
    pair(metrics.costPerGramBeforeDelivery, metrics.costPerGramAfterDelivery),
    pair(metrics.costPerMlBeforeDelivery, metrics.costPerMlAfterDelivery),
    pair(
      metrics.costPerProteinGramBeforeDelivery,
      metrics.costPerProteinGramAfterDelivery
    ),
    reviewByUrl.has(offer.url)
      ? link(
          'review',
          `../acceptance/visual-review/README.md#listing-${reviewByUrl.get(offer.url).index}`
        )
      : 'Manual review pending',
  ]);
}
const priceHeaders = [
  'Listing',
  'Selected option',
  'SKU',
  'Price',
  'Shipping',
  'Delivery',
  'Mass g (provisional)',
  'Volume ml (provisional)',
  'Delivered total',
  'VND / food g before → after',
  'VND / ml before → after',
  'VND / protein g before → after (provisional)',
  'Visual review',
];
await mkdir('docs/tables', { recursive: true });
async function save(name, text) {
  await writeFormatted(`docs/tables/${name}`, `${text}\n`);
}
const powders = entries.filter((row) =>
  ['whey', 'protein-powder'].includes(row.product.category)
);
const ice = entries.filter(
  (row) => row.product.category === 'chocolate-ice-cream'
);
const quarantined = entries.filter((row) => row.product.category === 'unknown');
await save(
  'protein-powder.md',
  `# Captured protein-powder inventory\n\n${intro}${powders.length} observed selected SKUs. Isolate/concentrate/blend classification is determined from the ingredient list.\n\n${table(priceHeaders, priceRows(powders))}`
);
await save(
  'chocolate-ice-cream.md',
  `# Captured chocolate ice-cream candidates\n\n${intro}**No frozen delivery is confirmed for Nha Trang. No candidate is a verified ice-cream purchase winner.** Mixed-flavour tubs are identified by their full listing title.\n\n${table(priceHeaders, priceRows(ice))}\n\n## Quarantined candidates\n\n${table(
    ['Listing', 'Reason'],
    quarantined.map((row) => [
      link(row.product.title, row.offer.url),
      reviewByUrl.get(row.offer.url)?.notes || 'Manual review pending',
    ])
  )}`
);
await save(
  'manufacturer-specifications.md',
  `# Manufacturer specification status for every captured food candidate\n\nAn official-domain candidate is a lead, not an exact variant match. Automatic verification requires matching GTIN or brand plus manufacturer SKU. Every required specification must be sourced to the matched official evidence. Listing errors retain their original claims and a correction ledger when exact official evidence replaces them.\n\n${table(
    [
      'Listing',
      'Selected variant',
      'Official-source candidates',
      'Exact specification status',
      'Unresolved findings',
    ],
    entries.map(({ product, offer }) => [
      link(product.title, offer.url),
      variant(product),
      manufacturerCandidates(product)
        .map(
          (source) =>
            link(source.name, source.url) +
            (source.brandConflict ? ' (brand conflict)' : '')
        )
        .join('; ') || 'Not found',
      specificationProblems(product).join('; ') || 'Verified',
      reviewByUrl.get(offer.url)?.notes || 'Manual review pending',
    ])
  )}\n\n## Raw nutrition inventory\n\nThese values are marketplace/OCR/review observations and remain provisional until exact manufacturer verification. All nutrient columns are per 100 g; no ice-cream mass is inferred from volume.\n\n${table(
    [
      'Listing',
      'Protein type',
      'Protein g',
      'Sugar g',
      'Fat g',
      'Saturated fat g',
      'Energy kcal',
      'Ingredients (provisional)',
    ],
    entries.map(({ product, offer }) => [
      link(product.title, offer.url),
      product.proteinType,
      number(product.proteinPer100g),
      number(product.sugarPer100g),
      number(product.fatPer100g),
      number(product.saturatedFatPer100g),
      number(product.kcalPer100g),
      (product.ingredients || []).join('; ') || 'Unknown',
    ])
  )}`
);
await save(
  'missing-listings.md',
  `# Discovered candidates still missing product records\n\n**${audit.missingListings.length} missing listings are explicit collection gaps.** Search-card prices are unconfirmed discovery hints and never substitute for an exact SKU price.\n\n${table(
    [
      'Candidate',
      'Search-card price (unconfirmed)',
      'Discovered category',
      'Official-source lead',
    ],
    audit.missingListings.map((url) => {
      const candidate = discoveries.find((entry) => entry.url === url) || {
        title: url,
      };
      return [
        link(candidate.title, url),
        number(candidate.searchPrice),
        candidate.category || 'Unknown',
        manufacturerCandidates(candidate)
          .map((source) => link(source.name, source.url))
          .join('; ') || 'Not found',
      ];
    })
  )}`
);
await save(
  'missing-sku-prices.md',
  `# Known SKU combinations missing their own price\n\n**${audit.missingSkuPrices.length} unresolved SKU prices.** A default-page price cannot be assigned to other flavours, package sizes, gifts or multipacks. Unavailable variants are retained.\n\n${table(
    ['Listing', 'SKU', 'Option combination', 'Public availability', 'SKU link'],
    audit.missingSkuPrices.map((sku) => [
      link(sku.listingUrl, sku.listingUrl),
      sku.sku,
      (sku.options || [])
        .map((option) => `${option.name}: ${option.value}`)
        .join('; '),
      sku.available === false
        ? 'Unavailable'
        : sku.available === true
          ? 'Available'
          : 'Unknown',
      sku.url ? link('Open SKU', sku.url) : 'Unknown',
    ])
  )}`
);
await save(
  'category-review.md',
  `# Search cards awaiting category review\n\n${audit.categoryReview.length} observations require classification review. These may include unrelated results, misspellings, accessories or true products; no unexplained discard is counted as completeness. Repeated observations retain their discovery IDs.\n\n${table(
    ['Title', 'Link', 'Search', 'Unconfirmed card price'],
    audit.categoryReview.map((entry) => [
      entry.title,
      link('Listing', entry.url),
      entry.query ||
        (entry.sourceUrl
          ? new URL(entry.sourceUrl).searchParams.get('q')
          : null),
      number(entry.searchPrice),
    ])
  )}`
);
const verified = entries.filter((row) => row.manufacturerVerified);
await save(
  'verified-comparison.md',
  `# Manufacturer-verified comparison\n\n**${verified.length} captured candidates have complete exact manufacturer specifications. ${comparison.ranked.length} offers are purchase-eligible.**\n\n${verified.length ? table(priceHeaders, priceRows(verified)) : 'No verified comparison rows are available. Manufacturer matches, nutrition, package identity, destination freight, stock and frozen delivery remain prerequisites. The provisional inventory is linked below, without a cheapest-product claim.'}\n\n[Protein-powder inventory](protein-powder.md) · [Ice-cream inventory](chocolate-ice-cream.md) · [Specification gaps](manufacturer-specifications.md) · [Coverage gaps](README.md)`
);
await save(
  'README.md',
  `# Lazada Vietnam catalog and comparison tables\n\n**Collection and manufacturer verification are incomplete. This dataset is not ready to establish the cheapest available bulk purchase.** Captured at the dates in [catalog.json](catalog.json); destination Nha Trang, VND.\n\n| Check | Result |\n| --- | --- |\n| Visually checked selected-page prices | ${review.items.length} |\n| Complete exact manufacturer specifications | ${audit.verifiedProducts} |\n| Missing discovered product records | ${audit.missingListings.length} |\n| Missing individual SKU prices | ${audit.missingSkuPrices.length} |\n| Unfinished search scopes | ${audit.unfinishedSearches.length} |\n| Unclassified discovery observations | ${audit.categoryReview.length} |\n| Whole-market completeness | Unverifiable from public search |\n\n- [All captured protein-powder offers](protein-powder.md)\n- [All captured chocolate ice-cream candidates and quarantines](chocolate-ice-cream.md)\n- [Manufacturer links, missing specifications and raw nutrition for every candidate](manufacturer-specifications.md)\n- [Manufacturer-verified comparison](verified-comparison.md)\n- [Every missing discovered listing](missing-listings.md)\n- [Every known missing SKU price](missing-sku-prices.md)\n- [All category-review observations](category-review.md)\n- [Manual visual inspection with screenshots](../acceptance/visual-review/README.md)\n- [Synthetic verified calculation example](synthetic-example.md)\n\n## Reproduce without website requests\n\n\`\`\`sh\nnode scripts/audit-cached-catalog.mjs --offline\nnode scripts/export-catalog-tables.mjs --offline\nnode bin/lazada-search.js audit --strict --offline\n\`\`\`\n\nThe last command deliberately exits unsuccessfully while any completeness claim is unproven. For a new public collection use \`crawl --exhaustive\`; it visits observed pagination, records every discovered candidate and stops on challenges. Exhausting those searches establishes only a searched scope, not an authoritative whole-market catalog. No global cheapest guarantee is issued.\n\nThe attempted public backlog encountered an app-only page and Lazada security redirects. Further Lazada requests stopped. Official manufacturer sources are collected independently with caching and pacing. There is no confirmed logged-in Lazada access, and no purchase was placed. Known gaps remain explicitly unresolved.\n\nBefore/after unit costs use (price × quantity + quoted freight − confirmed fixed discount) divided by confirmed food mass, volume or protein mass. Unknown denominators and shipping stay unknown. One-package freight is never extrapolated to a bulk order. A standard ice-cream freight quote does not establish frozen delivery.`
);
const fixture = JSON.parse(
  await readFile('tests/fixtures/products.json', 'utf8')
);
const synthetic = compareOffers(fixture.products, fixture.offers, {
  quantity: 1,
  now: Date.parse('2026-10-09T09:00:00Z'),
});
await save(
  'synthetic-example.md',
  `# Synthetic verified calculation example\n\n**Test data only. These products, official evidence and prices are fixtures, not real buying options.** This demonstrates before/after arithmetic independently of the incomplete live catalog.\n\n${table(
    [
      'Fixture',
      'Price',
      'Freight',
      'Mass g',
      'Volume ml',
      'VND / food g before → after',
      'VND / ml before → after',
      'VND / protein g before → after',
    ],
    synthetic.comparisons.map(({ product, offer, metrics }) => [
      product.title,
      number(offer.price),
      number(offer.shipping),
      product.netMassG,
      product.netVolumeMl,
      pair(metrics.costPerGramBeforeDelivery, metrics.costPerGramAfterDelivery),
      pair(metrics.costPerMlBeforeDelivery, metrics.costPerMlAfterDelivery),
      pair(
        metrics.costPerProteinGramBeforeDelivery,
        metrics.costPerProteinGramAfterDelivery
      ),
    ])
  )}`
);
const snapshot = {
  market: options.market,
  deliveryArea: options.deliveryArea,
  provisional: true,
  audit,
  products,
  offers,
  discoveries,
  skuInventories,
  crawls: await app.store.list('crawl'),
  comparisons: entries,
  checkedAt: new Date().toISOString(),
};
await save('catalog.json', JSON.stringify(snapshot, null, 2));
await writeFormatted(
  'docs/acceptance/price-comparison.json',
  `${JSON.stringify(comparison, null, 2)}\n`
);
const visuals = review.items
  .map(
    (item) =>
      `## Listing ${item.index}\n\n${link(item.title, item.url)}\n\nObserved selected-page price: **${number(item.price)} VND**. Selection: ${cell([...new Set(item.selected.map((option) => option.text))].join('; ') || 'none')}. Price and selection match the saved screenshot.\n\n${item.notes}\n\n[Inspection sheet ${Math.ceil(item.index / 4)}](review-${Math.ceil(item.index / 4)}.png), panel ${((item.index - 1) % 4) + 1}. Original screenshot SHA-256: ${item.image}.\n`
  )
  .join('\n');
await writeFormatted(
  'docs/acceptance/visual-review/README.md',
  `# Manual inspection of captured listings\n\nAll ${review.items.length} candidate food screenshots were inspected visually. Every extracted selected-page price matched the displayed price. This verifies these captured pages only; unseen products, other SKU prices, manufacturer identity and nutrition remain unresolved. Original observations retain their capture timestamps.\n\n${visuals}`
);
await app.close();
console.log(
  JSON.stringify({
    tables: 10,
    observed: entries.length,
    manufacturerVerified: verified.length,
    missingListings: audit.missingListings.length,
    missingSkuPrices: audit.missingSkuPrices.length,
  })
);
