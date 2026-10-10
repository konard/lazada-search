import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
  AssociativeStore,
  LazadaSearch,
  reviewListingCategory,
} from '../src/index.js';
import { listingKey } from '../src/util.js';

const directory = 'docs/acceptance/urgent-icecream';
const snack = JSON.parse(
  await readFile(`${directory}/category-quarantine-recommendation.json`, 'utf8')
);
const labels = JSON.parse(
  await readFile(`${directory}/manufacturer-label-review.json`, 'utf8')
);
const application = new LazadaSearch({
  store: new AssociativeStore({
    directory: '.lazada-search',
    archive: 'data/cases/vietnam-nha-trang',
    visibility: 'public',
  }),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
application.collector.start = () => {
  throw new Error('Offline category corrections cannot start a browser');
};
const requests = [
  { listingId: snack.listingId, reason: snack.reason },
  ...labels.reviews.flatMap((review) =>
    review.affectedListingIds.map((listingId) => ({
      listingId,
      reason: `${review.reason} This listing is outside the requested strictly chocolate ice-cream core scope; its price observations remain available for audit. Original manufacturer label manually reviewed after OCR: ${review.manufacturerImageUrl}; SHA-256 ${review.imageSha256}. Exact manufacturer nutrition and selected selling-pack identity remain unverified.`,
    }))
  ),
];
const receipt = {
  startedAt: new Date().toISOString(),
  mode: 'public-offline-durable-listing-category-reviews',
  classification: 'unknown',
  actions: [],
};
try {
  for (const request of requests) {
    const url = `https://www.lazada.vn/products/pdp-i${request.listingId}.html`;
    const key = listingKey(url);
    const products = (await application.store.list('product')).filter(
      (product) => listingKey(product.url) === key
    );
    assert(products.length > 0, `No cached product for ${request.listingId}`);
    let attached;
    for (const product of products) {
      for (const id of product.evidenceIds ?? []) {
        const evidence = await application.store.get('evidence', id);
        if (evidence?.role === 'listing' && listingKey(evidence.url) === key) {
          attached = evidence;
          break;
        }
      }
      if (attached) {
        break;
      }
    }
    assert(attached, `No attached listing evidence for ${request.listingId}`);
    const beforeOffers = (await application.store.list('offer')).filter(
      (offer) => products.some((product) => product.id === offer.productId)
    );
    const previous = await application.store.get(
      'category-review',
      `category:${key}`
    );
    const unchanged =
      previous?.category === 'unknown' &&
      previous.reason === request.reason &&
      previous.evidenceId === attached.id;
    const saved = unchanged
      ? previous
      : await reviewListingCategory(application, url, {
          category: 'unknown',
          evidenceId: attached.id,
          reviewedBy:
            'Codex manual manufacturer-label and cached listing review',
          reason: request.reason,
        });
    const corrected = await Promise.all(
      products.map((product) => application.store.get('product', product.id))
    );
    assert(corrected.every((product) => product.category === 'unknown'));
    assert(
      corrected.every((product) => product.categoryReview.scope === 'listing')
    );
    const afterOffers = (await application.store.list('offer')).filter(
      (offer) => products.some((product) => product.id === offer.productId)
    );
    assert.deepEqual(
      afterOffers,
      beforeOffers,
      'Category quarantine changed price observations'
    );
    assert.deepEqual(
      corrected.map((product) => product.title),
      products.map((product) => product.title)
    );
    receipt.actions.push({
      listingId: request.listingId,
      url,
      reviewId: saved.id,
      evidenceId: attached.id,
      status: unchanged ? 'already-applied' : 'applied',
      reason: request.reason,
      products: corrected.map((product, index) => ({
        productId: product.id,
        sku: product.sku,
        title: product.title,
        previousCategory: products[index].category,
        correctedCategory: product.category,
        correction: product.corrections?.findLast(
          (entry) => entry.field === 'category'
        ),
      })),
      retainedOfferIds: afterOffers.map((offer) => offer.id),
      pricesUnchanged: true,
      titlesUnchanged: true,
    });
    await writeFile(
      `${directory}/category-quarantine-receipt.json`,
      `${JSON.stringify(receipt, null, 2)}\n`
    );
  }
  assert.equal(application.cache.stats.downloads, 0);
  receipt.finishedAt = new Date().toISOString();
  receipt.cache = application.cache.stats;
  await writeFile(
    `${directory}/category-quarantine-receipt.json`,
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  console.log(
    JSON.stringify({
      listings: receipt.actions.length,
      actions: receipt.actions.map((action) => ({
        listingId: action.listingId,
        status: action.status,
        reviewId: action.reviewId,
      })),
      downloads: application.cache.stats.downloads,
    })
  );
} finally {
  await application.close();
}
