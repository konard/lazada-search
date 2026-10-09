import { fold, sha256 } from './util.js';
import { validateProduct } from './products.js';
import { isTrustedManufacturer } from './manufacturers.js';
import { reconcileManufacturer, REQUIRED_SPEC_FIELDS } from './verification.js';

const identityFields = ['brand', 'name', 'flavour', 'netMassG', 'packCount'];
const allowedFields = [
  ...REQUIRED_SPEC_FIELDS,
  'servingMassG',
  'netVolumeMl',
  'packCount',
];

function sameIdentityValue(left, right) {
  return typeof left === 'string'
    ? Boolean(fold(left)) && fold(left) === fold(right)
    : left === right;
}

async function attachedEvidence(application, productId, review) {
  const product = await application.store.get('product', productId);
  const official = await application.store.get('evidence', review.evidenceId);
  const listing = await application.store.get(
    'evidence',
    review.listingEvidenceId
  );
  const check = product?.crossChecks?.find(
    (c) => c.evidenceId === review.evidenceId
  );
  if (
    !product ||
    !official ||
    !listing ||
    !product.evidenceIds.includes(review.evidenceId) ||
    !product.evidenceIds.includes(review.listingEvidenceId) ||
    !['listing', 'ocr'].includes(listing.role) ||
    official.role !== 'manufacturer-supplied-by-operator' ||
    check?.sourceAuthority !== 'manufacturer' ||
    !isTrustedManufacturer(
      product,
      official.url,
      application.manufacturerRegistry
    )
  ) {
    throw new Error(
      'Review requires attached listing and trusted manufacturer evidence'
    );
  }
  return { product, official, listing, check };
}

function checkIdentity(product, review) {
  if (!review.reviewedBy?.trim() || !review.reason?.trim()) {
    throw new Error(
      'Manufacturer review requires reviewer and matching rationale'
    );
  }
  for (const field of identityFields) {
    const left = review.identity?.listing?.[field];
    const right = review.identity?.manufacturer?.[field];
    if (
      left === undefined ||
      right === undefined ||
      !sameIdentityValue(left, right)
    ) {
      throw new Error(`Exact manufacturer identity mismatch: ${field}`);
    }
  }
  const declaredBrand = review.identity.manufacturer.brand;
  if (
    !fold(product.title).includes(fold(declaredBrand)) &&
    fold(product.brand) !== fold(declaredBrand)
  ) {
    throw new Error('Reviewed brand conflicts with listing identity');
  }
}

async function checkPublishedImage(application, official, evidenceId) {
  if (evidenceId === official.id) {
    return;
  }
  const leaf = await application.store.get('evidence', evidenceId);
  if (!leaf || !leaf.image || leaf.role !== 'ocr') {
    throw new Error('Manufacturer label must be linked to the official page');
  }
  const page = await application.store.get(
    'cache',
    `manufacturer:${official.url}`
  );
  if (
    leaf.url !== official.url &&
    !page?.snapshot?.productImages?.includes(leaf.url)
  ) {
    throw new Error('Label image was not published on the manufacturer page');
  }
  const image =
    leaf.url === official.url
      ? page?.screenshot
      : (await application.store.get('cache', `image:${leaf.url}`))?.blob;
  if (image?.sha256 !== leaf.image.sha256) {
    throw new Error(
      'Manufacturer label bytes do not match the captured source'
    );
  }
}

async function reviewedClaims(application, official, review) {
  const claims = [];
  for (const [field, fact] of Object.entries(review.facts || {})) {
    if (!allowedFields.includes(field) || !fact.excerpt?.trim()) {
      throw new Error(`Unsupported or unsourced manufacturer field: ${field}`);
    }
    await checkPublishedImage(application, official, fact.evidenceId);
    claims.push({
      field,
      value: fact.value,
      evidenceId: official.id,
      sourceEvidenceId: fact.evidenceId,
      source: 'manufacturer',
      requiresReview: false,
      excerpt: fact.excerpt,
      reviewedBy: review.reviewedBy,
      reviewedAt: new Date().toISOString(),
    });
  }
  for (const field of ['netMassG', 'packCount']) {
    const claim = claims.find((c) => c.field === field);
    if (!claim || claim.value !== review.identity.manufacturer[field]) {
      throw new Error(
        `Manufacturer package specification must match reviewed identity: ${field}`
      );
    }
  }
  return claims;
}

function applyReview(product, official, listing, check, review, claims) {
  const result = {
    ...check,
    id: `manufacturer-review:${sha256(JSON.stringify({ productId: product.id, review }))}`,
    identityMatched: true,
    identityMethod: 'visual-exact-variant',
    checkedAt: new Date().toISOString(),
    reviewedBy: review.reviewedBy,
    reason: review.reason,
    identity: review.identity,
    listingEvidenceId: listing.id,
  };
  for (const claim of claims) {
    claim.reviewId = result.id;
  }
  const updated = validateProduct(
    reconcileManufacturer(product, { claims }, result)
  );
  updated.manufacturerVerification.reviewId = result.id;
  updated.manufacturerVerification.identity = review.identity.manufacturer;
  updated.crossChecks = [...(updated.crossChecks || []), result];
  const leafIds = claims.map((c) => c.sourceEvidenceId);
  updated.evidenceIds = [...new Set([...updated.evidenceIds, ...leafIds])];
  official.extracted.evidenceIds = [
    ...new Set([...official.extracted.evidenceIds, ...leafIds]),
  ];
  return { updated, result };
}

// An explicit visual review can match packages without a common GTIN. The
// reviewer supplies checked facts; this does not establish seller authenticity.
export async function reviewManufacturer(application, productId, review) {
  const { product, official, listing, check } = await attachedEvidence(
    application,
    productId,
    review
  );
  checkIdentity(product, review);
  const claims = await reviewedClaims(application, official, review);
  const { updated, result } = applyReview(
    product,
    official,
    listing,
    check,
    review,
    claims
  );
  await application.store.put('evidence', official);
  await application.store.put('manufacturer-review', result);
  await application.store.put('product', updated);
  return updated;
}
