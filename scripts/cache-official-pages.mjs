import { mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import {
  DomainScheduler,
  EvidenceCache,
  MANUFACTURERS,
  TesseractOcr,
} from '../src/index.js';
import {
  extractPage,
  classifyPage,
  EXTRACTOR_VERSION,
} from '../src/browser.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error('Public official sources must not use an account store');
}
const store = configuredStore(options);
const cache = new EvidenceCache({
  store,
  offline: options.offline,
  scheduler: new DomainScheduler({
    intervalMs: Math.max(60000, options.intervalMs),
  }),
});
const ocr = new TesseractOcr({ store, languages: options.ocrLanguages });
const report = {
  startedAt: new Date().toISOString(),
  pages: [],
  images: [],
  errors: [],
};
await mkdir('docs/acceptance', { recursive: true });
for (const url of options._) {
  const domain = new URL(url).hostname.replace(/^www\./u, '');
  if (!MANUFACTURERS.some((entry) => entry.domains.includes(domain))) {
    throw new Error(
      `URL is not a registered official manufacturer source: ${url}`
    );
  }
  const capture = await cache.get(url, {
    namespace: 'manufacturer',
    ttlMs: 30 * 86400000,
    refresh: options.refresh,
    load: async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        throw new Error(`Manufacturer HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 25 * 1024 ** 2) {
        throw new Error('Manufacturer HTML exceeds the evidence size limit');
      }
      const { document } = parseHTML(bytes.toString());
      const snapshot = extractPage({ document, url: response.url });
      const html = await store.putBlob(bytes);
      return {
        snapshot,
        html,
        status: classifyPage(snapshot),
        finalUrl: response.url,
        extractorVersion: EXTRACTOR_VERSION,
        extractedHtmlSha256: html.sha256,
        sourceKind: 'public-http',
      };
    },
  });
  report.pages.push({ url, html: capture.html, cacheHit: capture.cacheHit });
  for (const url of (capture.snapshot.productImages || []).slice(
    0,
    options.maxImages
  )) {
    try {
      const image = await cache.image(url);
      const result = options.ocr ? await ocr.recognize(image.blob) : undefined;
      report.images.push({
        url,
        blob: image.blob,
        cacheHit: image.cacheHit,
        ocrId: result?.id,
      });
      console.log(JSON.stringify({ url, cacheHit: image.cacheHit }));
    } catch (error) {
      report.errors.push({ url, error: error.message });
      if (/HTTP (?:403|429)/u.test(error.message)) {
        throw error;
      }
    }
    await writeFile(
      'docs/acceptance/official-page-cache.json',
      `${JSON.stringify(report, null, 2)}\n`
    );
  }
}
report.finishedAt = new Date().toISOString();
report.cache = cache.stats;
await writeFile(
  'docs/acceptance/official-page-cache.json',
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(
  JSON.stringify({
    pages: report.pages.length,
    images: report.images.length,
    errors: report.errors.length,
    cache: report.cache,
  })
);
