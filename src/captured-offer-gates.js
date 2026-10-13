import { deliveryContextMatches } from './delivery-context.js';

const positive = (value) => Number.isFinite(value) && value > 0;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;

export function capturedPriceFresh(row, now, maxAgeMs = 86400000) {
  const offer = row.offer;
  const age = now - Date.parse(offer?.observedAt);
  return (
    positive(offer?.price) &&
    offer.variantConfirmed === true &&
    Boolean(offer.evidenceId) &&
    !offer.priceInvalidated &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= maxAgeMs
  );
}

function deliveryNumbersMatch(offer, metrics) {
  return (
    nonnegative(metrics.totalBeforeDelivery) &&
    nonnegative(metrics.totalAfterDelivery) &&
    Number.isFinite(offer.shipping) &&
    offer.shipping >= 0 &&
    metrics.shipping === offer.shipping &&
    Math.abs(
      metrics.totalAfterDelivery - metrics.totalBeforeDelivery - offer.shipping
    ) < 1e-8 &&
    Number.isInteger(metrics.quantity) &&
    metrics.quantity > 0 &&
    offer.shippingQuantity === metrics.quantity
  );
}

function deliveryIdentityMatches(offer, deliveryArea) {
  return Boolean(
    offer.variantConfirmed === true &&
    !offer.priceInvalidated &&
    !offer.shippingInvalidated &&
    Boolean(offer.quoteEvidenceId) &&
    Number.isFinite(Date.parse(offer.quoteObservedAt)) &&
    offer.deliveryArea === deliveryArea &&
    typeof offer.shippingDestination === 'string' &&
    offer.shippingDestination.trim() &&
    deliveryContextMatches(offer, deliveryArea)
  );
}

function canFulfillQuantity(offer, metrics) {
  return (
    offer.available === true &&
    offer.deliveryAvailable !== false &&
    !(Number.isFinite(offer.stock) && metrics.quantity > offer.stock) &&
    !(
      Number.isFinite(offer.maxQuantity) && metrics.quantity > offer.maxQuantity
    ) &&
    !(
      Number.isFinite(offer.minQuantity) && metrics.quantity < offer.minQuantity
    )
  );
}

// A numeric total alone does not establish an exact destination/quantity quote.
// These structural checks do not replace independent verification of originals.
export function exactCapturedDelivery(row, deliveryArea = 'Nha Trang') {
  const { offer, metrics, product } = row;
  if (!offer || !metrics) {
    return false;
  }
  return (
    deliveryNumbersMatch(offer, metrics) &&
    deliveryIdentityMatches(offer, deliveryArea) &&
    canFulfillQuantity(offer, metrics) &&
    (product?.category !== 'chocolate-ice-cream' ||
      offer.coldChainConfirmed === true)
  );
}
