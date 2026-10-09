import { specificationProblems } from './verification.js';
import { canonicalUrl } from './util.js';

const skuNumber = (value) =>
  String(value || '')
    .split('_VNAMZ-')
    .at(-1);

export function auditCoverage({
  crawl,
  products = [],
  offers = [],
  discoveries = [],
  skuInventories = [],
} = {}) {
  const active = offers.filter((offer) => !offer.supersededBy);
  const byUrl = new Map();
  for (const product of products) {
    const url = canonicalUrl(product.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, []);
    }
    byUrl.get(url).push(product);
  }
  const missingListings = [
    ...new Set([
      ...(crawl?.uncollectedUrls || []),
      ...discoveries
        .filter((entry) => entry.category !== 'unknown')
        .map((entry) => entry.url),
    ]),
  ].filter((url) => !byUrl.has(canonicalUrl(url)));
  const categoryReview = discoveries.filter(
    (entry) => entry.classification === 'needs-category-review'
  );
  const missingSkuPrices = [];
  const unknownSkuInventories = [
    ...new Set([
      ...skuInventories
        .filter((inventory) => inventory.inventoryObserved !== true)
        .map((inventory) => inventory.url),
      ...active
        .filter(
          (offer) =>
            !skuInventories.some(
              (inventory) =>
                inventory.url === offer.url ||
                inventory.skus?.some((sku) => sku.url === offer.url)
            )
        )
        .map((offer) => offer.url),
    ]),
  ];
  const missingPrices = active
    .filter((offer) => !(offer.price > 0))
    .map((offer) => ({
      offerId: offer.id,
      url: offer.url,
      sku: offer.sku || null,
    }));
  for (const inventory of skuInventories) {
    for (const sku of inventory.skus || []) {
      // A selected-page price cannot be reused for every flavour or package size.
      if (
        !active.some(
          (offer) =>
            (offer.url === inventory.url || offer.url === sku.url) &&
            skuNumber(offer.sku) === skuNumber(sku.sku) &&
            offer.price > 0 &&
            offer.variantConfirmed
        )
      ) {
        missingSkuPrices.push({
          listingUrl: inventory.url,
          sku: sku.sku,
          url: sku.url,
          options: sku.options,
          available: sku.available,
        });
      }
    }
  }
  const relevant = products.filter(
    (product) =>
      ['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
        product.category
      ) && active.some((offer) => offer.productId === product.id)
  );
  const specifications = relevant.map((product) => ({
    productId: product.id,
    url: product.url,
    title: product.title,
    problems: specificationProblems(product),
  }));
  const scopes = crawl?.scopes || [];
  const unfinishedSearches = scopes.filter((scope) => !scope.terminalConfirmed);
  const globalCoverage =
    crawl?.globalCoverage || 'unverifiable-with-public-search';
  const visibleSearchComplete =
    Boolean(crawl?.visibleSearchComplete) &&
    missingListings.length === 0 &&
    missingSkuPrices.length === 0 &&
    missingPrices.length === 0 &&
    unknownSkuInventories.length === 0 &&
    categoryReview.length === 0;
  const ready =
    visibleSearchComplete &&
    specifications.every((entry) => entry.problems.length === 0);
  return {
    complete: false,
    purchaseReady: false,
    globalCoverage,
    visibleSearchComplete,
    scopedDatasetReady: ready,
    searchedScopes: scopes.length,
    unfinishedSearches,
    missingListings,
    missingSkuPrices,
    categoryReview,
    missingPrices,
    unknownSkuInventories,
    specifications,
    verifiedProducts: specifications.filter(
      (entry) => entry.problems.length === 0
    ).length,
    failures: crawl?.failures || [],
    reason:
      'A public search does not supply an authoritative whole-market catalog; no global cheapest-price guarantee is issued.',
  };
}

export function assertCompleteCoverage(report) {
  if (!report.complete) {
    throw new Error(
      `Incomplete catalog: ${report.missingListings.length} missing listings; ${report.missingSkuPrices.length} missing SKU prices; ${report.unfinishedSearches.length} unfinished searches; ${report.globalCoverage}`
    );
  }
  return report;
}
