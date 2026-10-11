import { hasReviewedPackageMass } from './reviewed-package-mass.js';

const digestPattern = /^[a-f\d]{64}$/u;

function activeHold(product, field) {
  return product.specificationHolds?.some(
    (hold) => hold.active && hold.field === field
  );
}

function sameOriginal(previous, current, proof) {
  return (
    ['id', 'sku', 'url', 'observedAt'].every(
      (field) =>
        typeof previous?.[field] === 'string' &&
        previous[field].length > 0 &&
        previous[field] === current?.[field]
    ) &&
    Number.isFinite(Date.parse(previous.observedAt)) &&
    Boolean(proof.evidenceId) &&
    previous.evidenceIds?.includes(proof.evidenceId) &&
    current.evidenceIds?.includes(proof.evidenceId) &&
    digestPattern.test(proof.previousHtmlSha256 || '') &&
    proof.previousHtmlSha256 === proof.originalHtmlSha256
  );
}

function factoryListingBinding(product, claim, listingEvidenceId) {
  const review = product.manufacturerVerification;
  if (
    claim.source !== 'manufacturer' ||
    review?.identityMethod !== 'visual-exact-variant' ||
    !review.reviewId ||
    claim.reviewId !== review.reviewId ||
    claim.evidenceId !== review.evidenceId
  ) {
    return false;
  }
  return product.crossChecks?.some(
    (check) =>
      check.id === review.reviewId &&
      check.evidenceId === claim.evidenceId &&
      check.listingEvidenceId === listingEvidenceId &&
      check.identityMatched === true &&
      check.sourceAuthority === 'manufacturer' &&
      check.identityMethod === 'visual-exact-variant' &&
      !check.requiresReview &&
      !check.invalidated &&
      !check.invalidatedAt &&
      check.identity?.listing?.packCount === claim.value &&
      check.identity?.manufacturer?.packCount === claim.value
  );
}

function reviewedCount(product, count, evidenceId) {
  if (!Number.isInteger(count) || count < 1) {
    return false;
  }
  // Reuse the existing authority rules with the count claim mapped solely for
  // validation. This projection never replaces any product field or claim.
  const projected = {
    ...product,
    netMassG: count,
    reviewedFields: product.reviewedFields?.includes('packCount')
      ? ['netMassG']
      : [],
    claims: (product.claims || [])
      .filter(
        (claim) =>
          claim.field === 'packCount' &&
          (claim.evidenceId === evidenceId ||
            factoryListingBinding(product, claim, evidenceId))
      )
      .map((claim) => ({ ...claim, field: 'netMassG' })),
  };
  return hasReviewedPackageMass(projected);
}

function automaticFields(current, evidenceId) {
  const fields = new Set();
  const conflict = current.packageMassConsistency;
  const boundConflict =
    conflict?.field === 'netMassG' &&
    conflict.evidenceIds?.includes(evidenceId);
  if (conflict?.requiresReview === true && !boundConflict) {
    return fields;
  }
  if (conflict?.requiresReview === true && boundConflict) {
    fields.add('netMassG');
  }
  if (current.paidMassBasis?.requiresReview === true) {
    for (const field of current.paidMassBasis.holdFields || []) {
      if (['netMassG', 'packCount'].includes(field)) {
        fields.add(field);
      }
    }
  }
  return fields;
}

function countIsResolved(previous, current, automatic, evidenceId) {
  if (
    previous.pendingSpecificationReview?.includes('packCount') ||
    activeHold(previous, 'packCount') ||
    activeHold(current, 'packCount')
  ) {
    return false;
  }
  const pending = current.pendingSpecificationReview?.includes('packCount');
  if (pending && !automatic.has('packCount')) {
    return false;
  }
  if (automatic.has('packCount')) {
    return reviewedCount(previous, current.packCount, evidenceId);
  }
  return (
    current.packCount === previous.packCount ||
    reviewedCount(previous, current.packCount, evidenceId)
  );
}

function eligibleReplay(previous, current, proof) {
  return (
    sameOriginal(previous, current, proof) &&
    hasReviewedPackageMass(previous) &&
    previous.netMassG > 0 &&
    current.netMassG === previous.netMassG &&
    !current.specificationsInvalidated &&
    !previous.pendingSpecificationReview?.includes('netMassG') &&
    !activeHold(previous, 'netMassG') &&
    !activeHold(current, 'netMassG')
  );
}

/** Keep an existing exact-original review through fresh automatic extraction. */
export function preserveReviewedPaidMass(previous, current, proof = {}) {
  if (!proof || !eligibleReplay(previous, current, proof)) {
    return current;
  }
  const automatic = automaticFields(current, proof.evidenceId);
  if (
    !automatic.has('netMassG') ||
    !current.pendingSpecificationReview?.includes('netMassG') ||
    !countIsResolved(previous, current, automatic, proof.evidenceId)
  ) {
    return current;
  }
  const result = { ...current };
  result.pendingSpecificationReview = [
    ...new Set([
      ...(previous.pendingSpecificationReview || []),
      ...current.pendingSpecificationReview.filter(
        (field) => !automatic.has(field)
      ),
    ]),
  ];
  const resolution = {
    method: 'same-source-existing-package-review',
    evidenceId: proof.evidenceId,
    sourceSha256: proof.originalHtmlSha256,
  };
  if (current.packageMassConsistency?.requiresReview === true) {
    result.packageMassConsistency = {
      ...current.packageMassConsistency,
      requiresReview: false,
      resolution,
    };
  }
  if (current.paidMassBasis?.requiresReview === true) {
    const holdFields = (current.paidMassBasis.holdFields || []).filter(
      (field) => !automatic.has(field)
    );
    result.paidMassBasis = {
      ...current.paidMassBasis,
      holdFields,
      requiresReview: holdFields.length > 0,
      safeToMultiplyByPackCount: holdFields.length === 0,
      resolution,
    };
  }
  return result;
}
