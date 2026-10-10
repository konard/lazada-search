import {
  LazadaSearch,
  DomainScheduler,
  phoneLoginState,
  TesseractOcr,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { resolvePageDialogs } from '../src/page-dialogs.js';
import { latestCrawl } from '../src/crawl.js';
import { scopeAccountAudit } from './account-category-scope.mjs';
import {
  accountBacklogBatch,
  VN_FACTORY_PRIORITY_URLS,
} from './account-backlog-order.mjs';

const options = parseArguments(process.argv.slice(2));
options.account ||= 'default';
const store = configuredStore(options);
const app = new LazadaSearch({
  store,
  market: options.market,
  deliveryArea: options.deliveryArea,
  maxImages: options.maxImages,
  scheduler: new DomainScheduler({
    intervalMs: Math.max(60000, options.intervalMs),
  }),
  browserOptions: { channel: 'chrome', headless: false },
  ocr: options.ocr
    ? new TesseractOcr({
        store,
        languages: options.ocrLanguages,
        tessdataDir: options.ocrDataDir || undefined,
      })
    : false,
});
try {
  const latest = latestCrawl(await app.store.list('crawl'));
  if (latest?.discoveryComplete !== true) {
    throw new Error(
      'Complete category-list discovery before collecting product details'
    );
  }
  await app.collector.start();
  await resolvePageDialogs(app.collector.runtime.page);
  let session = await phoneLoginState(app.collector.runtime.page);
  if (session.status === 'challenge') {
    throw new Error(
      'Resolve the current verification challenge before navigation'
    );
  }
  if (session.status !== 'authenticated') {
    await app.collector.runtime.pace?.(
      'https://cart.lazada.vn/cart',
      app.cache.scheduler.intervalMs
    );
    await app.collector.commander.goto({
      url: 'https://cart.lazada.vn/cart',
      waitUntil: 'domcontentloaded',
      waitForNetworkIdle: false,
    });
    await app.collector.runtime.page.waitForTimeout(1500);
    await resolvePageDialogs(app.collector.runtime.page);
    session = await phoneLoginState(app.collector.runtime.page);
  }
  console.log(JSON.stringify({ session: session.status }));
  if (session.status !== 'authenticated') {
    throw new Error(
      'The dedicated account profile needs sign-in before collecting its backlog'
    );
  }
  const auditScope = {
    categoryOnly: options.categoryOnly,
    flavourScope: options.flavourScope,
    activeSourcesOnly: true,
    crawl: latest,
    discoveries: await app.store.list('discovery'),
  };
  const audit = scopeAccountAudit(await app.audit(), auditScope);
  const batch = accountBacklogBatch(audit, {
    batchSize: options.batchSize,
    exhaustive: options.exhaustive,
    maxProducts: options.maxProducts,
    priorityUrls: options.priorityUrl.length
      ? options.priorityUrl
      : options.market === 'vn'
        ? VN_FACTORY_PRIORITY_URLS
        : [],
  });
  const { urls } = batch;
  console.log(
    JSON.stringify({
      queued: urls.length,
      totalQueued: batch.totalQueued,
      remainingAfterBatch: batch.remainingAfterBatch,
      batchLimit: batch.batchLimit,
      intervalMs: Math.max(60000, options.intervalMs),
    })
  );
  let blocked;
  for (const [index, url] of urls.entries()) {
    try {
      const result = await app.collect(url, { refresh: options.refresh });
      console.log(
        JSON.stringify({
          index: index + 1,
          url,
          title: result.product.title,
          price: result.offer.price,
          sku: result.offer.sku,
          cacheHit: result.cacheHit,
        })
      );
    } catch (error) {
      console.log(
        JSON.stringify({ index: index + 1, url, error: error.message })
      );
      if (
        /dialog|challenge|login|captcha|access.denied|loading did not settle|HTTP (?:403|429)/iu.test(
          error.message
        )
      ) {
        blocked = error.message;
        break;
      }
    }
  }
  const remaining = scopeAccountAudit(await app.audit(), auditScope);
  console.log(
    JSON.stringify({
      remainingListings: remaining.missingListings.length,
      remainingSkuPrices: remaining.missingSkuPrices.length,
    })
  );
  if (blocked) {
    throw new Error(blocked);
  }
} finally {
  await app.close();
}
