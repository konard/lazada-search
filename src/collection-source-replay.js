import { discoverFoodOfferSourceBasis } from './food-offer-source-basis.js';

const quantityFields = new Set(['netMassG', 'packCount']);

function sameQuantitySource(previous, current, proof) {
  const identity = ['id', 'sku', 'url', 'observedAt'];
  if (
    !previous ||
    !current ||
    !identity.every(
      (field) =>
        typeof previous[field] === 'string' &&
        previous[field] &&
        previous[field] === current[field]
    )
  ) {
    return false;
  }
  return (
    Number.isFinite(Date.parse(current.observedAt)) &&
    /^[a-f\d]{64}$/u.test(proof.originalHtmlSha256 || '') &&
    proof.previousHtmlSha256 === proof.originalHtmlSha256 &&
    Boolean(proof.evidenceId) &&
    [previous, current].every((product) =>
      product.evidenceIds?.includes(proof.evidenceId)
    ) &&
    previous.netMassG > 0 &&
    previous.netMassG === current.netMassG &&
    Number.isInteger(current.packCount) &&
    current.packCount > 1 &&
    previous.packCount === current.packCount
  );
}

function quantityClaimHold(claim) {
  return (
    quantityFields.has(claim.field) &&
    Boolean(
      claim.invalidated ||
      claim.invalidatedAt ||
      claim.consistencyReviewRequired ||
      (claim.source === 'manual-review' && claim.requiresReview !== false)
    )
  );
}

function independentQuantityHold(product) {
  return Boolean(
    product.specificationsInvalidated ||
    product.invalidatedAt ||
    product.requiresReview ||
    product.packageCountUnresolved ||
    product.pendingSpecificationReview?.includes('packCount') ||
    product.packageMassConsistency?.requiresReview ||
    product.specificationHolds?.some(
      (hold) => quantityFields.has(hold.field) && hold.active !== false
    ) ||
    product.claims?.some(quantityClaimHold) ||
    product.crossChecks?.some((check) =>
      check.conflicts?.some((conflict) => quantityFields.has(conflict.field))
    )
  );
}

function automaticMassHold(product) {
  const basis = product.paidMassBasis;
  return (
    basis?.requiresReview === true &&
    basis.factualApprovalGranted === false &&
    basis.safeToMultiplyByPackCount === false &&
    ['ambiguous', 'total-selling-unit'].includes(basis.basis) &&
    basis.holdFields?.length === 1 &&
    basis.holdFields[0] === 'netMassG' &&
    basis.selectedMassG === product.netMassG &&
    basis.packCount === product.packCount
  );
}

function obsoleteAutomaticHold(previous, current) {
  return (
    previous.pendingSpecificationReview?.includes('netMassG') &&
    !current.pendingSpecificationReview?.includes('netMassG') &&
    automaticMassHold(previous) &&
    !current.paidMassBasis?.requiresReview &&
    !current.paidMassBasis?.holdFields?.length
  );
}

function safeFreshBasis(snapshot, current, proof) {
  const offer = proof.offer;
  if (
    !offer ||
    offer.sku !== current.sku ||
    offer.observedAt !== current.observedAt ||
    offer.evidenceId !== proof.evidenceId
  ) {
    return false;
  }
  const fresh = discoverFoodOfferSourceBasis(snapshot, {
    product: current,
    offer,
  });
  const basis = fresh.paidMassBasis;
  return (
    fresh.selectedSkuBound === true &&
    fresh.selectionConflict === false &&
    basis.basis === 'one-inner-food-package' &&
    basis.safeToMultiplyByPackCount === true &&
    basis.requiresReview === false &&
    basis.holdFields.length === 0
  );
}

/** Merge pending fields before old reviews or claims can mask fresh extraction. */
export function replayedSpecificationReviews(
  previous,
  current,
  snapshot,
  proof = {}
) {
  const clearMass = Boolean(
    proof &&
    sameQuantitySource(previous, current, proof) &&
    obsoleteAutomaticHold(previous, current) &&
    !independentQuantityHold(previous) &&
    !independentQuantityHold(current) &&
    safeFreshBasis(snapshot, current, proof)
  );
  return [
    ...new Set([
      ...(previous?.pendingSpecificationReview || []).filter(
        (field) => !clearMass || field !== 'netMassG'
      ),
      ...(current?.pendingSpecificationReview || []),
    ]),
  ];
}
