// A disputed amount is kept in original claims, but cannot be a denominator.
// A later exact manufacturer correction can resolve the hold independently.
export async function applySpecificationHolds(store, product) {
  const result = { ...product };
  for (const field of ['netMassG', 'netVolumeMl']) {
    const hold = await store.get(
      'specification-hold',
      `${product.sku}:${field}`
    );
    if (!hold?.active || !hold.evidenceId) {
      continue;
    }
    const identity = product.manufacturerVerification;
    const corrected =
      identity?.identityMatched &&
      identity.sourceAuthority === 'manufacturer' &&
      Date.parse(identity.checkedAt) > Date.parse(hold.reviewedAt) &&
      product.claims?.some(
        (claim) =>
          claim.field === field &&
          claim.source === 'manufacturer' &&
          !claim.requiresReview &&
          claim.evidenceId === identity.evidenceId &&
          claim.value === product[field]
      );
    if (!corrected) {
      delete result[field];
      result.pendingSpecificationReview = [
        ...new Set([...(result.pendingSpecificationReview || []), field]),
      ];
      result.specificationHolds = [...(result.specificationHolds || []), hold];
    }
  }
  return result;
}
