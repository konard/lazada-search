import { mkdir, writeFile } from 'node:fs/promises';
import {
  LazadaSearch,
  AssociativeStore,
  EvidenceCache,
  BrowserCollector,
  TesseractOcr,
  MARKETS,
  manufacturerCandidates,
  auditCoverage,
} from '../src/index.js';
import { parseArguments } from '../src/config.js';
import { categoryOf, parsePrice } from '../src/nutrition.js';
import { canonicalUrl, sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
const store = new AssociativeStore({ directory: options.dataDir });
const cache = new EvidenceCache({ store, offline: true });
const collector = new BrowserCollector({ store, cache });
collector.start = () => {
  throw new Error('Cached audit must never start a browser');
};
const app = new LazadaSearch({
  store,
  cache,
  collector,
  market: options.market,
  deliveryArea: options.deliveryArea,
  maxImages: 40,
  ocr: options.ocr
    ? new TesseractOcr({
        store,
        languages: options.ocrLanguages,
        tessdataDir: options.ocrDataDir || undefined,
      })
    : false,
});
const captures = (await store.list('cache')).filter(
  (entry) =>
    entry.id.startsWith(`search:${options.market}:${options.deliveryArea}:`) ||
    entry.id.startsWith(`lazada:${options.market}:${options.deliveryArea}:`)
);
const crawl = {
  id: `crawl:cached-audit:${new Date().toISOString()}`,
  startedAt: new Date().toISOString(),
  coverage: 'cached-public-pages',
  complete: false,
  globalCoverage: 'unverifiable-with-public-search',
  visibleSearchComplete: false,
  pages: [],
  products: [],
  failures: [],
  scopes: [],
  uncollectedUrls: [],
};
for (const capture of captures.filter((entry) =>
  entry.id.startsWith('search:')
)) {
  const page = await collector.page(capture.url, {
    namespace: `search:${options.market}:${options.deliveryArea}`,
  });
  const query = new URL(capture.url).searchParams.get('q');
  crawl.pages.push({
    url: capture.url,
    query,
    status: page.status,
    ...page.snapshot.searchCoverage,
    observedAt: new Date(page.fetchedAt).toISOString(),
  });
  for (const card of page.snapshot.cards || []) {
    let url;
    try {
      url = canonicalUrl(card.url);
      app.assertMarket(url);
    } catch {
      continue;
    }
    if (!new URL(url).pathname.includes('/products/')) {
      continue;
    }
    const category = categoryOf(card.title);
    await store.put('discovery', {
      id: `discovery:${sha256(`${capture.url}:${url}:${card.sku || ''}`)}`,
      url,
      title: card.title || '',
      sku: card.sku || null,
      category,
      classification:
        category === 'unknown' ? 'needs-category-review' : 'candidate',
      sourceUrl: capture.url,
      query,
      cacheId: capture.id,
      observedAt: new Date(page.fetchedAt).toISOString(),
      searchPrice:
        parsePrice(card.priceText, MARKETS[options.market].currency) ?? null,
    });
  }
}
for (const query of MARKETS[options.market].queries) {
  const pages = crawl.pages.filter((page) => page.query === query);
  crawl.scopes.push({
    query,
    visitedPages: pages.length,
    terminalConfirmed: false,
    reportedTotal: pages[0]?.reportedTotal ?? null,
    lastPage: pages[0]?.lastPage ?? null,
    stopReason: pages.length
      ? 'public-access-challenge-and-unvisited-pagination'
      : 'not-yet-searched',
  });
}
for (const capture of captures.filter((entry) =>
  entry.id.startsWith('lazada:')
)) {
  try {
    const item = await app.collect(capture.url);
    crawl.products.push({
      id: item.product.id,
      url: capture.url,
      cacheHit: true,
    });
    console.log(
      JSON.stringify({
        url: capture.url,
        title: item.product.title,
        price: item.offer.price,
        skus: (await store.get('sku-inventory', capture.url))?.skus.length,
      })
    );
  } catch (error) {
    crawl.failures.push({
      url: capture.url,
      error: error.message.split('\n')[0],
    });
  }
}
const products = await store.list('product');
const offers = (await store.list('offer')).filter(
  (offer) => !offer.supersededBy
);
const discoveries = await store.list('discovery');
const known = new Set(products.map((product) => product.url));
crawl.uncollectedUrls = [
  ...new Set(
    discoveries
      .filter((entry) => entry.category !== 'unknown')
      .map((entry) => entry.url)
  ),
].filter((url) => !known.has(url));
await store.put('crawl', crawl);
const audit = auditCoverage({
  crawl,
  products,
  offers,
  discoveries,
  skuInventories: await store.list('sku-inventory'),
});
const sourceInventory = products
  .filter((product) => offers.some((offer) => offer.productId === product.id))
  .map((product) => ({
    productId: product.id,
    url: product.url,
    title: product.title,
    category: product.category,
    selectedVariant: product.selectedVariant,
    manufacturerCandidates: manufacturerCandidates(product),
    verification: product.manufacturerVerification || null,
  }));
for (const record of sourceInventory) {
  await store.put('manufacturer-search', {
    id: record.productId,
    ...record,
    searchedAt: new Date().toISOString(),
  });
}
await mkdir('docs/acceptance', { recursive: true });
await writeFile(
  'docs/acceptance/catalog-audit.json',
  `${JSON.stringify(
    {
      ...audit,
      checkedAt: new Date().toISOString(),
      downloads: cache.stats.downloads,
      browserStarts: 0,
    },
    null,
    2
  )}\n`
);
await writeFile(
  'docs/acceptance/manufacturer-inventory.json',
  `${JSON.stringify(sourceInventory, null, 2)}\n`
);
await app.close();
console.log(
  JSON.stringify({
    collected: crawl.products.length,
    failures: crawl.failures.length,
    missingListings: audit.missingListings.length,
    missingSkuPrices: audit.missingSkuPrices.length,
    verifiedProducts: audit.verifiedProducts,
    cache: cache.stats,
  })
);
