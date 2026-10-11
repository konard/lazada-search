import { parseHTML } from 'linkedom';
import { extractPage } from './browser.js';
import { parseProduct } from './products.js';
import { listingKey, sha256 } from './util.js';

export const fields = { netMassG: 'g', netVolumeMl: 'ml' };
const authorities = new Set([
  'manufacturer',
  'manufacturer-product-endpoint',
  'manufacturer-product-image',
  'exact-package-label',
  'manufacturer-label-secondary-host',
  'seller-promotional-panel',
  'marketplace-seller',
]);
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        )
      : item
  );
export const selected = (product) =>
  [
    ...new Set(
      (product.selectedVariant || [])
        .filter((entry) => entry.selected !== false)
        .map((entry) => entry.text)
    ),
  ].sort();
const digestFields = [
  'id',
  'productId',
  'sku',
  'url',
  'observedAt',
  'selectedOptions',
  'listingEvidenceId',
  'listingSha256',
  'reviewedBy',
  'reason',
  'reviewedAt',
  'facts',
  'originalQuantities',
  'nutritionApproved',
  'factoryIdentityApproved',
];
export const digest = (review) =>
  sha256(
    stable(
      Object.fromEntries(digestFields.map((field) => [field, review[field]]))
    )
  );
export const invalid = (value) =>
  Boolean(value?.invalidated || value?.invalidatedAt);
export const fail = (message) => {
  throw new Error(`Package quantity review: ${message}`);
};

export async function loadPackageQuantityReviews(store) {
  const records = await store.list('package-quantity-review');
  return {
    reviews: new Map(records.map((review) => [review.productId, review])),
    invalidations: records.length ? await store.list('invalidation') : [],
    holds: new Map(
      (records.length ? await store.list('specification-hold') : []).map(
        (hold) => [hold.id, hold]
      )
    ),
    evidence: new Map(),
    blobs: new Map(),
    caches: new Map(),
    originals: new Map(),
  };
}

function cached(map, key, read) {
  if (!map.has(key)) {
    map.set(key, read());
  }
  return map.get(key);
}

async function evidenceOriginal(store, context, id, hash) {
  const evidence = await cached(context.evidence, id, () =>
    store.get('evidence', id)
  );
  const reference = [evidence?.html, evidence?.image, evidence?.blob].find(
    (item) => item?.sha256 === hash
  );
  if (!reference || invalid(evidence)) {
    fail('missing or invalidated original evidence');
  }
  const bytes = await cached(context.blobs, hash, () => store.blob(hash));
  if (!bytes || sha256(bytes) !== hash || bytes.length !== reference.bytes) {
    fail('original evidence bytes or digest mismatch');
  }
  const cache = evidence.cacheId
    ? await cached(context.caches, evidence.cacheId, () =>
        store.get('cache', evidence.cacheId)
      )
    : undefined;
  if (
    invalid(cache) ||
    context.invalidations.some(
      (entry) =>
        entry.active !== false &&
        entry.invalidated !== false &&
        !entry.resolvedAt &&
        (entry.url === evidence.url ||
          entry.evidenceIds?.includes(id) ||
          (evidence.cacheId && entry.cacheIds?.includes(evidence.cacheId)))
    )
  ) {
    fail('original source invalidation');
  }
  return { evidence, bytes };
}

function blocked(product, field, context) {
  return Boolean(
    product.specificationsInvalidated ||
    product.packageCountUnresolved ||
    product.pendingSpecificationReview?.some((item) =>
      [field, 'packCount'].includes(item)
    ) ||
    product.packageMassConsistency?.requiresReview ||
    product.paidMassBasis?.requiresReview ||
    [field, 'packCount'].some(
      (item) => context.holds.get(`${product.sku}:${item}`)?.active
    ) ||
    product.specificationHolds?.some(
      (hold) =>
        hold.active !== false && [field, 'packCount'].includes(hold.field)
    ) ||
    product.claims?.some(
      (claim) =>
        [field, 'packCount'].includes(claim.field) &&
        (invalid(claim) ||
          claim.consistencyReviewRequired ||
          (claim.source === 'manual-review' && claim.requiresReview !== false))
    ) ||
    product.crossChecks?.some((check) =>
      check.conflicts?.some((conflict) =>
        [field, 'packCount'].includes(conflict.field)
      )
    )
  );
}

function validateFacts(facts) {
  if (!facts || !Object.keys(facts).length) {
    fail('requires measured quantity facts');
  }
  for (const [field, fact] of Object.entries(facts)) {
    if (
      !fields[field] ||
      !fact ||
      !(Number.isFinite(fact.value) && fact.value > 0) ||
      fact.unit !== fields[field] ||
      fact.basis !== 'one-inner-food-package' ||
      fact.identityMatched !== true ||
      !authorities.has(fact.sourceAuthority) ||
      !hasSource(fact)
    ) {
      fail('unsupported, ambiguous or unsourced quantity fact');
    }
  }
}

function hasSource(fact) {
  return Boolean(
    fact.sourceEvidenceId?.trim() &&
    fact.excerpt?.trim() &&
    /^[a-f\d]{64}$/u.test(fact.sourceSha256 || '')
  );
}

async function originalListing(store, product, review, context) {
  if (!product.evidenceIds?.includes(review.listingEvidenceId)) {
    fail('listing not attached');
  }
  const { evidence, bytes } = await evidenceOriginal(
    store,
    context,
    review.listingEvidenceId,
    review.listingSha256
  );
  if (
    evidence.role !== 'listing' ||
    evidence.html?.sha256 !== review.listingSha256 ||
    listingKey(evidence.url) !== listingKey(product.url) ||
    Date.parse(evidence.observedAt) !== Date.parse(product.observedAt)
  ) {
    fail('listing identity or observation mismatch');
  }
  const parsed = await cached(
    context.originals,
    stable([
      review.listingEvidenceId,
      review.listingSha256,
      product.observedAt,
    ]),
    () => {
      const snapshot = extractPage({
        document: parseHTML(bytes.toString('utf8')).document,
        url: evidence.url,
      });
      return parseProduct(snapshot, {
        evidenceId: evidence.id,
        originalHtmlSha256: review.listingSha256,
        observedAt: evidence.observedAt,
      });
    }
  );
  if (
    parsed.product.id !== product.id ||
    parsed.product.sku !== product.sku ||
    stable(selected(parsed.product)) !== stable(selected(product)) ||
    (parsed.product.packCount || 1) !== (product.packCount || 1) ||
    parsed.product.packageCountUnresolved !== product.packageCountUnresolved
  ) {
    fail('original selected SKU, selection or count mismatch');
  }
  return parsed.product;
}

function assertSourceIdentity(product, evidence) {
  if (
    (evidence.productId && evidence.productId !== product.id) ||
    !/^https?:\/\//u.test(evidence.url || '')
  ) {
    fail('quantity source identity mismatch');
  }
}

function assertNoApprovedConflict(product, field, fact) {
  if (
    product.claims?.some(
      (claim) =>
        claim.field === field &&
        !claim.requiresReview &&
        claim.value === product[field] &&
        claim.value !== fact.value &&
        ((claim.source === 'manufacturer' &&
          product.manufacturerVerification?.identityMatched) ||
          (claim.source === 'manual-review' &&
            !claim.packageQuantityReviewSha256))
    )
  ) {
    fail('quantity conflicts with existing approved correction');
  }
}

export async function assertReview(store, product, review, context) {
  validateFacts(review.facts);
  if (
    review.id !== product.id ||
    review.productId !== product.id ||
    review.sku !== product.sku ||
    listingKey(review.url) !== listingKey(product.url) ||
    !Number.isFinite(Date.parse(product.observedAt)) ||
    Date.parse(review.observedAt) !== Date.parse(product.observedAt) ||
    stable(review.selectedOptions) !== stable(selected(product))
  ) {
    fail('review no longer matches exact product capture');
  }
  const original = await originalListing(store, product, review, context);
  for (const [field, fact] of Object.entries(review.facts)) {
    if (blocked(product, field, context)) {
      fail('explicit hold or quantity conflict');
    }
    if (!product.evidenceIds?.includes(fact.sourceEvidenceId)) {
      fail('quantity source not attached');
    }
    const { evidence } = await evidenceOriginal(
      store,
      context,
      fact.sourceEvidenceId,
      fact.sourceSha256
    );
    assertSourceIdentity(product, evidence);
    assertNoApprovedConflict(product, field, fact);
  }
  return original;
}
