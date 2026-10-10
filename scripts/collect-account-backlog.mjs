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
import {
  attemptedCollectionUrls,
  recordCollectionAttempt,
} from './account-collection-attempts.mjs';

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
  await app.collector.assertCollecting();
  await resolvePageDialogs(app.collector.runtime.page);
  const session = await phoneLoginState(app.collector.runtime.page);
  if (session.status === 'challenge') {
    throw new Error(
      'Resolve the current verification challenge before navigation'
    );
  }
  console.log(
    JSON.stringify({
      session: session.status,
      access: session.status === 'authenticated' ? 'account' : 'public',
    })
  );
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
    attemptedUrls: await attemptedCollectionUrls(app.store, options),
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
      deferred: batch.deferred,
      remainingAfterBatch: batch.remainingAfterBatch,
      batchLimit: batch.batchLimit,
      intervalMs: Math.max(60000, options.intervalMs),
    })
  );
  let blocked;
  for (const [index, url] of urls.entries()) {
    try {
      const result = await app.collect(url, { refresh: options.refresh });
      await recordCollectionAttempt(app.store, url, {
        status: 'captured',
        sku: result.offer.sku,
        price: result.offer.price,
      });
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
      if (error.code !== 'COLLECTION_STOPPED') {
        await recordCollectionAttempt(app.store, url, {
          status: 'deferred',
          reason: error.message,
        });
      }
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
