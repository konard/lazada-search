import { applyListingCategoryReview } from './category-review.js';
import { listingKey } from './util.js';
import { REQUIRED_SPEC_FIELDS } from './verification.js';

const reviewedSpecFields = new Set([
  ...REQUIRED_SPEC_FIELDS,
  'packCount',
  'servingMassG',
  'netVolumeMl',
]);

const unionRecords = (left = [], right = []) => [
  ...new Map(
    [...left, ...right].map((record) => [JSON.stringify(record), record])
  ).values(),
];

// Shared reviews are corrections to the same captured SKU, not replacement
// observations. Private prices, raw claims and capture dates remain independent.
function sameCapturedSku(product, shared) {
  const observed = Date.parse(product.observedAt);
  return (
    Boolean(shared) &&
    shared.id === product.id &&
    shared.sku === product.sku &&
    listingKey(shared.url) === listingKey(product.url) &&
    Number.isFinite(observed) &&
    observed === Date.parse(shared.observedAt)
  );
}

function sharedReviewIsNewer(review, product) {
  const sourceTime = Date.parse(review?.checkedAt);
  const privateTime = Date.parse(product.manufacturerVerification?.checkedAt);
  return (
    Number.isFinite(sourceTime) &&
    (!Number.isFinite(privateTime) || sourceTime > privateTime)
  );
}

export function mergeSharedManufacturerReview(product, shared) {
  const review = shared?.manufacturerVerification;
  if (
    !sameCapturedSku(product, shared) ||
    !review?.identityMatched ||
    review.sourceAuthority !== 'manufacturer' ||
    !shared.evidenceIds?.includes(review.evidenceId) ||
    !sharedReviewIsNewer(review, product)
  ) {
    return product;
  }
  const claims = (shared.claims || []).filter(
    (claim) =>
      reviewedSpecFields.has(claim.field) &&
      claim.source === 'manufacturer' &&
      !claim.requiresReview &&
      claim.evidenceId === review.evidenceId &&
      (review.identityMethod !== 'visual-exact-variant' ||
        claim.reviewId === review.reviewId) &&
      JSON.stringify(claim.value) === JSON.stringify(shared[claim.field])
  );
  if (!claims.length) {
    return product;
  }
  const updated = globalThis.structuredClone(product);
  for (const claim of claims) {
    updated[claim.field] = globalThis.structuredClone(claim.value);
  }
  updated.manufacturerVerification = globalThis.structuredClone(review);
  updated.claims = unionRecords(updated.claims, shared.claims);
  updated.corrections = unionRecords(updated.corrections, shared.corrections);
  updated.crossChecks = unionRecords(updated.crossChecks, shared.crossChecks);
  updated.evidenceIds = [
    ...new Set([...(updated.evidenceIds || []), ...shared.evidenceIds]),
  ];
  updated.reviewedFields = [
    ...new Set([
      ...(updated.reviewedFields || []),
      ...claims.map((claim) => claim.field),
    ]),
  ];
  return updated;
}

export async function resolveProductReviews(store, product) {
  if (!product) {
    return product;
  }
  const shared = await store.fallback?.get('product', product.id);
  return await applyListingCategoryReview(
    store,
    mergeSharedManufacturerReview(product, shared)
  );
}

export async function catalogProducts(store) {
  const products = await store.list('product');
  const shared = new Map(
    ((await store.fallback?.list('product')) || []).map((product) => [
      product.id,
      product,
    ])
  );
  const resolved = [];
  for (const product of products) {
    resolved.push(
      await applyListingCategoryReview(
        store,
        mergeSharedManufacturerReview(product, shared.get(product.id))
      )
    );
  }
  return resolved;
}
