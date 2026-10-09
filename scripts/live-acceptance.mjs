import { mkdir, writeFile } from 'node:fs/promises';
import { AssociativeStore, LazadaSearch, TesseractOcr } from '../src/index.js';

const store = new AssociativeStore({
  directory: process.env.LAZADA_DATA_DIR || '.lazada-search',
});
const report = {
  checkedAt: new Date().toISOString(),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  fixtureData: false,
  access: 'public-pages',
};
const app = new LazadaSearch({
  store,
  market: 'vn',
  deliveryArea: 'Nha Trang',
  maxImages: 5,
  ocr: new TesseractOcr({
    store,
    languages: process.env.LAZADA_OCR_LANGUAGES || 'eng',
    tessdataDir: process.env.LAZADA_OCR_DATA_DIR || undefined,
  }),
  browserOptions: {
    headless: true,
    ...(process.env.LAZADA_BROWSER_EXECUTABLE
      ? { executablePath: process.env.LAZADA_BROWSER_EXECUTABLE }
      : {}),
  },
});
try {
  report.crawl = await app.crawl({
    queries: ['whey protein', 'kem chocolate', 'whey isolate', 'kem sô cô la'],
    maxPages: 1,
    maxProducts: Number(process.env.LAZADA_LIVE_MAX_PRODUCTS || 4),
  });
  report.comparison = await app.compare();
  const products = await store.list('product');
  const offers = await store.list('offer');
  report.categoryCoverage = Object.fromEntries(
    ['whey', 'chocolate-ice-cream'].map((category) => {
      const ids = new Set(
        products
          .filter((product) => product.category === category)
          .map((product) => product.id)
      );
      return [
        category,
        {
          collected: ids.size,
          priced: offers.filter(
            (offer) => ids.has(offer.productId) && offer.price > 0
          ).length,
        },
      ];
    })
  );
  report.publicCollectionAccepted = Object.values(
    report.categoryCoverage
  ).every((entry) => entry.collected > 0 && entry.priced > 0);
  report.purchaseComparisonReady = ['whey', 'chocolate-ice-cream'].every(
    (category) => Boolean(report.comparison.bestByCategory[category])
  );
  report.accepted = report.publicCollectionAccepted;
} catch (error) {
  report.accepted = false;
  report.error = error.message;
} finally {
  await app.close();
}
await mkdir('docs/acceptance', { recursive: true });
await writeFile(
  'docs/acceptance/live-result.json',
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
if (!report.accepted) {
  process.exitCode = 1;
}
