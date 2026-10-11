import { categorySourceKey, listingKey } from '../src/text.js';
import { productFlavour, isShakerBundle } from '../src/flavour-scope.js';
import { targetCategoryExclusion } from '../src/target-category.js';

export { categorySourceKey };

function recordListingKeys(record) {
  const urls =
    typeof record === 'string' ? [record] : [record.listingUrl, record.url];
  return urls.flatMap((url) => {
    try {
      return [listingKey(url)];
    } catch {
      return [];
    }
  });
}

function filterFlavourTasks(audit, flavourScope) {
  if (flavourScope === 'all') {
    return audit;
  }
  if (flavourScope !== 'chocolate-or-unflavoured') {
    throw new Error('Unsupported flavour scope');
  }
  const excludedFlavourTasks = [...(audit.excludedFlavourTasks || [])];
  const missingSkuPrices = (audit.missingSkuPrices || []).filter((entry) => {
    const selectedVariant = Array.isArray(entry.options)
      ? entry.options.map((option) => ({ text: option.value }))
      : [];
    const flavour = productFlavour({ selectedVariant, title: '' });
    const shaker = isShakerBundle({ selectedVariant });
    if (flavour !== 'other' && !shaker) {
      return true;
    }
    excludedFlavourTasks.push({
      ...entry,
      extractedFlavour: flavour,
      reason: shaker
        ? 'Selected SKU includes a shaker; the buyer already owns one'
        : 'Selected SKU flavour is outside chocolate-or-unflavoured scope',
    });
    return false;
  });
  return { ...audit, missingSkuPrices, excludedFlavourTasks };
}

function filterTargetCategoryTasks(audit, discoveries, flavourScope) {
  if (flavourScope !== 'chocolate-or-unflavoured') {
    return audit;
  }
  const byListing = new Map();
  for (const record of [
    ...discoveries,
    ...(audit.categoryReview || []),
    ...(audit.specifications || []),
  ]) {
    if (!record.title?.trim()) {
      continue;
    }
    for (const key of recordListingKeys(record)) {
      const entries = byListing.get(key) || [];
      entries.push(record);
      byListing.set(key, entries);
    }
  }
  const exclusions = new Map();
  for (const [key, records] of byListing) {
    const reasons = records.map((record) =>
      targetCategoryExclusion(record.title)
    );
    // Conflicting or uncertain titles remain in the collection backlog.
    if (reasons.every(Boolean)) {
      exclusions.set(key, {
        listingKey: key,
        titles: [...new Set(records.map((record) => record.title))],
        sourceUrls: [
          ...new Set(
            records
              .flatMap((record) => [
                record.sourceUrl,
                ...(record.sourceUrls || []),
              ])
              .filter(Boolean)
          ),
        ],
        sourceRecordIds: [
          ...new Set(records.map((record) => record.id).filter(Boolean)),
        ],
        reasons: [...new Set(reasons)],
      });
    }
  }
  const result = {
    ...audit,
    excludedCategoryListings: [...exclusions.values()],
  };
  for (const field of [
    'missingListings',
    'missingSkuPrices',
    'missingPrices',
    'unknownSkuInventories',
    'categoryReview',
    'specifications',
  ]) {
    result[field] = (audit[field] || []).filter(
      (record) => !recordListingKeys(record).some((key) => exclusions.has(key))
    );
  }
  result.verifiedProducts = result.specifications.filter(
    (entry) => entry.problems.length === 0
  ).length;
  return result;
}

function activeSourceKeys(crawl, categoryOnly) {
  return new Set(
    (crawl?.scopes || [])
      .filter((scope) => !categoryOnly || scope.type === 'category')
      .map((scope) => categorySourceKey(scope.url))
      .filter(Boolean)
  );
}

function discoveredListingKeys(discoveries, sources) {
  const listings = new Set();
  for (const discovery of discoveries) {
    const sourceUrls = [discovery.sourceUrl, ...(discovery.sourceUrls || [])];
    if (sourceUrls.some((url) => sources.has(categorySourceKey(url)))) {
      for (const key of recordListingKeys(discovery)) {
        listings.add(key);
      }
    }
  }
  return listings;
}

// Source pages select listings; strict flavour scope applies only to exact
// selected SKU options. Unknown options still require collection.
export function scopeAccountAudit(
  audit,
  {
    categoryOnly = false,
    activeSourcesOnly = false,
    flavourScope = 'all',
    crawl,
    discoveries = [],
  } = {}
) {
  if (!categoryOnly && !activeSourcesOnly) {
    return filterFlavourTasks(
      filterTargetCategoryTasks(audit, discoveries, flavourScope),
      flavourScope
    );
  }
  const sources = activeSourceKeys(crawl, categoryOnly);
  if (!sources.size) {
    throw new Error(
      categoryOnly
        ? 'Category-only backlog requires a crawl with category source scopes'
        : 'Scoped backlog requires a crawl with active source scopes'
    );
  }
  const listings = discoveredListingKeys(discoveries, sources);
  const inScope = (record) =>
    recordListingKeys(record).some((key) => listings.has(key));
  const filtered = { ...audit };
  for (const field of [
    'missingListings',
    'missingSkuPrices',
    'missingPrices',
    'unknownSkuInventories',
    'categoryReview',
    'specifications',
  ]) {
    filtered[field] = (audit[field] || []).filter(inScope);
  }
  filtered.verifiedProducts = filtered.specifications.filter(
    (entry) => entry.problems.length === 0
  ).length;
  filtered[categoryOnly ? 'backlogCategoryScope' : 'backlogCollectionScope'] = {
    sourceUrls: [...sources],
    listingCount: listings.size,
  };
  return filterFlavourTasks(
    filterTargetCategoryTasks(
      filtered,
      discoveries.filter(inScope),
      flavourScope
    ),
    flavourScope
  );
}
