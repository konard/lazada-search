import {
  DomainScheduler,
  LazadaSearch,
  phoneLoginState,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { resolvePageDialogs } from '../src/page-dialogs.js';

const options = parseArguments(process.argv.slice(2));
options.account ||= 'default';
const app = new LazadaSearch({
  store: configuredStore(options),
  market: options.market,
  deliveryArea: options.deliveryArea,
  ocr: false,
  scheduler: new DomainScheduler({
    intervalMs: Math.max(60000, options.intervalMs),
  }),
  browserOptions: { channel: 'chrome', headless: false },
});
try {
  await app.collector.start();
  await resolvePageDialogs(app.collector.runtime.page);
  const session = await phoneLoginState(app.collector.runtime.page);
  console.log(JSON.stringify({ session: session.status, phase: 'discovery' }));
  if (session.status !== 'authenticated') {
    throw new Error(
      'Sign-in is required in the existing account profile before discovery'
    );
  }
  const collectPage = app.collector.page.bind(app.collector);
  app.collector.page = async (url, settings) => {
    const page = await collectPage(url, settings);
    console.log(
      JSON.stringify({
        url,
        status: page.status,
        cards: page.snapshot.cards?.length,
        coverage: page.snapshot.searchCoverage,
        cacheHit: page.cacheHit,
      })
    );
    return page;
  };
  const report = await app.crawl({
    queries: options.query,
    categoryUrls: options.categoryUrl,
    categoryOnly: options.categoryOnly,
    searchSort: options.searchSort,
    exhaustive: true,
    discoveryOnly: true,
    refresh: options.refresh,
  });
  console.log(
    JSON.stringify({
      scopes: report.scopes,
      discovered: report.discovered,
      discoveryComplete: report.discoveryComplete,
      stopReason: report.stopReason,
      failures: report.failures,
      cache: report.cache,
    })
  );
} finally {
  await app.close();
}
