import { catalogProducts, resolveProductReviews } from './catalog-products.js';
import { applyListingAvailability } from './availability.js';
import { validateFoodComponentEvidence } from './food-component-evidence.js';
import { createManufacturerSourceValidityLoader } from './manufacturer-source-validity.js';

// Every comparison interface applies the same shared reviews, holds, source
// invalidations and original-HTML availability receipts before calculating.
export async function comparisonInputs(
  store,
  { offerIds, manufacturerRegistry } = {}
) {
  const invalidations = await store.list('invalidation');
  const manufacturerSources = createManufacturerSourceValidityLoader(store, {
    invalidations,
  });
  let offers = applyListingAvailability(
    (await store.list('offer')).filter((offer) => !offer.supersededBy),
    await store.list('listing-availability'),
    invalidations
  );
  if (offerIds) {
    offers = offers.filter((offer) => offerIds.has(offer.id));
  }
  offers = await validateFoodComponentEvidence(store, offers, {
    manufacturerRegistry,
  });
  const products = offerIds
    ? await Promise.all(
        [...new Set(offers.map((offer) => offer.productId))].map(async (id) =>
          resolveProductReviews(store, await store.get('product', id), {
            manufacturerSources,
          })
        )
      ).then((items) => items.filter(Boolean))
    : await catalogProducts(store, { manufacturerSources });
  const invalidated = [];
  for (const entry of invalidations) {
    for (const id of entry.cacheIds || []) {
      const source = await store.get('cache', id);
      if (source?.invalidatedAt) {
        invalidated.push(source);
      }
    }
  }
  for (const offer of offers) {
    offer.priceInvalidated ||= invalidated.some(
      (source) =>
        source.url === offer.url && /^(?:lazada|page):/u.test(source.id)
    );
    offer.shippingInvalidated ||= invalidated.some(
      (source) => source.url === offer.url && source.id.startsWith('delivery:')
    );
  }
  for (const product of products) {
    product.specificationsInvalidated ||= invalidated.some(
      (source) =>
        source.url === product.url ||
        (!product.manufacturerSourceValidityHandledUrls?.includes(source.url) &&
          product.crossChecks?.some(
            (check) => check.manufacturerUrl === source.url
          ))
    );
  }
  return { products, offers };
}
