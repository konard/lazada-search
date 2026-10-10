import { listingKey } from '../src/util.js';
import { positive } from '../src/values.js';

export const MAX_ACCOUNT_BATCH_SIZE = 25;
export const VN_FACTORY_PRIORITY_URLS = Object.freeze(
  ['1225994167', '2205403447', '1869611936', '1820626958', '3095127497'].map(
    (item) => `https://www.lazada.vn/products/pdp-i${item}.html`
  )
);

function selectedSkuUrl(entry) {
  const source = entry.url || entry.listingUrl;
  if (!source) {
    return undefined;
  }
  if (!entry.sku) {
    return source;
  }
  const url = new URL(source);
  if (url.searchParams.has('skuId') || /-s\d+\.html$/u.test(url.pathname)) {
    return source;
  }
  url.searchParams.set('skuId', String(entry.sku).split('_VNAMZ-').at(-1));
  return url.href;
}

// Each selected URL remains a separate task; priority groups sibling options
// by their listing identity without inferring quality from search-card prices.
export function orderAccountBacklog(audit, { priorityUrls = [] } = {}) {
  const skuGaps = audit.missingSkuPrices || [];
  const urls = [
    ...new Set(
      [
        ...(audit.missingListings || []),
        ...skuGaps
          .filter((entry) => entry.available !== false)
          .map(selectedSkuUrl),
        ...(audit.missingPrices || []).map(selectedSkuUrl),
        ...(audit.unknownSkuInventories || []),
        ...skuGaps
          .filter((entry) => entry.available === false)
          .map(selectedSkuUrl),
      ].filter(Boolean)
    ),
  ];
  const priorities = new Map();
  for (const url of priorityUrls) {
    const key = listingKey(url);
    if (!priorities.has(key)) {
      priorities.set(key, priorities.size);
    }
  }
  const rank = (url) => priorities.get(listingKey(url)) ?? priorities.size;
  return urls.sort((left, right) => rank(left) - rank(right));
}

export function accountBacklogBatch(
  audit,
  {
    priorityUrls = [],
    batchSize = MAX_ACCOUNT_BATCH_SIZE,
    exhaustive = false,
    maxProducts = 100,
  } = {}
) {
  positive(batchSize, 'batchSize', { integer: true });
  if (!exhaustive) {
    positive(maxProducts, 'maxProducts', { integer: true });
  }
  const ordered = orderAccountBacklog(audit, { priorityUrls });
  const limit = Math.min(
    batchSize,
    MAX_ACCOUNT_BATCH_SIZE,
    exhaustive ? Infinity : maxProducts
  );
  return {
    urls: ordered.slice(0, limit),
    totalQueued: ordered.length,
    remainingAfterBatch: Math.max(0, ordered.length - limit),
    batchLimit: limit,
  };
}

export function accountBacklogFlags({
  batchSize = MAX_ACCOUNT_BATCH_SIZE,
  categoryOnly = false,
  flavourScope = 'all',
  priorityUrl = [],
}) {
  return [
    '--batch-size',
    String(batchSize),
    categoryOnly ? '--category-only' : '--no-category-only',
    '--flavour-scope',
    flavourScope,
    ...priorityUrl.flatMap((url) => ['--priority-url', url]),
  ];
}
