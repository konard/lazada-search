import { categoryOf, parsePrice } from './nutrition.js';
import { canonicalUrl, listingKey, positive, sha256 } from './util.js';

export function latestCrawl(reports) {
  const observed = (report) =>
    Date.parse(
      report.finishedAt ||
        report.startedAt ||
        report.id.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/u)?.[0] ||
        ''
    ) || 0;
  return [...reports].sort((a, b) => observed(b) - observed(a))[0];
}

function assertSearchPage(url, metadata) {
  const expectedPage = Number(new URL(url).searchParams.get('page') || 1);
  if (metadata.currentPage && metadata.currentPage !== expectedPage) {
    throw new Error(
      `Pagination mismatch: requested ${expectedPage}, displayed ${metadata.currentPage}`
    );
  }
}

function sortedUrl(value, sort) {
  const url = new URL(value);
  if (sort && sort !== 'default') {
    url.searchParams.set('sort', sort);
  }
  return canonicalUrl(url.href);
}

function assertCategoryPage(source, finalUrl) {
  if (source.type !== 'category' || !finalUrl) {
    return;
  }
  const expected = new URL(source.url);
  const actual = new URL(finalUrl);
  if (
    actual.hostname !== expected.hostname ||
    actual.pathname.replace(/\/+$/u, '') !==
      expected.pathname.replace(/\/+$/u, '')
  ) {
    throw new Error(
      `Category scope mismatch at ${actual.pathname}; review the redirect before continuing`
    );
  }
}

function crawlSources(app, queries, categoryUrls, searchSort) {
  if (!['default', 'priceasc', 'pricedesc'].includes(searchSort)) {
    throw new Error('Unsupported search sort');
  }
  return [
    ...queries.map((query) => ({
      query,
      url: sortedUrl(
        `https://${app.host}/catalog/?q=${encodeURIComponent(query)}`,
        searchSort
      ),
      type: 'keyword',
    })),
    ...categoryUrls.map((url) => {
      app.assertMarket(url);
      const canonical = sortedUrl(url, searchSort);
      return {
        query: `category:${canonical}`,
        url: canonical,
        type: 'category',
      };
    }),
  ];
}

function selectListings(queryQueues, knownUrls, limit) {
  const selected = [];
  for (const revisit of [false, true]) {
    const queues = queryQueues.map((queue) =>
      queue.filter((entry) => knownUrls.has(entry) === revisit)
    );
    for (let index = 0; selected.length < limit; index += 1) {
      const round = queues.map((queue) => queue[index]).filter(Boolean);
      if (!round.length) {
        break;
      }
      selected.push(...round.slice(0, limit - selected.length));
    }
  }
  return selected;
}

async function finishCrawl(
  app,
  report,
  { discovered, knownUrls, queries, stopped, selected }
) {
  report.discovered = discovered.size;
  report.uncollectedUrls = [...discovered].filter((url) => !knownUrls.has(url));
  report.uncollected = report.uncollectedUrls.length;
  report.visibleSearchComplete =
    report.scopes.length === queries.length &&
    report.scopes.every((scope) => scope.terminalConfirmed) &&
    report.failures.length === 0 &&
    report.uncollected === 0;
  // Search pagination cannot establish whether unindexed listings exist.
  report.globalCoverage = 'unverifiable-with-public-search';
  report.stopReason = stopped
    ? 'challenge-or-login'
    : report.discoveryOnly
      ? report.discoveryComplete
        ? 'discovery-complete'
        : 'discovery-incomplete'
      : !report.discoveryComplete
        ? 'discovery-incomplete'
        : selected.length < discovered.size
          ? 'product-limit'
          : report.visibleSearchComplete
            ? 'public-search-ended'
            : 'search-incomplete';
  report.cache = { ...app.cache.stats };
  report.finishedAt = new Date().toISOString();
  await app.store.put('crawl', report);
  return report;
}

export async function crawlMarketplace(
  app,
  {
    queries,
    categoryUrls = [],
    maxPages = 5,
    maxProducts = 100,
    refresh = false,
    exhaustive = false,
    discoveryOnly = false,
    searchSort = 'default',
  } = {}
) {
  positive(maxPages, 'maxPages', { integer: true });
  positive(maxProducts, 'maxProducts', { integer: true });
  const pageLimit = exhaustive ? Number.MAX_SAFE_INTEGER : maxPages;
  const productLimit = exhaustive ? Number.MAX_SAFE_INTEGER : maxProducts;
  const sources = crawlSources(app, queries, categoryUrls, searchSort);
  const report = {
    id: `crawl:${new Date().toISOString()}`,
    startedAt: new Date().toISOString(),
    market: app.market,
    deliveryArea: app.deliveryArea,
    queries,
    categoryUrls,
    pages: [],
    products: [],
    failures: [],
    scopes: sources.map(({ query, url, type }) => ({
      query,
      url,
      type,
      visitedPages: 0,
      terminalConfirmed: false,
      reportedTotal: null,
      lastPage: null,
      stopReason: 'not-started',
    })),
    coverage: exhaustive ? 'public-search-exhaustion' : 'bounded-search',
    phase: 'discovery',
    discoveryOnly,
    searchSort,
    complete: false,
    cache: {},
  };
  const discovered = new Set();
  const knownUrls = new Set(
    (await app.store.list('product')).map((product) => product.url)
  );
  const queryQueues = [];
  let stopped = false;
  for (const source of sources) {
    const { query, url: initialUrl } = source;
    const queue = [];
    queryQueues.push(queue);
    const scope = report.scopes.find((entry) => entry.query === query);
    scope.stopReason = 'page-limit';
    let url = initialUrl;
    const visited = new Set();
    for (let index = 0; index < pageLimit && !stopped; index += 1) {
      url = sortedUrl(url, searchSort);
      if (visited.has(url)) {
        scope.stopReason = 'pagination-loop';
        report.failures.push({
          url,
          error: 'Pagination returned an already visited URL',
        });
        break;
      }
      visited.add(url);
      try {
        const page = await app.collector.page(url, {
          namespace: `search:${app.market}:${app.deliveryArea}`,
          refresh,
        });
        const metadata = page.snapshot.searchCoverage || {};
        report.pages.push({
          url,
          query,
          status: page.status,
          cacheHit: page.cacheHit,
          ...metadata,
        });
        await app.store.put('crawl-page', {
          id: url,
          query,
          cacheId: page.id,
          observedAt: new Date(page.fetchedAt).toISOString(),
          status: page.status,
          ...metadata,
        });
        scope.visitedPages += 1;
        scope.reportedTotal = metadata.reportedTotal ?? scope.reportedTotal;
        scope.lastPage = metadata.lastPage ?? scope.lastPage;
        if (page.status !== 'ok') {
          scope.stopReason = page.status;
          report.failures.push({ url, error: `Search page is ${page.status}` });
          stopped = ['challenge', 'login', 'app-only'].includes(page.status);
          break;
        }
        assertCategoryPage(source, page.snapshot.url);
        assertSearchPage(url, metadata);
        for (const card of page.snapshot.cards || []) {
          let productUrl;
          try {
            productUrl = canonicalUrl(card.url);
            app.assertMarket(productUrl);
          } catch {
            continue;
          }
          if (!new URL(productUrl).pathname.includes('/products/')) {
            continue;
          }
          const categoryReview = await app.store.get(
            'category-review',
            `category:${listingKey(productUrl)}`
          );
          const category = categoryReview?.category || categoryOf(card.title);
          await app.store.put('discovery', {
            id: `discovery:${sha256(`${url}:${productUrl}:${card.sku || ''}`)}`,
            url: productUrl,
            title: card.title || '',
            sku: card.sku || null,
            category,
            sourceUrl: url,
            query,
            cacheId: page.id,
            observedAt: new Date(page.fetchedAt).toISOString(),
            searchPrice: parsePrice(card.priceText, app.currency) ?? null,
            classification:
              categoryReview?.category === 'unknown'
                ? 'quarantined'
                : category === 'unknown'
                  ? 'needs-category-review'
                  : 'candidate',
          });
          if (category === 'unknown' || discovered.has(productUrl)) {
            continue;
          }
          discovered.add(productUrl);
          queue.push(productUrl);
        }
        report.discovered = discovered.size;
        report.cache = { ...app.cache.stats };
        await app.store.put('crawl', report);
        // Duplicate cards or a page containing unrelated products do not prove
        // that pagination ended. Only an observed disabled Next control does.
        if (metadata.terminalConfirmed === true) {
          scope.terminalConfirmed = true;
          scope.stopReason = 'terminal-page';
          break;
        }
        const next =
          page.snapshot.nextUrl ||
          (() => {
            const nextUrl = new URL(url);
            nextUrl.searchParams.set('page', String(index + 2));
            return nextUrl.href;
          })();
        app.assertMarket(next);
        url = canonicalUrl(next);
      } catch (error) {
        scope.stopReason = 'page-error';
        report.failures.push({ url, error: error.message.split('\n')[0] });
        stopped =
          /dialog|challenge|login|captcha|pagination mismatch|loading did not settle|access.denied|HTTP (?:403|429)/iu.test(
            error.message
          );
        break;
      }
    }
    if (stopped) {
      break;
    }
  }
  report.discoveryComplete =
    report.scopes.length === sources.length &&
    report.scopes.every((scope) => scope.terminalConfirmed) &&
    report.failures.length === 0;
  const selected = selectListings(queryQueues, knownUrls, productLimit);
  if (!stopped && report.discoveryComplete && !discoveryOnly) {
    report.phase = 'details';
    for (const url of selected) {
      try {
        const collected = await app.collect(url, { refresh });
        report.products.push({
          id: collected.product.id,
          url,
          cacheHit: collected.cacheHit,
        });
        knownUrls.add(url);
      } catch (error) {
        report.failures.push({ url, error: error.message.split('\n')[0] });
        if (
          /dialog|challenge|login|captcha|loading did not settle|access.denied|HTTP (?:403|429)/iu.test(
            error.message
          )
        ) {
          stopped = true;
          break;
        }
      }
    }
  }
  return finishCrawl(app, report, {
    discovered,
    knownUrls,
    queries: sources.map((source) => source.query),
    stopped,
    selected,
  });
}
