import { categorySourceKey, listingKey } from '../src/text.js';
import { productFlavour, isShakerBundle } from '../src/flavour-scope.js';

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
    return filterFlavourTasks(audit, flavourScope);
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
  return filterFlavourTasks(filtered, flavourScope);
}
