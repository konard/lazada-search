import { readFile } from 'node:fs/promises';
import { LazadaSearch, DomainScheduler } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (!options.account) {
  throw new Error('Use a separate account profile');
}
const app = new LazadaSearch({
  store: configuredStore(options),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  ocr: false,
  maxImages: 0,
  scheduler: new DomainScheduler({ intervalMs: 60000 }),
  browserOptions: { channel: 'chrome', headless: false },
});
try {
  const seen = new Set();
  for (const entry of JSON.parse(
    await readFile('docs/acceptance/top10-check/handpicked-links.json', 'utf8')
  ).entries) {
    if (!entry.listingId || !entry.skuId) {
      continue;
    }
    const sku = `${entry.listingId}_VNAMZ-${entry.skuId}`;
    if (seen.has(sku)) {
      continue;
    }
    seen.add(sku);
    const offers = await app.store.list('offer');
    if (
      offers.some(
        (o) =>
          o.sku === sku &&
          o.variantConfirmed &&
          o.price > 0 &&
          !o.priceInvalidated
      )
    ) {
      console.log(JSON.stringify({ sku, reused: true }));
      continue;
    }
    const result = await app.collect(
      `https://www.lazada.vn/products/pdp-i${entry.listingId}.html?skuId=${entry.skuId}`
    );
    console.log(
      JSON.stringify({
        sku: result.offer.sku,
        price: result.offer.price,
        available: result.offer.available,
        selected: result.product.selectedVariant,
        massG: result.product.netMassG,
        observedAt: result.offer.observedAt,
      })
    );
  }
} finally {
  await app.close();
}
