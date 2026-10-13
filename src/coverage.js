import { specificationProblems } from './verification.js';
import { listingKey } from './util.js';
import { categorySourceKey } from './text.js';
import { currentUnavailableListings } from './availability.js';
import { workflowSourceInvalidated } from './source-invalidation.js';

const skuNumber = (value) =>
  String(value || '')
    .split('_VNAMZ-')
    .at(-1);

function capturedSkuObservations(products, offers, invalidations) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const observations = new Map();
  for (const offer of offers) {
    const product = byId.get(offer.productId);
    const observed = Date.parse(offer.observedAt);
    if (
      !product ||
      !product.sku ||
      !offer.sku ||
      offer.variantConfirmed !== true ||
      !offer.evidenceId ||
      !product.evidenceIds?.includes(offer.evidenceId) ||
      !Number.isFinite(observed) ||
      observed !== Date.parse(product.observedAt) ||
      skuNumber(product.sku) !== skuNumber(offer.sku) ||
      listingKey(product.url) !== listingKey(offer.url) ||
      !['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
        product.category
      )
    ) {
      continue;
    }
    const source = {
      ...offer,
      id: offer.evidenceId,
      url: offer.url,
      observedAt: offer.observedAt,
    };
    if (workflowSourceInvalidated(source, [], invalidations)) {
      continue;
    }
    const selectedVariant = product.selectedVariant || [];
    observations.set(`${listingKey(offer.url)}:${skuNumber(offer.sku)}`, {
      listingUrl: product.url,
      url: offer.url,
      sku: offer.sku,
      title: product.title,
      category: product.category,
      selectedVariant,
      options: selectedVariant.map((option) => ({
        name: option.name || option.dimension || '',
        value: option.text || '',
      })),
      productId: product.id,
      offerId: offer.id,
      observedAt: offer.observedAt,
      available: offer.available,
      sourceRecordIds: [product.id, offer.id],
      sourceEvidenceIds: [offer.evidenceId],
      sourceAuthority: 'marketplace',
      sourceUrl: offer.url,
      observationKind: 'captured-selected-sku',
      ...(product.manufacturerVerification
        ? { manufacturerVerification: product.manufacturerVerification }
        : {}),
    });
  }
  return [...observations.values()];
}

function matchesConfiguredScope(scope, { query, categoryUrl }) {
  if (scope.query === query) {
    return true;
  }
  if (
    !categoryUrl ||
    (scope.type && scope.type !== 'category') ||
    (scope.type !== 'category' && !scope.query?.startsWith('category:'))
  ) {
    return false;
  }
  const expected = categorySourceKey(categoryUrl);
  const observed = categorySourceKey(
    scope.url || scope.query?.slice('category:'.length)
  );
  return expected !== null && expected === observed;
}

export function auditCoverage({
  crawl,
  products = [],
  offers = [],
  discoveries = [],
  skuInventories = [],
  availability = [],
  invalidations = [],
} = {}) {
  const unavailable = currentUnavailableListings(
    availability,
    offers,
    invalidations
  );
  const availableListing = (url) => !unavailable.has(listingKey(url));
  const active = offers.filter(
    (offer) => !offer.supersededBy && availableListing(offer.url)
  );
  const currentInventories = skuInventories.filter((inventory) =>
    availableListing(inventory.url)
  );
  const byUrl = new Map();
  for (const product of products) {
    const url = listingKey(product.url);
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
  ].filter((url) => availableListing(url) && !byUrl.has(listingKey(url)));
  const categoryReview = discoveries.filter(
    (entry) =>
      availableListing(entry.url) &&
      entry.classification === 'needs-category-review'
  );
  const missingSkuPrices = [];
  const unknownSkuInventories = [
    ...new Set([
      ...currentInventories
        .filter((inventory) => inventory.inventoryObserved !== true)
        .map((inventory) => inventory.url),
      ...active
        .filter(
          (offer) =>
            !currentInventories.some(
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
  const missing = new Map();
  for (const inventory of [...currentInventories].sort((a, b) =>
    String(b.observedAt || '').localeCompare(String(a.observedAt || ''))
  )) {
    for (const sku of inventory.skus || []) {
      // A selected-page price cannot be reused for every flavour or package size.
      if (
        !active.some(
          (offer) =>
            (listingKey(offer.url) === listingKey(inventory.url) ||
              (sku.url && listingKey(offer.url) === listingKey(sku.url))) &&
            skuNumber(offer.sku) === skuNumber(sku.sku) &&
            offer.price > 0 &&
            offer.variantConfirmed
        )
      ) {
        const key = `${listingKey(inventory.url)}:${skuNumber(sku.sku)}`;
        if (missing.has(key)) {
          continue;
        }
        missing.set(key, {
          listingUrl: inventory.url,
          sku: sku.sku,
          url: sku.url,
          options: sku.options,
          available: sku.available,
          observedAt: inventory.observedAt,
          sourceRecordIds: [inventory.id, inventory.cacheId].filter(Boolean),
          sourceAuthority: 'marketplace',
          observationKind: 'inventory-option',
        });
      }
    }
  }
  missingSkuPrices.push(...missing.values());
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
  const scopes = [...(crawl?.scopes || [])];
  for (const configured of [
    ...(crawl?.queries || []).map((query) => ({ query })),
    ...(crawl?.categoryUrls || []).map((categoryUrl) => ({
      query: `category:${categoryUrl}`,
      categoryUrl,
    })),
  ]) {
    if (!scopes.some((scope) => matchesConfiguredScope(scope, configured))) {
      scopes.push({
        query: configured.query,
        terminalConfirmed: false,
        visitedPages: 0,
        stopReason: 'not-started',
      });
    }
  }
  const unfinishedSearches = scopes.filter((scope) => !scope.terminalConfirmed);
  const globalCoverage =
    crawl?.globalCoverage || 'unverifiable-with-public-search';
  const sourceListsComplete =
    scopes.length > 0 &&
    unfinishedSearches.length === 0 &&
    !(crawl?.failures || []).length;
  const visibleSearchComplete =
    sourceListsComplete &&
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
    sourceListsComplete,
    visibleSearchComplete,
    scopedDatasetReady: ready,
    searchedScopes: scopes.length,
    unfinishedSearches,
    missingListings,
    missingSkuPrices,
    capturedSkuObservations: capturedSkuObservations(
      products,
      active,
      invalidations
    ),
    categoryReview,
    missingPrices,
    unknownSkuInventories,
    unavailableListings: [...unavailable.values()],
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
