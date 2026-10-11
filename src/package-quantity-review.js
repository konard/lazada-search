import {
  fields,
  selected,
  digest,
  invalid,
  fail,
  assertReview,
  loadPackageQuantityReviews,
} from './package-quantity-review-evidence.js';
export { loadPackageQuantityReviews } from './package-quantity-review-evidence.js';

export async function reviewPackageQuantities(application, productId, input) {
  if (application.cache?.offline !== true) {
    fail('requires offline source review');
  }
  const store = application.store;
  const product = await store.get('product', productId);
  if (
    !product ||
    !input?.reviewedBy?.trim() ||
    !input.reason?.trim() ||
    !/^[a-f\d]{64}$/u.test(input.listingSha256 || '')
  ) {
    fail('missing review identity or rationale');
  }
  const context = await loadPackageQuantityReviews(store);
  // Include explicit holds and invalidations even before the first saved review.
  context.invalidations = await store.list('invalidation');
  context.holds = new Map(
    (await store.list('specification-hold')).map((hold) => [hold.id, hold])
  );
  const review = {
    id: product.id,
    productId: product.id,
    sku: product.sku,
    url: product.url,
    observedAt: product.observedAt,
    selectedOptions: selected(product),
    listingEvidenceId: input.listingEvidenceId,
    listingSha256: input.listingSha256,
    reviewedBy: input.reviewedBy,
    reason: input.reason,
    reviewedAt: new Date().toISOString(),
    facts: globalThis.structuredClone(input.facts),
    nutritionApproved: false,
    factoryIdentityApproved: false,
  };
  const original = await assertReview(store, product, review, context);
  review.originalQuantities = Object.fromEntries(
    Object.keys(fields).map((field) => [field, original[field] ?? null])
  );
  const previous = context.reviews.get(product.id);
  const comparable = (record) => ({
    ...record,
    reviewedAt: undefined,
    reviewSha256: undefined,
    visibility: undefined,
  });
  if (
    previous &&
    previous.reviewSha256 === digest(previous) &&
    digest(comparable(previous)) === digest(comparable(review))
  ) {
    return previous;
  }
  review.reviewSha256 = digest(review);
  return store.put('package-quantity-review', review);
}

function withoutDerivedQuantities(product, review) {
  const result = globalThis.structuredClone(product);
  for (const field of Object.keys(fields)) {
    const claim = result.claims?.find(
      (item) =>
        item.field === field &&
        item.packageQuantityReviewSha256 &&
        item.value === result[field]
    );
    if (!claim) {
      continue;
    }
    const original = result.claims
      ?.filter(
        (item) =>
          item.field === field &&
          !item.packageQuantityReviewSha256 &&
          !item.requiresReview &&
          !invalid(item)
      )
      .at(-1);
    const value =
      original?.value ??
      (review?.reviewSha256 === claim.packageQuantityReviewSha256 &&
      review.observedAt === result.observedAt
        ? review.originalQuantities?.[field]
        : undefined);
    if (value === null || value === undefined) {
      delete result[field];
    } else {
      result[field] = value;
    }
    result.reviewedFields = (result.reviewedFields || []).filter(
      (item) => item !== field
    );
  }
  result.claims = (result.claims || []).filter(
    (claim) => !claim.packageQuantityReviewSha256
  );
  return result;
}

export async function applyPackageQuantityReview(store, product, context) {
  if (!product) {
    return product;
  }
  context ||= await loadPackageQuantityReviews(store);
  const review = context.reviews.get(product.id);
  const result = withoutDerivedQuantities(product, review);
  if (!review || review.reviewSha256 !== digest(review)) {
    return result;
  }
  try {
    await assertReview(store, result, review, context);
  } catch {
    return result;
  }
  for (const [field, fact] of Object.entries(review.facts)) {
    result[field] = fact.value;
    result.claims.push({
      field,
      value: fact.value,
      source: 'manual-review',
      evidenceId: fact.sourceEvidenceId,
      sourceEvidenceId: fact.sourceEvidenceId,
      sourceSha256: fact.sourceSha256,
      sourceAuthority: fact.sourceAuthority,
      excerpt: fact.excerpt,
      basis: fact.basis,
      requiresReview: false,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      packageQuantityReviewSha256: review.reviewSha256,
    });
    result.reviewedFields = [
      ...new Set([...(result.reviewedFields || []), field]),
    ];
  }
  return result;
}
