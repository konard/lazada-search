import { mkdir, writeFile } from 'node:fs/promises';
import { LazadaSearch, DomainScheduler } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
options.account ||= 'default';
const targets = [
  ['3047760589', '14661082727', 'Cremo chocolate 6-litre tub'],
  ['2042294681', '9532082441', 'Aice chocolate mochi'],
  ['2042258411', '9532010624', 'Aice chocolate cone'],
  ['3040048563', '14623760583', 'Pongta chocolate carton of24 bottles'],
];
const app = new LazadaSearch({
  store: configuredStore(options),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  ocr: false,
  maxImages: 0,
  scheduler: new DomainScheduler({ intervalMs: 60000 }),
  browserOptions: { channel: 'chrome', headless: false },
});
const attempts = [];
try {
  for (const [listingId, skuId, label] of targets) {
    const sku = `${listingId}_VNAMZ-${skuId}`;
    const cached = (await app.store.list('offer')).find(
      (offer) =>
        offer.sku === sku &&
        offer.variantConfirmed &&
        offer.price > 0 &&
        !offer.priceInvalidated
    );
    if (cached) {
      attempts.push({ sku, label, reused: true, price: cached.price });
      continue;
    }
    const url = `https://www.lazada.vn/products/pdp-i${listingId}.html?skuId=${skuId}`;
    try {
      const result = await app.collect(url);
      const receipt = {
        requestedSku: sku,
        sku: result.offer.sku,
        label,
        url,
        price: result.offer.price,
        available: result.offer.available,
        selected: result.product.selectedVariant,
        massG: result.product.netMassG,
        volumeMl: result.product.netVolumeMl,
        observedAt: result.offer.observedAt,
        variantConfirmed: result.offer.variantConfirmed,
      };
      attempts.push(receipt);
      console.log(JSON.stringify(receipt));
    } catch (error) {
      attempts.push({ sku, label, url, error: error.message });
      console.log(JSON.stringify({ sku, error: error.message }));
      // A blocking dialog or incomplete page must be resolved before another visit.
      break;
    }
  }
} finally {
  await app.close();
  await mkdir('docs/acceptance/ice-dual-units', { recursive: true });
  await writeFile(
    'docs/acceptance/ice-dual-units/expanded-collection.json',
    `${JSON.stringify({ collectedAt: new Date().toISOString(), intervalMs: 60000, attempts }, null, 2)}\n`
  );
}
