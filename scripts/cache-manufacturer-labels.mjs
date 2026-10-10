import { mkdir, writeFile } from 'node:fs/promises';
import {
  DomainScheduler,
  EvidenceCache,
  LazadaSearch,
  TesseractOcr,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { evidenceId } from '../src/cache.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error('Manufacturer labels belong in the public evidence store');
}
const store = configuredStore(options);
// Re-extract saved official HTML without navigating the persistent Lazada tab.
const app = new LazadaSearch({ store, offline: true, ocr: false });
const images = new EvidenceCache({
  store,
  offline: options.offline,
  scheduler: new DomainScheduler({
    intervalMs: Math.max(60000, options.intervalMs),
  }),
});
const ocr = new TesseractOcr({
  store,
  languages: options.ocrLanguages,
  tessdataDir: options.ocrDataDir || undefined,
});
const sources = (await store.list('cache')).filter(
  (record) => record.id.startsWith('manufacturer:') && record.status === 'ok'
);
const report = { startedAt: new Date().toISOString(), labels: [], errors: [] };
await mkdir('docs/acceptance', { recursive: true });
try {
  for (const source of sources) {
    const capture = await app.collector.page(source.url, {
      namespace: 'manufacturer',
    });
    for (const label of capture.snapshot.manufacturerLabels || []) {
      try {
        const image = await images.image(label.url);
        const recognized = options.ocr
          ? await ocr.recognize(image.blob)
          : undefined;
        const id = evidenceId(label.url, await store.blob(image.blob.sha256));
        const record = {
          id,
          role: 'manufacturer-label',
          url: label.url,
          manufacturerUrl: source.url,
          flavour: label.flavour,
          image: image.blob,
          html: capture.html,
          observedAt: new Date(image.fetchedAt).toISOString(),
          ...(recognized ? { ocrId: recognized.id } : {}),
        };
        await store.put('evidence', record);
        report.labels.push({
          ...record,
          cacheHit: image.cacheHit,
          ocrCacheHit: recognized?.cacheHit,
          ocrConfidence: recognized?.confidence,
        });
        console.log(
          JSON.stringify({ flavour: label.flavour, cacheHit: image.cacheHit })
        );
      } catch (error) {
        report.errors.push({ url: label.url, error: error.message });
        if (/HTTP (?:403|429)/u.test(error.message)) {
          throw error;
        }
      }
      await writeFile(
        'docs/acceptance/manufacturer-label-cache.json',
        `${JSON.stringify(report, null, 2)}\n`
      );
    }
  }
} finally {
  await app.close();
  report.finishedAt = new Date().toISOString();
  report.cache = images.stats;
  await writeFile(
    'docs/acceptance/manufacturer-label-cache.json',
    `${JSON.stringify(report, null, 2)}\n`
  );
}
console.log(
  JSON.stringify({
    labels: report.labels.length,
    errors: report.errors.length,
    cache: report.cache,
  })
);
