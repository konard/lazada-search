import { calculateOffer } from '../src/compare.js';

// Ingredients may contain soy lecithin in a whey product. Classify the actual
// powder, not incidental ingredients or a promotional gift.
export function powderCategory(product) {
  if (product.manufacturerVerification?.identityMatched) {
    const ingredients = JSON.stringify(product.ingredients || []);
    const whey = /whey\s*protein/iu.test(ingredients);
    const soy = /soy(?:a)?\s*(?:protein|isolate)/iu.test(ingredients);
    if (whey && soy) {
      return 'mixed-protein';
    }
    if (soy) {
      return 'soy';
    }
    if (whey) {
      return 'whey';
    }
  }
  const selected = (product.selectedVariant || []).map((v) => v.text).join(' ');
  const identity = `${selected} ${product.title || ''}`;
  if (
    /soy\s*(?:protein|isolate)|(?:protein|isolate)\s*soy|đạm\s*đậu\s*nành/iu.test(
      identity
    )
  ) {
    return 'soy';
  }
  return product.category === 'whey' ? 'whey' : 'other-protein';
}

export function reportUnitCosts(
  row,
  { quantity = 1, deliveryArea = 'Nha Trang', productOverride } = {}
) {
  const product = { ...row.product, ...productOverride };
  // Powder volume cannot come from the capacity of a free shaker.
  if (product.category !== 'chocolate-ice-cream') {
    delete product.netVolumeMl;
  }
  const destinationMatches = row.offer.deliveryArea === deliveryArea;
  const quoteMatches = row.offer.shippingQuantity === quantity;
  const coldChainMatches =
    product.category !== 'chocolate-ice-cream' ||
    row.offer.coldChainConfirmed === true;
  const deliveryUsable =
    destinationMatches &&
    quoteMatches &&
    coldChainMatches &&
    !row.offer.shippingInvalidated &&
    row.offer.deliveryAvailable !== false;
  const offer = deliveryUsable
    ? row.offer
    : { ...row.offer, shipping: undefined };
  const { metrics } = calculateOffer(product, offer, {
    quantity,
    deliveryArea,
    requireManufacturer: false,
    allowStale: true,
  });
  return {
    quantity,
    packagesPerSellingUnit: product.packCount || 1,
    massG: metrics.totalMassG,
    volumeMl: metrics.totalVolumeMl,
    totalBeforeDelivery: metrics.totalBeforeDelivery,
    totalAfterDelivery: metrics.totalAfterDelivery,
    shippingVnd: metrics.shipping,
    beforePerFoodGram: metrics.costPerGramBeforeDelivery,
    afterPerFoodGram: metrics.costPerGramAfterDelivery,
    beforePerMl: metrics.costPerMlBeforeDelivery,
    afterPerMl: metrics.costPerMlAfterDelivery,
    beforePerProteinGram: metrics.costPerProteinGramBeforeDelivery,
    afterPerProteinGram: metrics.costPerProteinGramAfterDelivery,
    deliveryQuoteMatched: deliveryUsable && metrics.shippingKnown,
  };
}
