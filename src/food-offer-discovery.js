import { clone } from './util.js';
import { discoverFoodOfferSourceBasis } from './food-offer-source-basis.js';

// Source-derived promotion hints stay potential. This integration never
// creates confirmed eligibility, nutrient facts or replacement paid mass.
export function applyFoodOfferDiscovery(snapshot, context) {
  const discovery = discoverFoodOfferSourceBasis(snapshot, context);
  if (
    !discovery.foodComponents.length &&
    !discovery.paidMassBasis.holdFields.length
  ) {
    return { product: context.product, offer: context.offer };
  }
  const product = clone(context.product);
  const offer = clone(context.offer);
  offer.foodOfferSourceBasis = discovery;
  const components = new Map(
    (offer.foodComponents || []).map((component) => [component.id, component])
  );
  for (const component of discovery.foodComponents) {
    if (!components.has(component.id)) {
      components.set(component.id, component);
    }
  }
  offer.foodComponents = [...components.values()];
  if (discovery.paidMassBasis.holdFields.length) {
    product.paidMassBasis = discovery.paidMassBasis;
    product.pendingSpecificationReview = [
      ...new Set([
        ...(product.pendingSpecificationReview || []),
        ...discovery.paidMassBasis.holdFields,
      ]),
    ];
    product.warnings = [
      ...new Set([
        ...(product.warnings || []),
        ...discovery.paidMassBasis.reasons,
      ]),
    ];
  }
  return { product, offer };
}

// Replaying identical original evidence must not replace an already reviewed
// component with its earlier potential-only discovery record.
export function mergeFoodOfferDiscovery(previous, current) {
  const result = { ...previous, ...current };
  if (!previous?.foodComponents && !current.foodComponents) {
    return result;
  }
  const components = new Map(
    (current.foodComponents || []).map((component) => [component.id, component])
  );
  for (const component of previous?.foodComponents || []) {
    components.set(component.id, component);
  }
  result.foodComponents = [...components.values()];
  return result;
}
