import assert from 'node:assert/strict';
import { LazadaSearch, reviewListingCategory } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
assert.ok(options.offline && !options.account, 'Use offline public evidence');
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
try {
  const targets = new Set([
    '2978009544_VNAMZ-14350953081',
    '3047790409_VNAMZ-14661118301',
    '1561216831_VNAMZ-6599331044',
    '13392889869_VNAMZ-117024762283',
  ]);
  const products = (await app.store.list('product')).filter((p) =>
    targets.has(p.sku)
  );
  assert.equal(products.length, targets.size);
  for (const product of products) {
    const offers = await app.store.list('offer');
    const offer = offers.find(
      (o) => o.sku === product.sku && o.productId === product.id
    );
    assert.ok(offer?.evidenceId);
    await reviewListingCategory(app, product.url, {
      category:
        product.sku === '13392889869_VNAMZ-117024762283'
          ? 'whey'
          : 'chocolate-ice-cream',
      evidenceId: offer.evidenceId,
      reviewedBy: 'Source audit',
      reason:
        product.sku === '13392889869_VNAMZ-117024762283'
          ? 'Exact original HTML declares Thành phần Protein whey and Naturally Flavored (Không mùi vị). All three selling options are pack sizes; selected Combo 2 Túi 1Kg is two seller-repacked 1 kg bags. Provisional whey/unflavoured source classification only; factory formula and authenticity remain unverified.'
          : 'Exact selected-SKU page explicitly describes chocolate frozen ice cream (Pongta Chocolate, Fanfare Chocolate, or Thai socola tub). This is a provisional category correction; factory nutrition, chocolate core and frozen delivery remain unverified.',
    });
  }
  console.log(JSON.stringify({ reviewed: products.length, downloads: 0 }));
} finally {
  await app.close();
}
