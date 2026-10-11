import { proteinAmount } from '../src/protein-amount.js';

// Package mass, volume and protein are independent measured quantities. A label
// expressed per 100 ml can price protein without inventing a package weight.
const positive = (value) => Number.isFinite(value) && value > 0;

function acceptedFact(field, fact) {
  return (
    fact?.identityMatched === true &&
    fact.placeholder !== true &&
    fact.hasDeclaredBasis !== false &&
    (field === 'ingredients'
      ? Array.isArray(fact.value) &&
        fact.value.every((value) => typeof value === 'string')
      : Number.isFinite(fact.value) && fact.value >= 0) &&
    /^https?:\/\//u.test(fact.sourceUrl || '') &&
    /^[a-f\d]{64}$/u.test(fact.sourceSha256 || '') &&
    Boolean(fact.excerpt?.trim())
  );
}

const authority = (fact) =>
  ({
    manufacturer: 3,
    'manufacturer-product-endpoint': 3,
    'manufacturer-product-image': 3,
    'exact-package-label': 2,
    'manufacturer-label-secondary-host': 2,
    'seller-promotional-panel': 1,
  })[fact.sourceAuthority] || 0;

function selectFacts(applicable) {
  const facts = {};
  const conflicts = [];
  const superseded = [];
  const candidates = new Map();
  for (const review of applicable) {
    for (const [field, fact] of Object.entries(review.facts || {})) {
      if (!acceptedFact(field, fact)) {
        continue;
      }
      const values = candidates.get(field) || [];
      values.push(fact);
      candidates.set(field, values);
    }
  }
  for (const [field, values] of candidates) {
    const highest = Math.max(...values.map(authority));
    const preferred = values.filter((fact) => authority(fact) === highest);
    superseded.push(
      ...values
        .filter((fact) => authority(fact) < highest)
        .map((fact) => ({ field, fact }))
    );
    if (new Set(preferred.map((fact) => JSON.stringify(fact.value))).size > 1) {
      conflicts.push(field);
    } else {
      facts[field] = preferred.at(-1);
    }
  }
  return { facts, conflicts, superseded };
}

function eligibility(applicable) {
  return applicable.some((review) => review.strictChocolateEligible === false)
    ? false
    : applicable.some((review) => review.strictChocolateEligible === true)
      ? true
      : null;
}

const packageAmount = (fact, packages, fallback) =>
  positive(fact?.value) ? fact.value * packages : fallback;
const rate = (total, amount) =>
  Number.isFinite(total) && positive(amount) ? total / amount : null;

function measuredAmount(
  field,
  facts,
  conflicts,
  invalidated,
  packages,
  fallback
) {
  if (
    !positive(packages) ||
    conflicts.includes(field) ||
    (invalidated.includes(field) && !facts[field])
  ) {
    return null;
  }
  return packageAmount(facts[field], packages, fallback);
}

function withheldFields(reviews) {
  return [
    ...new Set(
      reviews.flatMap((review) => [
        ...(review.invalidatedFields || []),
        ...Object.keys(review.sellerClaimsNotApplied || {}),
        ...(Array.isArray(review.conditionalManufacturerMatrix)
          ? review.conditionalManufacturerMatrix
              .filter((claim) => claim.applied === false)
              .map((claim) => claim.field)
              .filter((field) => ['netMassG', 'netVolumeMl'].includes(field))
          : []),
      ])
    ),
  ];
}

function sellingPackages(row, facts, conflicts, invalidated) {
  const declaredCount =
    facts.packagesPerSellingUnit?.value ?? row.packagesPerSellingUnit ?? 1;
  const countHeld =
    row.packagesPerSellingUnit === null ||
    row.pendingSpecificationReview?.includes('packCount') ||
    conflicts.includes('packagesPerSellingUnit') ||
    invalidated.includes('packagesPerSellingUnit');
  const packageCount =
    !countHeld && Number.isInteger(declaredCount) && declaredCount > 0
      ? declaredCount
      : null;
  const quantity = row.quantity ?? 1;
  const packages =
    packageCount && Number.isInteger(quantity) && quantity > 0
      ? packageCount * quantity
      : null;
  return { packageCount, packages };
}

export function enrichIceRow(row, reviews = []) {
  const applicable = reviews.filter((review) => review.skus?.includes(row.sku));
  const { facts, conflicts, superseded } = selectFacts(applicable);
  const invalidated = withheldFields(applicable);
  const { packageCount, packages } = sellingPackages(
    row,
    facts,
    conflicts,
    invalidated
  );
  const massG = measuredAmount(
    'netMassG',
    facts,
    conflicts,
    invalidated,
    packages,
    row.massG
  );
  const volumeMl = measuredAmount(
    'netVolumeMl',
    facts,
    conflicts,
    invalidated,
    packages,
    row.volumeMl
  );
  const { proteinG, proteinConflict, proteinBasis } = proteinAmount(
    Object.fromEntries(
      Object.entries(facts).map(([field, fact]) => [field, fact.value])
    ),
    massG,
    volumeMl,
    packages ?? Number.NaN
  );
  const deliveryUnavailable = applicable.some(
    (review) => review.deliveryUnavailable === true
  );
  const totalAfterDelivery = deliveryUnavailable
    ? null
    : row.totalAfterDelivery;
  return {
    ...row,
    packagesPerSellingUnit: packageCount,
    invalidatedSpecificationFields: [...new Set(invalidated)],
    deliveryUnavailable,
    totalAfterDelivery,
    deliveryQuoteMatched: deliveryUnavailable
      ? false
      : row.deliveryQuoteMatched,
    deliveryNote:
      applicable.find((review) => review.deliveryNote)?.deliveryNote || null,
    originalSellerName: row.originalSellerName || row.name,
    name:
      applicable.find((review) => review.productName)?.productName || row.name,
    massG: positive(massG) ? massG : null,
    volumeMl: positive(volumeMl) ? volumeMl : null,
    proteinG,
    proteinBasis,
    beforePerFoodGram: rate(row.totalBeforeDelivery, massG),
    afterPerFoodGram: rate(totalAfterDelivery, massG),
    beforePerMl: rate(row.totalBeforeDelivery, volumeMl),
    afterPerMl: rate(totalAfterDelivery, volumeMl),
    beforePerProteinGram: rate(row.totalBeforeDelivery, proteinG),
    afterPerProteinGram: rate(totalAfterDelivery, proteinG),
    strictChocolateEligible: eligibility(applicable),
    specificationFacts: facts,
    supersededSpecificationFacts: superseded,
    manufacturerIdentityMatched: applicable.some(
      (review) =>
        review.manufacturerIdentityMatched === true ||
        (review.manufacturerProductIdentity?.exactExportVariant === true &&
          review.manufacturerWrapperEvidence?.identityMatched === true)
    ),
    specificationConflicts: [
      ...new Set([...conflicts, ...(proteinConflict ? ['proteinG'] : [])]),
    ],
    research: applicable.map((review) => ({
      id: review.id,
      blockingEvidenceGaps: review.blockingEvidenceGaps || [],
      withheldSellerClaims: review.sellerClaimsNotApplied || {},
      conditionalManufacturerMatrix: review.conditionalManufacturerMatrix,
    })),
  };
}

export function rankIceRows(rows, metric) {
  if (
    ![
      'beforePerFoodGram',
      'beforePerMl',
      'beforePerProteinGram',
      'afterPerFoodGram',
      'afterPerMl',
      'afterPerProteinGram',
    ].includes(metric)
  ) {
    throw new Error(`Unsupported ice ranking metric: ${metric}`);
  }
  return rows
    .filter(
      (row) =>
        row.available !== false &&
        row.strictChocolateEligible !== false &&
        Number.isFinite(row[metric]) &&
        row[metric] >= 0
    )
    .sort((left, right) => left[metric] - right[metric]);
}
