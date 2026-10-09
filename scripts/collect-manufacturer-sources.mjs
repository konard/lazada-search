import { mkdir, writeFile } from 'node:fs/promises';
import {
  LazadaSearch,
  AssociativeStore,
  TesseractOcr,
  manufacturerCandidates,
} from '../src/index.js';
import { parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
const store = new AssociativeStore({ directory: options.dataDir });
const app = new LazadaSearch({
  store,
  market: options.market,
  deliveryArea: options.deliveryArea,
  maxImages: options.maxImages,
  offline: options.offline,
  ocr: options.ocr
    ? new TesseractOcr({
        store,
        languages: options.ocrLanguages,
        tessdataDir: options.ocrDataDir || undefined,
      })
    : false,
  browserOptions: { launch: 'engine', headless: options.headless },
});
const offers = (await app.store.list('offer')).filter(
  (offer) => !offer.supersededBy
);
const products = (await app.store.list('product')).filter(
  (product) =>
    product.category !== 'unknown' &&
    offers.some((offer) => offer.productId === product.id)
);
const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  missingSources: [],
  failures: [],
};
const failedSources = new Map();
await mkdir('docs/acceptance', { recursive: true });
try {
  for (const product of products) {
    const candidates = manufacturerCandidates(product);
    if (!candidates.length) {
      report.missingSources.push({ productId: product.id, url: product.url });
    }
    for (const candidate of candidates) {
      try {
        if (failedSources.has(candidate.url)) {
          throw new Error(failedSources.get(candidate.url));
        }
        console.log(
          JSON.stringify({
            source: candidate.url,
            phase: 'verify',
          })
        );
        report.checks.push(await app.verify(product.id, candidate.url));
        console.log(
          JSON.stringify({
            source: candidate.url,
            phase: 'recorded',
            checks: report.checks.length,
          })
        );
      } catch (error) {
        failedSources.set(candidate.url, error.message.split('\n')[0]);
        report.failures.push({
          productId: product.id,
          manufacturerUrl: candidate.url,
          error: error.message.split('\n')[0],
        });
      }
    }
    await writeFile(
      'docs/acceptance/manufacturer-source-crawl.json',
      `${JSON.stringify(report, null, 2)}\n`
    );
  }
} finally {
  await app.close();
  report.finishedAt = new Date().toISOString();
  report.cache = app.cache.stats;
  await writeFile(
    'docs/acceptance/manufacturer-source-crawl.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    missingSources: report.missingSources.length,
    failures: report.failures.length,
    cache: report.cache,
  })
);
