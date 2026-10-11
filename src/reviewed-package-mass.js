function factoryClaim(product, claim) {
  const review = product.manufacturerVerification;
  return Boolean(
    review?.identityMatched === true &&
    review.sourceAuthority === 'manufacturer' &&
    claim.source === 'manufacturer' &&
    claim.evidenceId === review.evidenceId &&
    (review.identityMethod !== 'visual-exact-variant' ||
      (review.reviewId && claim.reviewId === review.reviewId))
  );
}

function operatorClaim(product, claim) {
  if (claim.source === 'selected-package-label-review') {
    return Boolean(
      claim.reviewedBy &&
      claim.selectedSku === product.sku &&
      /^[a-f\d]{64}$/u.test(claim.imageSha256 || '')
    );
  }
  return (
    claim.source === 'manual-review' &&
    product.reviewedFields?.includes('netMassG') &&
    Number.isFinite(Date.parse(claim.reviewedAt))
  );
}

// Recognizes existing review metadata; original authority and bytes are still
// checked by the review/evidence pipeline. Bare flags grant no exemption.
export function hasReviewedPackageMass(product) {
  if (product.specificationsInvalidated) {
    return false;
  }
  return (product.claims || []).some(
    (claim) =>
      claim.field === 'netMassG' &&
      claim.value === product.netMassG &&
      !claim.requiresReview &&
      !claim.invalidated &&
      !claim.invalidatedAt &&
      product.evidenceIds?.includes(claim.evidenceId) &&
      (factoryClaim(product, claim) || operatorClaim(product, claim))
  );
}
