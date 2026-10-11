import { massEvidence } from './nutrition.js';
import { selectedPackageArtwork } from './package-image.js';

function sourceMatches(product, evidence) {
  return !(
    !evidence.evidenceId ||
    !/^[a-f\d]{64}$/u.test(evidence.imageSha256 || '') ||
    evidence.imageSha256 !== evidence.matchedImageSha256 ||
    !/^[a-f\d]{64}$/u.test(evidence.originalHtmlSha256 || '') ||
    evidence.confidence < 0.9 ||
    evidence.confidence > 1 ||
    !Number.isFinite(evidence.confidence) ||
    !Number.isFinite(Date.parse(evidence.observedAt)) ||
    product.observedAt !== evidence.observedAt ||
    !(product.netMassG > 0)
  );
}

function disputedNetMass(product, text) {
  const amounts = massEvidence(text);
  const mass = amounts.selected;
  if (
    !mass?.metric ||
    mass.scope !== 'net' ||
    new Set(
      amounts.candidates
        .filter((candidate) => candidate.metric && candidate.scope === 'net')
        .map((candidate) => candidate.value)
    ).size !== 1 ||
    Math.abs(mass.value - product.netMassG) <=
      (product.massEvidence?.selected?.metric ? 0 : 0.5)
  ) {
    return undefined;
  }
  return mass;
}

/** Preserve conflicting shared selected artwork as a hold, never a correction. */
export function applySharedPackageArtworkConflict(product, snapshot, evidence) {
  const artwork = selectedPackageArtwork(snapshot, product, evidence.imageUrl);
  if (
    !artwork ||
    artwork.sharedSkuIds.length < 2 ||
    !sourceMatches(product, evidence)
  ) {
    return { applied: false };
  }
  const mass = disputedNetMass(product, evidence.text);
  if (!mass) {
    return { applied: false };
  }
  const conflict = {
    field: 'netMassG',
    source: 'shared-selected-package-artwork',
    declaredMassG: product.netMassG,
    candidateMassG: mass.value,
    selectedSku: product.sku,
    sharedCatalogSkuIds: artwork.sharedSkuIds,
    imageUrl: evidence.imageUrl,
    imageSha256: evidence.imageSha256,
    originalHtmlSha256: evidence.originalHtmlSha256,
    observedAt: evidence.observedAt,
    evidenceId: evidence.evidenceId,
    confidence: evidence.confidence,
    excerpt: mass.excerpt,
    requiresReview: true,
    replacementMassApproved: false,
  };
  product.packageArtworkConflicts ||= [];
  if (
    !product.packageArtworkConflicts.some(
      (entry) => JSON.stringify(entry) === JSON.stringify(conflict)
    )
  ) {
    product.packageArtworkConflicts.push(conflict);
    product.claims ||= [];
    product.claims.push({
      ...conflict,
      value: mass.value,
      consistencyReviewRequired: true,
    });
  }
  product.pendingSpecificationReview = [
    ...new Set([...(product.pendingSpecificationReview || []), 'netMassG']),
  ];
  const warning =
    'Shared selected package artwork conflicts with selling mass; exact package review required';
  product.warnings = [...new Set([...(product.warnings || []), warning])];
  product.evidenceIds = [
    ...new Set([...(product.evidenceIds || []), evidence.evidenceId]),
  ];
  return { applied: true, requiresReview: true, candidateMassG: mass.value };
}
