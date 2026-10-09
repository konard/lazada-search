export const REQUIRED_SPEC_FIELDS = [
  'netMassG',
  'proteinPer100g',
  'sugarPer100g',
  'fatPer100g',
  'saturatedFatPer100g',
  'kcalPer100g',
  'ingredients',
];

export function specificationProblems(product) {
  const verification = product.manufacturerVerification;
  const problems = [];
  if (
    !verification?.identityMatched ||
    verification.sourceAuthority !== 'manufacturer' ||
    !verification.evidenceId ||
    !product.evidenceIds?.includes(verification.evidenceId)
  ) {
    problems.push('Exact manufacturer variant verification required');
  }
  for (const field of REQUIRED_SPEC_FIELDS) {
    const present =
      field === 'ingredients'
        ? product.ingredients?.length > 0
        : Number.isFinite(product[field]);
    const sourced = product.claims?.some(
      (claim) =>
        claim.field === field &&
        JSON.stringify(claim.value) === JSON.stringify(product[field]) &&
        claim.source === 'manufacturer' &&
        !claim.requiresReview &&
        claim.evidenceId === verification?.evidenceId &&
        (verification?.identityMethod !== 'visual-exact-variant' ||
          claim.reviewId === verification.reviewId)
    );
    if (!present || !sourced) {
      problems.push(`Manufacturer specification required: ${field}`);
    }
  }
  return problems;
}

export function reconcileManufacturer(product, manufacturer, check) {
  const updated = globalThis.structuredClone(product);
  if (!check.identityMatched || check.sourceAuthority !== 'manufacturer') {
    return updated;
  }
  updated.claims ||= [];
  updated.corrections ||= [];
  for (const claim of manufacturer.claims || []) {
    if (
      claim.requiresReview ||
      claim.source !== 'manufacturer' ||
      claim.evidenceId !== check.evidenceId
    ) {
      continue;
    }
    if (
      updated[claim.field] !== undefined &&
      JSON.stringify(updated[claim.field]) !== JSON.stringify(claim.value)
    ) {
      updated.corrections.push({
        field: claim.field,
        previous: updated[claim.field],
        corrected: claim.value,
        evidenceId: check.evidenceId,
        sourceUrl: check.manufacturerUrl,
        correctedAt: check.checkedAt,
        reason: 'Exact manufacturer specification takes priority',
      });
    }
    updated[claim.field] = claim.value;
    updated.claims.push(claim);
  }
  updated.manufacturerVerification = {
    identityMatched: true,
    sourceAuthority: 'manufacturer',
    identityMethod: check.identityMethod,
    evidenceId: check.evidenceId,
    sourceUrl: check.manufacturerUrl,
    checkedAt: check.checkedAt,
  };
  updated.reviewedFields = [
    ...new Set([
      ...(updated.reviewedFields || []),
      ...(manufacturer.claims || [])
        .filter(
          (claim) => !claim.requiresReview && claim.source === 'manufacturer'
        )
        .map((claim) => claim.field),
    ]),
  ];
  return updated;
}
