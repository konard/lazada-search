import { canonicalUrl, listingKey, sha256 } from './util.js';

const categories = ['whey', 'protein-powder', 'chocolate-ice-cream', 'unknown'];

export async function applyListingCategoryReview(store, product) {
  const review = await store.get(
    'category-review',
    `category:${listingKey(product.url)}`
  );
  if (!review) {
    return product;
  }
  if (product.category !== review.category) {
    product.corrections ||= [];
    product.corrections.push({
      field: 'category',
      previous: product.category,
      corrected: review.category,
      evidenceId: review.evidenceId,
      sourceUrl: review.url,
      correctedAt: review.reviewedAt,
      reason: review.reason,
    });
  }
  product.category = review.category;
  product.categoryReview = review;
  product.reviewedFields = [
    ...new Set([...(product.reviewedFields || []), 'category']),
  ];
  product.evidenceIds = [
    ...new Set([...(product.evidenceIds || []), review.evidenceId]),
  ];
  product.claims ||= [];
  if (
    !product.claims.some(
      (claim) =>
        claim.reviewId === review.id &&
        claim.reviewedAt === review.reviewedAt &&
        claim.value === review.category
    )
  ) {
    product.claims.push({
      field: 'category',
      value: review.category,
      source: 'manual-review',
      evidenceId: review.evidenceId,
      reviewId: review.id,
      requiresReview: false,
      excerpt: review.reason,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
    });
  }
  return product;
}

export async function reviewListingCategory(application, url, review) {
  application.assertMarket(url);
  if (
    !categories.includes(review.category) ||
    !review.reviewedBy?.trim() ||
    !review.reason?.trim()
  ) {
    throw new Error(
      'Listing category review requires a supported category, reviewer and reason'
    );
  }
  const key = listingKey(url);
  const evidence = await application.store.get('evidence', review.evidenceId);
  const products = (await application.store.list('product')).filter(
    (p) => listingKey(p.url) === key
  );
  if (
    !evidence ||
    evidence.role !== 'listing' ||
    listingKey(evidence.url) !== key ||
    !products.some((p) => p.evidenceIds?.includes(evidence.id))
  ) {
    throw new Error(
      'Listing category review requires attached evidence from the same Lazada item'
    );
  }
  const id = `category:${key}`;
  const previous = await application.store.get('category-review', id);
  if (previous) {
    await application.store.put('category-review-history', {
      ...previous,
      id: `${id}:${sha256(JSON.stringify(previous))}`,
    });
  }
  const saved = await application.store.put('category-review', {
    id,
    url: canonicalUrl(url),
    category: review.category,
    status: review.category === 'unknown' ? 'quarantined' : 'reviewed',
    evidenceId: evidence.id,
    reviewedBy: review.reviewedBy.trim(),
    reason: review.reason.trim(),
    reviewedAt: new Date().toISOString(),
    scope: 'listing',
  });
  for (const product of products) {
    await application.store.put(
      'product',
      await applyListingCategoryReview(application.store, product)
    );
  }
  return saved;
}
