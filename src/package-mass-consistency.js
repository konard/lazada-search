import { fold, clone } from './util.js';
import { massEvidence } from './nutrition.js';
import { hasReviewedPackageMass } from './reviewed-package-mass.js';

const servingProtein =
  /(\d+(?:[.,]\d+)?)\s*(?:grams?|gam|g)\s*(?:of\s+)?(?:protein|dam)\s*(?:per|each|moi)\s*(?:serving|khau phan|lan dung)\b/gu;
const servingCount = /\b(\d+)\s*(?:servings?|sers?|khau phan|lan dung)\b/gu;

function explicitTrial(product, options) {
  return [product.title || '', options].some((value) => {
    const text = fold(value).replace(/(\p{L})(?=\d)/gu, '$1 ');
    return (
      /(?:^|[;,+-])\s*(?:(?:goi|tui|bag|pouch)\s+)?(?:repack|sample|trial|share|dung thu|tui zip)\b/u.test(
        text
      ) && massEvidence(value).selected?.value === product.netMassG
    );
  });
}

// This is a consistency hold, never a package-weight conversion. A seller's
// serving count and protein amount cannot approve a replacement food mass.
export function packageMassConsistency(product) {
  const mass = product?.netMassG;
  if (
    !['whey', 'protein-powder'].includes(product?.category) ||
    !(mass > 0) ||
    hasReviewedPackageMass(product)
  ) {
    return null;
  }
  const options = (product.selectedVariant || [])
    .map((option) => (typeof option === 'string' ? option : option.text))
    .join(' ');
  if (explicitTrial(product, options)) {
    return null;
  }
  return servingMassConflict(product, mass);
}

function servingMassConflict(product, mass) {
  const title = fold(product.title || '');
  const nutrients = [...title.matchAll(servingProtein)];
  const counts = [...title.matchAll(servingCount)].filter(
    (match) => Number(match[1]) > 1
  );
  if (nutrients.length !== 1 || counts.length !== 1) {
    return null;
  }
  const protein = Number(nutrients[0][1].replace(',', '.'));
  const count = Number(counts[0][1]);
  const packages = product.packCount || 1;
  if (!(protein > 0) || protein * count <= mass * packages) {
    return null;
  }
  return {
    field: 'netMassG',
    reason: 'Declared package mass is below its advertised total protein',
    declaredMassG: mass,
    advertisedPaidPackages: packages,
    perServingProteinG: protein,
    advertisedServings: count,
    sourceTitle: product.title,
    sourceMassExcerpt: product.massEvidence?.selected?.context || null,
    evidenceIds: product.evidenceIds || [],
    replacementMassG: null,
    requiresReview: true,
  };
}

export function applyPackageMassConsistency(product) {
  const conflict = packageMassConsistency(product);
  if (!conflict) {
    return product;
  }
  const result = clone(product);
  result.packageMassConsistency = conflict;
  result.pendingSpecificationReview = [
    ...new Set([...(result.pendingSpecificationReview || []), 'netMassG']),
  ];
  result.warnings = [...new Set([...(result.warnings || []), conflict.reason])];
  for (const claim of result.claims || []) {
    if (claim.field === 'netMassG') {
      claim.requiresReview = true;
      claim.consistencyReviewRequired = true;
    }
  }
  return result;
}
