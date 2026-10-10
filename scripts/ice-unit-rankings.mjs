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
    'seller-promotional-panel': 1,
  })[fact.sourceAuthority] || 0;

function selectFacts(applicable) {
  const facts = {};
  const conflicts = [];
  const superseded = [];
  for (const review of applicable) {
    for (const [field, fact] of Object.entries(review.facts || {})) {
      if (!acceptedFact(field, fact)) {
        continue;
      }
      if (facts[field] && authority(fact) > authority(facts[field])) {
        superseded.push({ field, fact: facts[field] });
        facts[field] = fact;
      } else if (facts[field] && authority(fact) < authority(facts[field])) {
        superseded.push({ field, fact });
      } else if (
        facts[field] &&
        JSON.stringify(facts[field].value) !== JSON.stringify(fact.value)
      ) {
        conflicts.push(field);
      } else {
        facts[field] = fact;
      }
    }
  }
  for (const field of conflicts) {
    delete facts[field];
  }
  return { facts, conflicts, superseded };
}

function proteinAmount(facts, massG, volumeMl, packages) {
  const proteinCandidates = [
    ['package', facts.proteinPerPackageG?.value * packages],
    ['100g', (facts.proteinPer100g?.value * massG) / 100],
    ['100ml', (facts.proteinPer100ml?.value * volumeMl) / 100],
  ].filter(([, value]) => Number.isFinite(value) && value >= 0);
  // Printed nutrition bases must agree within their rounding tolerance.
  const proteinConflict = proteinCandidates.some(
    ([, value]) =>
      Math.abs(value - proteinCandidates[0][1]) >
      Math.max(0.05 * packages, 0.02 * proteinCandidates[0][1])
  );
  const proteinG =
    proteinConflict || !proteinCandidates.length
      ? null
      : proteinCandidates[0][1];
  return {
    proteinG,
    proteinConflict,
    proteinBasis: proteinG !== null ? proteinCandidates[0][0] : null,
  };
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

export function enrichIceRow(row, reviews = []) {
  const applicable = reviews.filter((review) => review.skus?.includes(row.sku));
  const { facts, conflicts, superseded } = selectFacts(applicable);
  const packages = (row.packagesPerSellingUnit || 1) * (row.quantity || 1);
  const massG = packageAmount(facts.netMassG, packages, row.massG);
  const volumeMl = packageAmount(facts.netVolumeMl, packages, row.volumeMl);
  const { proteinG, proteinConflict, proteinBasis } = proteinAmount(
    facts,
    massG,
    volumeMl,
    packages
  );
  return {
    ...row,
    originalSellerName: row.originalSellerName || row.name,
    name:
      applicable.find((review) => review.productName)?.productName || row.name,
    massG: positive(massG) ? massG : null,
    volumeMl: positive(volumeMl) ? volumeMl : null,
    proteinG,
    proteinBasis,
    beforePerFoodGram: rate(row.totalBeforeDelivery, massG),
    afterPerFoodGram: rate(row.totalAfterDelivery, massG),
    beforePerMl: rate(row.totalBeforeDelivery, volumeMl),
    afterPerMl: rate(row.totalAfterDelivery, volumeMl),
    beforePerProteinGram: rate(row.totalBeforeDelivery, proteinG),
    afterPerProteinGram: rate(row.totalAfterDelivery, proteinG),
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
