import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import {
  LazadaSearch,
  calculateOffer,
  compareOffers,
  manufacturerCandidates,
  specificationProblems,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error(
    'Publish redacted account captures before exporting public repository tables'
  );
}
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
  store: configuredStore(options),
  offline: true,
  ocr: false,
  deliveryArea: options.deliveryArea,
  market: options.market,
});
const review = JSON.parse(
  await readFile('docs/acceptance/manual-catalog-review.json', 'utf8')
);
const reviewByUrl = new Map(review.items.map((item) => [item.url, item]));
const skuReview = await readFile(
  'docs/acceptance/browser-sku-collection.json',
  'utf8'
)
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === 'ENOENT') {
      return { imported: [] };
    }
    throw error;
  });
const reviewedSkus = new Map(
  skuReview.imported.map((item) => [item.sku, item])
);
const offers = (await app.store.list('offer')).filter(
  (offer) => !offer.supersededBy
);
const products = await app.store.list('product');
const audit = await app.audit();
const discoveries = await app.store.list('discovery');
const skuInventories = await app.store.list('sku-inventory');
const publications = await app.store.list('publication');
const publicationByOffer = new Map(
  publications.map((record) => [record.offerId, record])
);
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
entries.sort(
  (left, right) =>
    (left.offer.price ?? Infinity) - (right.offer.price ?? Infinity) ||
    left.offer.url.localeCompare(right.offer.url)
);
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
  'Rows are sorted by **captured package price, cheapest first**. Unit costs and specifications are provisional until their source and package identity are verified. Unknown means no confirmed value; it never means zero. Every row is retained, including conflicting and unavailable offers. Prices refer only to the captured selected SKU. Destination: **Nha Trang, Vietnam**, currency: **VND**, quantity: **one package**. Delivery for bulk quantities must be quoted separately. [Price-only table](known-prices.md) lists confirmed prices independently of specification gaps.\n\n';
function visualReview(offer, label = 'review') {
  if (publicationByOffer.get(offer.id)?.manualVisualReview === false) {
    return 'Manual review pending';
  }
  const sku = reviewedSkus.get(offer.sku);
  if (sku?.price === offer.price) {
    return link(
      label,
      `../acceptance/browser-sku-review/README.md#sku-${offer.sku}`
    );
  }
  const page = reviewByUrl.get(offer.url);
  if (page?.id === offer.productId && page.price === offer.price) {
    return link(
      label,
      `../acceptance/visual-review/README.md#listing-${page.index}`
    );
  }
  return 'Manual review pending';
}
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
    visualReview(offer),
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
const knownPriceRows = entries.filter(
  (row) =>
    row.offer.price > 0 &&
    row.offer.variantConfirmed &&
    ['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
      row.product.category
    )
);
const priceOnlyHeaders = [
  'Listing',
  'Selected option',
  'SKU',
  'Price VND',
  'Captured at',
  'Price context',
  'Verification',
];
const priceOnlyRows = (rows) =>
  rows.map(({ product, offer }) => [
    link(product.title, offer.url),
    variant(product),
    offer.sku || 'Not supplied by listing',
    number(offer.price),
    offer.observedAt,
    offer.priceContext === 'authenticated-browser-observation'
      ? 'Signed-in page'
      : 'Public page',
    visualReview(offer, 'Screenshot checked'),
  ]);
await save(
  'known-prices.md',
  `# Captured selected-SKU prices, cheapest first\n\n${knownPriceRows.length} confirmed selected-SKU price observations. All rows have a positive captured price. These historical captures remain available offline; they do not establish current stock, freight, exact manufacturer specifications or the lowest price across uncollected listings.\n\n## Protein powders\n\n${table(priceOnlyHeaders, priceOnlyRows(knownPriceRows.filter((row) => ['whey', 'protein-powder'].includes(row.product.category))))}\n\n## Chocolate ice cream\n\n${table(priceOnlyHeaders, priceOnlyRows(knownPriceRows.filter((row) => row.product.category === 'chocolate-ice-cream')))}\n\n[Before/after delivery and unit costs for powders](protein-powder.md) · [Before/after delivery and unit costs for ice cream](chocolate-ice-cream.md) · [Missing prices requiring collection](missing-sku-prices.md)`
);
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
  `# Manufacturer specification status for every captured food candidate\n\nAn official-domain candidate is a lead, not an exact variant match. Automatic verification requires matching GTIN or brand plus manufacturer SKU. An explicit visual review can also match exact brand, product, flavour and food package against published factory labels, with reviewer identity and field evidence retained. Every required specification must be sourced to the matched official evidence. Listing errors retain their original claims and a correction ledger when exact official evidence replaces them.\n\n${table(
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
const verified = entries
  .filter((row) => row.manufacturerVerified)
  .sort(
    (a, b) =>
      (a.metrics.costPerProteinGramBeforeDelivery ?? Infinity) -
      (b.metrics.costPerProteinGramBeforeDelivery ?? Infinity)
  );
const verifiedRows = verified.map(
  ({ product, offer, metrics, eligible, problems }) => [
    link(product.title, offer.url),
    variant(product),
    offer.sku,
    number(offer.price),
    number(offer.shipping),
    number(product.netMassG),
    product.proteinType,
    number(product.proteinPer100g),
    number(product.sugarPer100g),
    number(product.fatPer100g),
    number(product.saturatedFatPer100g),
    number(product.kcalPer100g),
    pair(metrics.costPerGramBeforeDelivery, metrics.costPerGramAfterDelivery),
    pair(
      metrics.costPerProteinGramBeforeDelivery,
      metrics.costPerProteinGramAfterDelivery
    ),
    eligible ? 'Passes captured one-package checks' : problems.join('; '),
    link('Factory', product.manufacturerVerification.sourceUrl),
  ]
);
const verifiedHeaders = [
  'Listing',
  'Selected option',
  'SKU',
  'Price VND',
  'Freight (one package)',
  'Verified mass g',
  'Whey type',
  'Protein /100g',
  'Sugars /100g',
  'Fat /100g',
  'Saturated fat /100g',
  'kcal /100g',
  'VND /food g before → after',
  'VND /protein g before → after',
  'Captured comparison status',
  'Manufacturer',
];
await save(
  'verified-comparison.md',
  `# Manufacturer-verified comparison\n\n**${verified.length} captured candidates have complete exact manufacturer specifications. ${comparison.ranked.length} offers pass the one-package comparison checks for these historical captures.**\n\nSorted by cost per gram of protein before delivery. All nutrition columns use the exact flavour label. Freight applies to one package, and historical prices require an online refresh before buying. Bulk freight and current stock are still pending. Powder volume is not a declared purchase unit.\n\n${verified.length ? table(verifiedHeaders, verifiedRows) : 'No verified comparison rows are available. Manufacturer matches, nutrition, package identity, destination freight, stock and frozen delivery remain prerequisites. The provisional inventory is linked below, without a cheapest-product claim.'}\n\n[Protein-powder inventory](protein-powder.md) · [Ice-cream inventory](chocolate-ice-cream.md) · [Specification gaps](manufacturer-specifications.md) · [Coverage gaps](README.md)`
);
await save(
  'README.md',
  `# Lazada Vietnam catalog and comparison tables\n\n**Collection and manufacturer verification are incomplete. This dataset is not ready to establish the cheapest available bulk purchase.** Captured at the dates in [catalog.json](catalog.json); destination Nha Trang, VND.\n\n| Check | Result |\n| --- | --- |\n| Captured confirmed food SKU prices | ${knownPriceRows.length} |\n| Visually checked selected-page prices | ${entries.filter((row) => visualReview(row.offer) !== 'Manual review pending').length} |\n| Complete exact manufacturer specifications | ${audit.verifiedProducts} |\n| Missing discovered product records | ${audit.missingListings.length} |\n| Missing individual SKU prices | ${audit.missingSkuPrices.length} |\n| Unfinished search scopes | ${audit.unfinishedSearches.length} |\n| Unclassified discovery observations | ${audit.categoryReview.length} |\n| Whole-market completeness | Unverifiable from public search |\n\n- [Captured selected-SKU prices, sorted cheapest first](known-prices.md)\n- [Authenticated product-capture publication report](../acceptance/account-publication.json)\n- [Complete committed case archive](../../data/cases/vietnam-nha-trang/README.md)\n- [All captured protein-powder offers](protein-powder.md)\n- [All captured chocolate ice-cream candidates and quarantines](chocolate-ice-cream.md)\n- [Manufacturer links, missing specifications and raw nutrition for every candidate](manufacturer-specifications.md)\n- [Manufacturer-verified comparison](verified-comparison.md)\n- [Every missing discovered listing](missing-listings.md)\n- [Every known missing SKU price](missing-sku-prices.md)\n- [All category-review observations](category-review.md)\n- [Manual visual inspection with screenshots](../acceptance/visual-review/README.md)\n- [Additional SKU screenshots and rejected selections](../acceptance/browser-sku-review/README.md)\n- [Factory label reviews and corrected values](../acceptance/manufacturer-labels/README.md)\n- [Synthetic verified calculation example](synthetic-example.md)\n\n## Reproduce without website requests\n\n\`\`\`sh\nnode bin/lazada-search.js archive-verify --offline --no-ocr\nnode scripts/export-catalog-tables.mjs --offline\nnode bin/lazada-search.js audit --strict --offline --no-ocr\n\`\`\`\n\nThe last command deliberately exits unsuccessfully while any completeness claim is unproven. For a new public collection use \`crawl --exhaustive\`; it visits observed pagination, records every discovered candidate and stops on challenges. Exhausting those searches establishes only a searched scope, not an authoritative whole-market catalog. No global cheapest guarantee is issued.\n\nPublic requests previously encountered app-only pages and security redirects. ${publications.length ? `${publications.length} product captures from the authenticated browser are now published as redacted product HTML and derived records. Account-collected price observations are marked as signed-in observations; they retain their capture times and are not manual visual reviews. [Publication report](../acceptance/account-publication.json) records published sources and rejected SKU selections. The account successfully signed in during collection; this snapshot does not attest to the current session state.` : `No authenticated product captures have been published in this snapshot.`} Exact manufacturer verification, current stock, Nha Trang freight, frozen delivery and complete search pagination remain unresolved. One-package quotes cannot establish bulk freight.\n\nBefore/after unit costs use (price × quantity + quoted freight − confirmed fixed discount) divided by confirmed food mass, volume or protein mass. Unknown denominators and shipping stay unknown. One-package freight is never extrapolated to a bulk order. A standard ice-cream freight quote does not establish frozen delivery.`
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
    tables: 11,
    observed: entries.length,
    manufacturerVerified: verified.length,
    missingListings: audit.missingListings.length,
    missingSkuPrices: audit.missingSkuPrices.length,
  })
);
