import { isDeepStrictEqual } from 'node:util';
import { workflowSourceInvalidated } from './source-invalidation.js';
import { sha256 } from './util.js';
import { verifyOriginalBoundOcr } from './ocr-evidence.js';

export async function loadManufacturerSourceValidity(store, supplied = {}) {
  const [caches, invalidations] = await Promise.all([
    store.list('cache'),
    supplied.invalidations || store.list('invalidation'),
  ]);
  return {
    store,
    caches,
    invalidations,
    records: new Map(),
    blobs: new Map(),
    ocr: new Map(),
  };
}

/** One operation owns one lazily initialized promise, including parallel reads. */
export function createManufacturerSourceValidityLoader(store, supplied = {}) {
  let pending;
  return () => (pending ??= loadManufacturerSourceValidity(store, supplied));
}

function sourceContext(store, supplied) {
  return typeof supplied === 'function'
    ? supplied()
    : supplied || loadManufacturerSourceValidity(store);
}

function cached(map, key, read) {
  if (!map.has(key)) {
    map.set(key, read());
  }
  return map.get(key);
}

function record(context, kind, id) {
  return id
    ? cached(context.records, `${kind}:${id}`, () =>
        context.store.get(kind, id)
      )
    : undefined;
}

async function originalProblem(context, source, expectedHash) {
  if (
    workflowSourceInvalidated(source, context.caches, context.invalidations)
  ) {
    return 'Original source was invalidated';
  }
  if (source.status === 'failed' || source.challenge?.detected) {
    return 'Original source is failed or challenged';
  }
  if (!expectedHash) {
    return null;
  }
  const reference = [
    source.blob,
    source.html,
    source.image,
    source.screenshot,
  ].find((item) => item?.sha256 === expectedHash);
  if (
    !reference ||
    (source.sourceSha256 && source.sourceSha256 !== expectedHash)
  ) {
    return 'Original source digest changed';
  }
  try {
    const bytes = await cached(context.blobs, expectedHash, () =>
      context.store.blob(expectedHash)
    );
    return bytes &&
      sha256(bytes) === expectedHash &&
      bytes.length === reference.bytes
      ? null
      : 'Original source bytes are missing or corrupt';
  } catch {
    return 'Original source bytes are missing or corrupt';
  }
}

async function publicationProblem(context, source) {
  if (!source.parentSourceId) {
    return null;
  }
  const parent = await record(
    context,
    'manufacturer-source',
    source.parentSourceId
  );
  return parent
    ? originalProblem(context, parent, source.parentSourceSha256)
    : 'Original label publication is missing';
}

async function reviewProblem(context, claim, leaf) {
  const review = await record(context, 'manufacturer-review', claim.reviewId);
  if (!review) {
    return claim.sourceSha256 && claim.reviewId
      ? 'Source-bound approval record is missing'
      : null;
  }
  const invalid = await originalProblem(context, review);
  if (invalid) {
    return invalid;
  }
  const fact = review.facts?.[claim.field];
  if (
    fact &&
    (!isDeepStrictEqual(fact.value, claim.value) ||
      fact.sourceSha256 !== claim.sourceSha256)
  ) {
    return 'Approval no longer matches the retained fact';
  }
  if (fact?.ocrId) {
    try {
      const reference = [leaf.image, leaf.blob].find(
        (item) => item?.sha256 === claim.sourceSha256
      );
      await cached(context.ocr, `${fact.ocrId}:${claim.sourceSha256}`, () =>
        verifyOriginalBoundOcr(context.store, reference, fact.ocrId)
      );
    } catch {
      return 'Approved original OCR proof is no longer intact';
    }
  }
  return null;
}

async function claimProblem(context, claim) {
  const id = claim.sourceEvidenceId || claim.evidenceId;
  const leaf = await record(context, 'evidence', id);
  const fallback = { id, url: claim.sourceUrl, observedAt: claim.reviewedAt };
  const invalid = await originalProblem(
    context,
    leaf || fallback,
    claim.sourceSha256
  );
  if (invalid) {
    return invalid;
  }
  if (leaf?.sourceId) {
    const source = await record(context, 'manufacturer-source', leaf.sourceId);
    if (!source) {
      return 'Original manufacturer source record is missing';
    }
    const bound = await originalProblem(
      context,
      source,
      claim.sourceSha256 || leaf.sourceSha256
    );
    if (bound) {
      return bound;
    }
    const publication = await publicationProblem(context, source);
    if (publication) {
      return publication;
    }
  }
  return reviewProblem(context, claim, leaf || fallback);
}

async function granularChecksHandled(context, product, claims) {
  const urls = [];
  for (const check of product.crossChecks || []) {
    const review = await record(context, 'manufacturer-review', check.id);
    const facts = Object.entries(review?.facts || {});
    const relevant = claims.filter(
      (claim) => claim.evidenceId === check.evidenceId
    );
    const granular = (claim) =>
      Boolean(
        claim.sourceEvidenceId &&
        claim.sourceSha256 &&
        claim.reviewId === review?.id &&
        facts.some(
          ([field, fact]) =>
            field === claim.field &&
            fact.sourceSha256 === claim.sourceSha256 &&
            isDeepStrictEqual(fact.value, claim.value)
        )
      );
    if (
      check.manufacturerUrl &&
      facts.length &&
      relevant.length &&
      relevant.every(granular) &&
      facts.every(([field, fact]) =>
        relevant.some(
          (claim) =>
            claim.field === field &&
            isDeepStrictEqual(claim.value, fact.value) &&
            granular(claim)
        )
      )
    ) {
      urls.push(check.manufacturerUrl);
    }
  }
  return [...new Set(urls)];
}

function legacyHeldFields(context, product, approved, problems, handledUrls) {
  const invalid = (product.crossChecks || []).some(
    (check) =>
      !handledUrls.includes(check.manufacturerUrl) &&
      workflowSourceInvalidated(
        {
          id: check.evidenceId,
          url: check.manufacturerUrl,
          observedAt: check.checkedAt,
        },
        context.caches,
        context.invalidations
      )
  );
  if (!invalid) {
    return [];
  }
  const independentlyBound = (field) =>
    approved.some(
      (claim) =>
        claim.field === field &&
        isDeepStrictEqual(claim.value, product[field]) &&
        claim.sourceSha256 &&
        claim.sourceEvidenceId &&
        !problems.has(claim)
    ) ||
    (product.claims || []).some(
      (claim) =>
        claim.field === field &&
        isDeepStrictEqual(claim.value, product[field]) &&
        claim.packageQuantityReviewSha256 &&
        !claim.requiresReview
    );
  return [
    'netMassG',
    'netVolumeMl',
    'packCount',
    'proteinPer100g',
    'proteinPer100ml',
    'proteinPerPackageG',
    'sugarPer100g',
    'sugarPer100ml',
    'fatPer100g',
    'fatPer100ml',
    'saturatedFatPer100g',
    'saturatedFatPer100ml',
    'kcalPer100g',
    'kcalPer100ml',
    'ingredients',
  ].filter(
    (field) => product[field] !== undefined && !independentlyBound(field)
  );
}

/** Withdraw affected facts in memory only; preserved observations stay intact. */
export async function applyManufacturerSourceValidity(
  store,
  product,
  supplied
) {
  if (!product) {
    return product;
  }
  const claims = product.claims || [];
  const approved = claims.filter(
    (claim) =>
      claim.source === 'manufacturer' &&
      (!claim.requiresReview || claim.manufacturerSourceInvalidated)
  );
  if (!approved.length && !product.crossChecks?.length) {
    return product;
  }
  const context = await sourceContext(store, supplied);
  const problems = new Map();
  for (const claim of approved) {
    const problem = await claimProblem(context, claim);
    if (problem) {
      problems.set(claim, problem);
    }
  }
  const affected = [
    ...new Set(
      approved
        .filter(
          (claim) =>
            problems.has(claim) &&
            isDeepStrictEqual(claim.value, product[claim.field]) &&
            !approved.some(
              (other) =>
                other.field === claim.field &&
                isDeepStrictEqual(other.value, product[claim.field]) &&
                !problems.has(other)
            )
        )
        .map((claim) => claim.field)
    ),
  ];
  const handledUrls = await granularChecksHandled(context, product, approved);
  const legacyFields = legacyHeldFields(
    context,
    product,
    approved,
    problems,
    handledUrls
  );
  affected.push(...legacyFields.filter((field) => !affected.includes(field)));
  const result = {
    ...product,
    manufacturerSourceValidityHandledUrls: handledUrls,
  };
  if (!problems.size && !legacyFields.length) {
    return result;
  }
  result.claims = claims.map((claim) =>
    problems.has(claim)
      ? {
          ...claim,
          requiresReview: true,
          manufacturerSourceInvalidated: true,
          sourceInvalidationReason: problems.get(claim),
        }
      : claim
  );
  result.manufacturerSourceProblems = approved
    .filter((claim) => problems.has(claim))
    .map((claim) => ({
      field: claim.field,
      sourceEvidenceId: claim.sourceEvidenceId || claim.evidenceId,
      reason: problems.get(claim),
    }));
  for (const field of affected) {
    delete result[field];
  }
  if (affected.length) {
    result.pendingSpecificationReview = [
      ...new Set([...(product.pendingSpecificationReview || []), ...affected]),
    ];
    result.reviewedFields = (product.reviewedFields || []).filter(
      (field) => !affected.includes(field)
    );
    result.manufacturerVerification = {
      ...product.manufacturerVerification,
      identityMatched: false,
      sourceReviewRequired: true,
    };
  }
  return result;
}
