import { categoryOf, parsePrice } from './nutrition.js';
import { canonicalUrl, positive, sha256 } from './util.js';

export async function crawlMarketplace(
  app,
  {
    queries,
    maxPages = 5,
    maxProducts = 100,
    refresh = false,
    exhaustive = false,
  } = {}
) {
  positive(maxPages, 'maxPages', { integer: true });
  positive(maxProducts, 'maxProducts', { integer: true });
  const pageLimit = exhaustive ? Number.MAX_SAFE_INTEGER : maxPages;
  const productLimit = exhaustive ? Number.MAX_SAFE_INTEGER : maxProducts;
  const report = {
    id: `crawl:${new Date().toISOString()}`,
    startedAt: new Date().toISOString(),
    market: app.market,
    deliveryArea: app.deliveryArea,
    queries,
    pages: [],
    products: [],
    failures: [],
    scopes: [],
    coverage: exhaustive ? 'public-search-exhaustion' : 'bounded-search',
    complete: false,
    cache: {},
  };
  const discovered = new Set();
  const knownUrls = new Set(
    (await app.store.list('product')).map((product) => product.url)
  );
  const queryQueues = [];
  let stopped = false;
  for (const query of queries) {
    const queue = [];
    queryQueues.push(queue);
    const scope = {
      query,
      visitedPages: 0,
      terminalConfirmed: false,
      reportedTotal: null,
      lastPage: null,
      stopReason: 'page-limit',
    };
    report.scopes.push(scope);
    let url = `https://${app.host}/catalog/?q=${encodeURIComponent(query)}`;
    const visited = new Set();
    for (let index = 0; index < pageLimit && !stopped; index += 1) {
      url = canonicalUrl(url);
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
          stopped = ['challenge', 'login'].includes(page.status);
          break;
        }
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
          const category = categoryOf(card.title);
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
              category === 'unknown' ? 'needs-category-review' : 'candidate',
          });
          if (category === 'unknown' || discovered.has(productUrl)) {
            continue;
          }
          discovered.add(productUrl);
          queue.push(productUrl);
        }
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
        break;
      }
    }
    if (stopped) {
      break;
    }
  }
  const selected = [];
  for (const revisit of [false, true]) {
    const queues = queryQueues.map((queue) =>
      queue.filter((entry) => knownUrls.has(entry) === revisit)
    );
    for (let index = 0; selected.length < productLimit; index += 1) {
      const round = queues.map((queue) => queue[index]).filter(Boolean);
      if (!round.length) {
        break;
      }
      selected.push(...round.slice(0, productLimit - selected.length));
    }
  }
  if (!stopped) {
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
        if (/challenge|login/iu.test(error.message)) {
          stopped = true;
          break;
        }
      }
    }
  }
  report.discovered = discovered.size;
  report.uncollectedUrls = [...discovered].filter((url) => !knownUrls.has(url));
  report.uncollected = report.uncollectedUrls.length;
  report.visibleSearchComplete =
    report.scopes.length === queries.length &&
    report.scopes.every((scope) => scope.terminalConfirmed) &&
    report.failures.length === 0 &&
    report.uncollected === 0;
  // Search results have no authoritative whole-market inventory. Exhausting
  // their public pages cannot prove that hidden/unindexed listings are absent.
  report.globalCoverage = 'unverifiable-with-public-search';
  report.stopReason = stopped
    ? 'challenge-or-login'
    : selected.length < discovered.size
      ? 'product-limit'
      : report.visibleSearchComplete
        ? 'public-search-ended'
        : 'search-incomplete';
  report.cache = { ...app.cache.stats };
  await app.store.put('crawl', report);
  return report;
}
