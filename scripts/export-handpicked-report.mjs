import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { LazadaSearch, productFlavour } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { powderCategory, reportUnitCosts } from './report-unit-costs.mjs';

const options = parseArguments(process.argv.slice(2));
assert.ok(!options.account, 'Use previously redacted public sources only');
const linksPath = 'docs/acceptance/top10-check/handpicked-links.json';
const links = JSON.parse(await readFile(linksPath, 'utf8'));
const top = JSON.parse(
  await readFile('docs/tables/top-10-partial.json', 'utf8')
);
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
const listingOf = (sku) => sku.split('_VNAMZ-')[0];
const groups = {
  wheyFoodGram: top.whey || [],
  wheyProteinGram:
    top.verifiedProteinCategory === 'whey' ? top.verifiedProtein || [] : [],
  soyProteinGram: top.soyProtein || [],
};
const money = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : 'Pending exact evidence';
const cell = (value) =>
  String(value)
    .replaceAll('|', '&#124;')
    .replace(/[\r\n]/gu, ' ');
const table = (headers, rows) =>
  [headers, headers.map(() => '---'), ...rows]
    .map((row) => `| ${row.map(cell).join(' | ')} |`)
    .join('\n');
function resolvedStatus(cached, exactSku, listingId) {
  if (cached) {
    return 'Exact resolved SKU found in public cached observations';
  }
  if (exactSku) {
    return 'Exact resolved SKU not captured; no substitute priced';
  }
  if (listingId) {
    return 'Listing resolved but exact selling SKU pending; no option inferred';
  }
  return 'Short URL unresolved; product identity and price pending';
}
function cachedFacts(cached) {
  if (!cached) {
    return {
      cachedTitle: null,
      selectedVariant: null,
      category: null,
      flavour: null,
      selectedFlavour: null,
      strictChocolateOrPlain: false,
      available: null,
      eligibleWheyRanking: false,
      manufacturerVerified: false,
      priceVnd: null,
      originalPriceVnd: null,
      observedAt: null,
      costs: null,
    };
  }
  const product = cached.product;
  const offer = cached.offer;
  const flavour = productFlavour(product);
  const selectedFlavour = productFlavour({
    category: product.category,
    title: '',
    selectedVariant: product.selectedVariant,
  });
  const strictChocolateOrPlain = ['chocolate', 'unflavoured'].includes(flavour);
  return {
    cachedTitle: product.title,
    selectedVariant: product.selectedVariant,
    category: powderCategory(product),
    flavour,
    selectedFlavour,
    strictChocolateOrPlain,
    available: offer.available,
    eligibleWheyRanking:
      strictChocolateOrPlain &&
      powderCategory(product) === 'whey' &&
      offer.variantConfirmed &&
      offer.price > 0 &&
      offer.available !== false,
    manufacturerVerified: cached.manufacturerVerified,
    priceVnd: offer.price,
    originalPriceVnd: offer.originalPrice,
    observedAt: offer.observedAt,
    costs: reportUnitCosts(cached, { quantity: 1, deliveryArea: 'Nha Trang' }),
  };
}
try {
  const comparison = await app.compare({ quantity: 1, allowStale: true });
  const rows = links.entries.map((entry) => {
    const listingId = String(entry.listingId ?? '') || null;
    const skuId = String(entry.skuId ?? '') || null;
    const exactSku = listingId && skuId ? `${listingId}_VNAMZ-${skuId}` : null;
    const cached =
      comparison.comparisons.find((row) => row.offer.sku === exactSku) || null;
    const listingCandidates = comparison.comparisons
      .filter((row) => listingOf(row.offer.sku) === listingId)
      .map((row) => ({
        sku: row.offer.sku,
        title: row.product.title,
        selectedVariant: row.product.selectedVariant,
        priceVnd: row.offer.price,
        observedAt: row.offer.observedAt,
      }));
    const membership = Object.fromEntries(
      Object.entries(groups).map(([key, group]) => [
        key,
        {
          listingMatch: Boolean(
            listingId && group.some((row) => listingOf(row.sku) === listingId)
          ),
          exactSkuMatch: Boolean(
            exactSku && group.some((row) => row.sku === exactSku)
          ),
        },
      ])
    );
    return {
      labelProvidedByUser: entry.labelProvidedByUser,
      originalUrl: entry.originalUrl,
      redirectStatus: entry.status,
      resolvedUrl: entry.resolvedUrl || null,
      listingId,
      skuId,
      exactSku,
      status: resolvedStatus(cached, exactSku, listingId),
      ...cachedFacts(cached),
      membership,
      listingCandidates,
      publishedConditionalTop10Calculation:
        groups.wheyFoodGram.find(
          (row) => row.sku === exactSku && row.conditional
        ) || null,
    };
  });
  const resolvedListingIds = rows
    .filter((row) => row.listingId)
    .map((row) => row.listingId);
  const resolvedExactSkus = rows
    .filter((row) => row.exactSku)
    .map((row) => row.exactSku);
  const membershipCounts = Object.fromEntries(
    Object.keys(groups).map((key) => [
      key,
      {
        submittedListingMatches: rows.filter(
          (row) => row.membership[key].listingMatch
        ).length,
        submittedExactSkuMatches: rows.filter(
          (row) => row.membership[key].exactSkuMatch
        ).length,
        uniqueListingMatches: new Set(
          rows
            .filter((row) => row.membership[key].listingMatch)
            .map((row) => row.listingId)
        ).size,
        uniqueExactSkuMatches: new Set(
          rows
            .filter((row) => row.membership[key].exactSkuMatch)
            .map((row) => row.exactSku)
        ).size,
      },
    ])
  );
  const receipt = {
    generatedAt: new Date().toISOString(),
    linksCheckedAt: links.checkedAt,
    top10GeneratedAt: top.generatedAt,
    market: 'Vietnam',
    deliveryArea: 'Nha Trang',
    currency: 'VND',
    complete: rows.every(
      (row) =>
        row.costs && row.strictChocolateOrPlain && row.manufacturerVerified
    ),
    downloads: app.cache.stats.downloads,
    sourceLinks: linksPath,
    counts: {
      submittedRows: rows.length,
      resolvedListingRows: resolvedListingIds.length,
      resolvedExactSkuRows: resolvedExactSkus.length,
      capturedExactSkuRows: rows.filter((row) => row.costs).length,
      duplicateResolvedListingRows:
        resolvedListingIds.length - new Set(resolvedListingIds).size,
      duplicateResolvedExactSkuRows:
        resolvedExactSkus.length - new Set(resolvedExactSkus).size,
      memberships: membershipCounts,
    },
    limits:
      'No identity inferred from user labels or similar titles. A resolved listing alone does not identify its selling option. Cached observations retain their timestamps. Delivery metrics require the exact Nha Trang one-unit quote. Source-derived unit costs remain separate from any published conditional factory calculation. Manufacturer matching does not establish seller authenticity.',
    rows,
  };
  assert.equal(app.cache.stats.downloads, 0);
  const body = `# User-picked Lazada links: exact identity and unit costs\n\nUpdated ${receipt.generatedAt}. Public cached sources only, Vietnam / Nha Trang, VND. ${receipt.limits}\n\n${rows.length} submitted rows; ${receipt.counts.resolvedListingRows} resolved listing identities; ${receipt.counts.resolvedExactSkuRows} resolved selling SKUs; ${receipt.counts.capturedExactSkuRows} exact SKUs with cached observations. Duplicate counts are ${receipt.counts.duplicateResolvedListingRows} resolved listing rows and ${receipt.counts.duplicateResolvedExactSkuRows} resolved exact SKU rows. Two similarly named links are never assumed to be duplicates.\n\n${table(
    [
      'Submitted label / link',
      'Exact resolved SKU',
      'Saved sale VND',
      'Food packages / unit',
      'Food g / unit',
      'VND/food g before',
      'VND/food g delivered',
      'VND/protein g before',
      'VND/protein g delivered',
      'Source / flavour / available',
      'Whey scope eligible',
      'Manufacturer matched',
      'Observed UTC',
      'Status',
    ],
    rows.map((row) => [
      `[${row.labelProvidedByUser}](${row.originalUrl})`,
      row.exactSku || 'Pending exact redirect / SKU',
      money(row.priceVnd),
      money(row.costs?.packagesPerSellingUnit),
      money(row.costs?.massG),
      money(row.costs?.beforePerFoodGram),
      money(row.costs?.afterPerFoodGram),
      money(row.costs?.beforePerProteinGram),
      money(row.costs?.afterPerProteinGram),
      `${row.category || 'pending'} / ${row.flavour || 'pending'} / ${row.available ?? 'pending'}`,
      row.eligibleWheyRanking ? 'Yes' : 'No / pending',
      row.manufacturerVerified ? 'Yes' : 'No / pending',
      row.observedAt || 'Pending',
      row.status,
    ])
  )}\n\n## Intersection with the published top tens\n\nListing-level membership means another selling option from that listing may appear in the table; it does not establish that the submitted exact SKU is ranked.\n\n${table(
    [
      'Ranking',
      'Submitted listing matches',
      'Submitted exact-SKU matches',
      'Unique listing matches',
      'Unique exact-SKU matches',
    ],
    Object.entries(membershipCounts).map(([key, value]) => [
      key,
      value.submittedListingMatches,
      value.submittedExactSkuMatches,
      value.uniqueListingMatches,
      value.uniqueExactSkuMatches,
    ])
  )}\n\n[Machine-readable receipt](handpicked.json) includes exact option text, alternative cached SKU identities for resolved listings, source timestamps and any separately published conditional factory calculation. Unresolved links remain unpriced. Ingredient-based whey and soy categories remain separate. No bulk shipping or food millilitres are inferred.\n`;
  await writeFile(
    'docs/tables/handpicked.json',
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  const style = await resolveConfig('docs/tables/handpicked.md');
  await writeFile(
    'docs/tables/handpicked.md',
    await format(body, { ...style, parser: 'markdown' })
  );
  console.log(
    JSON.stringify({ ...receipt.counts, downloads: receipt.downloads })
  );
} finally {
  await app.close();
}
