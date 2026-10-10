import { writeFile } from 'node:fs/promises';
import {
  LazadaSearch,
  DomainScheduler,
  phoneLoginState,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { resolvePageDialogs } from '../src/page-dialogs.js';

// One browser visit captures today's selected price and destination freight.
// Importing the captured HTML reuses its selected price and destination quote.
const options = parseArguments(process.argv.slice(2));
options.account ||= 'default';
const urls = options._;
if (!urls.length) {
  throw new Error('Provide the exact selected-SKU URLs to refresh');
}
const store = configuredStore(options);
const app = new LazadaSearch({
  store,
  market: options.market,
  deliveryArea: options.deliveryArea,
  ocr: false,
  maxImages: 0,
  scheduler: new DomainScheduler({
    intervalMs: Math.max(60000, options.intervalMs),
  }),
  browserOptions: { channel: 'chrome', headless: false },
});
const results = [];
try {
  await app.collector.start();
  await resolvePageDialogs(app.collector.runtime.page);
  const session = await phoneLoginState(app.collector.runtime.page);
  console.log(JSON.stringify({ session: session.status }));
  if (session.status !== 'authenticated') {
    throw new Error('Existing dedicated browser must remain signed in');
  }
  for (const url of urls) {
    const delivery = await app.delivery(url, { refresh: true });
    const result = await app.importCapture({
      url,
      observedAt: delivery.observedAt,
      html: await store.blob(delivery.html.sha256),
    });
    const summary = {
      url,
      observedAt: delivery.observedAt,
      productId: result.product.id,
      title: result.product.title,
      sku: result.offer.sku,
      selectedVariant: result.product.selectedVariant,
      price: result.offer.price,
      originalPrice: result.offer.originalPrice,
      available: result.offer.available,
      maxQuantity: result.offer.maxQuantity,
      shipping: result.offer.shipping,
      shippingQuantity: result.offer.shippingQuantity,
      shippingDestination: result.offer.shippingDestination,
      deliveryText: delivery.text,
      listingEvidenceIds: result.product.evidenceIds,
      imageUrls: delivery.snapshot.productImages,
      cache: app.cache.stats,
    };
    results.push(summary);
    await writeFile(
      '.lazada-search/accounts/default/priority-quotes.json',
      `${JSON.stringify(results, null, 2)}\n`,
      { mode: 0o600 }
    );
    console.log(JSON.stringify(summary));
  }
} finally {
  await app.close();
}
