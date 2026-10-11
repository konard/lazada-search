import { fold } from './text.js';
import { positive } from './values.js';
import { productFlavour, matchesFlavourScope } from './flavour-scope.js';
import { specificationProblems } from './verification.js';
import { proteinAmount } from './protein-amount.js';

const IDENTITIES = [
  'brand',
  'name',
  'flavour',
  'market',
  'packageType',
  'formulaRevision',
];
const QUANTITIES = ['netMassG', 'netVolumeMl'];
const NUTRIENTS = ['proteinPer100g', 'proteinPer100ml', 'proteinPerPackageG'];
const COUNT_FIELDS = {
  orderQuantity: 'paid-selling-unit',
  minOrderQuantity: 'paid-selling-unit',
  maxOrderQuantity: 'paid-selling-unit',
  units: 'inner-food-package',
  stockUnits: 'inner-food-package',
  maxUnitsPerOrder: 'inner-food-package',
};
const FACT_TYPES = {
  netMassG: {
    unit: 'g',
    basis: 'one-inner-food-package',
    sourceUnits: ['g', 'kg'],
  },
  netVolumeMl: {
    unit: 'ml',
    basis: 'one-inner-food-package',
    sourceUnits: ['ml', 'L'],
  },
  proteinPer100g: {
    unit: 'g/100g',
    basis: 'per-100g',
    sourceUnits: ['g'],
    basisPattern: /\bper\s*100\s*g\b/u,
  },
  proteinPer100ml: {
    unit: 'g/100ml',
    basis: 'per-100ml',
    sourceUnits: ['g'],
    basisPattern: /\bper\s*100\s*ml\b/u,
  },
  proteinPerPackageG: {
    unit: 'g/package',
    basis: 'one-inner-food-package',
    sourceUnits: ['g'],
    basisPattern:
      /\bper\s+(?:(?:one|1|whole|entire)\s+)?(?:package|bottle|bag|pint|tub|container)\b/u,
  },
};

function reviewedSource(source, evidenceIds) {
  try {
    const url = new URL(source?.sourceUrl);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /^[a-f\d]{64}$/u.test(source.sourceSha256 || '') &&
      source.excerpt?.trim() &&
      source.reviewedBy?.trim() &&
      Number.isFinite(Date.parse(source.reviewedAt)) &&
      source.invalidated !== true &&
      evidenceIds?.includes(source.evidenceId)
    );
  } catch {
    return false;
  }
}

function valueMetadataMatches(fact, value, unit, basis, evidenceIds) {
  return Boolean(
    reviewedSource(fact, evidenceIds) &&
    fact.value === value &&
    fact.unit === unit &&
    fact.basis === basis &&
    fact.valueExcerpt?.trim() &&
    fold(fact.excerpt).includes(fold(fact.valueExcerpt))
  );
}

function sourcedValue(fact, value, unit, basis, evidenceIds) {
  if (!valueMetadataMatches(fact, value, unit, basis, evidenceIds)) {
    return false;
  }
  const numbers = fact.valueExcerpt.match(/\d+(?:[.,]\d+)?/gu) || [];
  if (
    unit === 'count' &&
    ((fact.sourceUnit && fact.sourceUnit !== 'count') ||
      /\d\s*(?:g|kg|mg|ml|l)\b/iu.test(fact.valueExcerpt))
  ) {
    return false;
  }
  const originalValue = fact.sourceValue ?? value;
  const multiplier =
    { 'g:kg': 1000, 'ml:L': 1000 }[`${unit}:${fact.sourceUnit}`] ?? 1;
  return (
    numbers.length === 1 &&
    Number(numbers[0].replace(',', '.')) === originalValue &&
    originalValue * multiplier === value
  );
}

function identityReviewMatches(component) {
  const left = component.identity;
  const right = component.sourceIdentity;
  if (
    component.review?.identityMatched !== true ||
    !reviewedSource(component.review, component.evidenceIds) ||
    !left ||
    !right ||
    IDENTITIES.some(
      (field) =>
        typeof left[field] !== 'string' ||
        !fold(left[field]) ||
        fold(left[field]) !== fold(right[field])
    )
  ) {
    return false;
  }
  return (
    ['gtin', 'variantCode'].some(
      (field) =>
        left[field] && right[field] && fold(left[field]) === fold(right[field])
    ) &&
    !['gtin', 'variantCode', ...QUANTITIES].some(
      (field) =>
        left[field] !== undefined &&
        right[field] !== undefined &&
        String(left[field]) !== String(right[field])
    )
  );
}

function exactIdentity(component, product, offer, options) {
  if (!identityReviewMatches(component)) {
    return false;
  }
  const left = component.identity;
  const right = component.sourceIdentity;
  const market = options.market || offer.market || product.market;
  return Boolean(
    market &&
    fold(left.market) === fold(market) &&
    left.innerPackCount === 1 &&
    right.innerPackCount === 1 &&
    [left.currentFormula, right.currentFormula].every(
      (value) => value === true
    ) &&
    component.product?.packCount === 1 &&
    component.product.category === product.category &&
    fold(component.product.brand) === fold(left.brand) &&
    productFlavour(component.product) ===
      productFlavour({ category: product.category, title: left.flavour }) &&
    matchesFlavourScope(
      component.product,
      options.flavourScope || 'chocolate-or-unflavoured'
    )
  );
}

function eligibilityContextMatches(component, offer, options) {
  const eligible = component.eligibility;
  const age = options.now - Date.parse(eligible?.observedAt);
  if (
    !eligible ||
    ![
      'confirmed',
      'available',
      'conditionsComplete',
      'conditionsSatisfied',
    ].every((field) => eligible[field] === true) ||
    !eligible.allocationId?.trim() ||
    eligible.offerId !== offer.id ||
    !offer.sku ||
    String(eligible.sku) !== String(offer.sku) ||
    offer.variantConfirmed !== true ||
    offer.available === false ||
    offer.priceInvalidated ||
    eligible.orderQuantity !== options.quantity ||
    !currentEligibilityAge(age, options.maxPromotionAgeMs)
  ) {
    return false;
  }
  return true;
}

function currentEligibilityAge(age, maxAge = 86400000) {
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}

function confirmedEligibility(component, offer, options) {
  if (!eligibilityContextMatches(component, offer, options)) {
    return false;
  }
  const eligible = component.eligibility;
  if (
    Object.entries(COUNT_FIELDS).some(
      ([field, basis]) =>
        !Number.isSafeInteger(eligible[field]) ||
        eligible[field] < 1 ||
        !sourcedValue(
          eligible.claims?.[field],
          eligible[field],
          'count',
          basis,
          component.evidenceIds
        )
    )
  ) {
    return false;
  }
  return (
    eligible.minOrderQuantity <= eligible.orderQuantity &&
    eligible.orderQuantity <= eligible.maxOrderQuantity &&
    eligible.units <= eligible.stockUnits &&
    eligible.units <= eligible.maxUnitsPerOrder &&
    (offer.minQuantity === undefined ||
      options.quantity >= offer.minQuantity) &&
    (offer.maxQuantity === undefined ||
      options.quantity <= offer.maxQuantity) &&
    (offer.stock === undefined || options.quantity <= offer.stock)
  );
}

function unreviewedField(product, field) {
  const claims =
    product?.claims?.filter(
      (claim) =>
        claim.field === field &&
        JSON.stringify(claim.value) === JSON.stringify(product[field])
    ) || [];
  return claims.length > 0 && claims.every((claim) => claim.requiresReview);
}

function held(component, field) {
  const product = component.product;
  return (
    product?.specificationsInvalidated ||
    product?.packageCountUnresolved ||
    product?.pendingSpecificationReview?.includes(field) ||
    (product?.crossChecks?.some((check) =>
      check.conflicts?.some((conflict) => conflict.field === field)
    ) &&
      !product.reviewedFields?.includes(field)) ||
    unreviewedField(product, field)
  );
}

function componentAmount(component, field) {
  const product = component.product;
  const value = product?.[field];
  if (!Number.isFinite(value) || value < 0 || held(component, field)) {
    return undefined;
  }
  const type = FACT_TYPES[field];
  if (
    !sourcedValue(
      component.facts?.[field],
      value,
      type.unit,
      type.basis,
      component.evidenceIds
    )
  ) {
    return undefined;
  }
  if (!sourceBasisMatches(component.facts[field], field)) {
    return undefined;
  }
  if (
    QUANTITIES.includes(field) &&
    (value <= 0 ||
      component.identity?.[field] !== value ||
      component.sourceIdentity?.[field] !== value)
  ) {
    return undefined;
  }
  return value;
}

function originalPhysicalUnitMatches(fact, type) {
  const sourceUnit = fact.sourceUnit || type.sourceUnits[0];
  const context = fold(fact.unitExcerpt || fact.valueExcerpt);
  if (
    !type.sourceUnits.includes(sourceUnit) ||
    !context ||
    !fold(fact.excerpt).includes(context) ||
    !context.includes(fold(fact.valueExcerpt))
  ) {
    return false;
  }
  const pairs = context.matchAll(
    /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(mg|kg|g|ml|l)\b/gu
  );
  return [...pairs].some(
    (pair) =>
      Number(pair[1].replace(',', '.')) === (fact.sourceValue ?? fact.value) &&
      pair[2] === sourceUnit.toLowerCase()
  );
}

function sourceBasisMatches(fact, field) {
  const type = FACT_TYPES[field];
  if (!originalPhysicalUnitMatches(fact, type)) {
    return false;
  }
  if (!type.basisPattern) {
    return true;
  }
  const basis = fold(fact.basisExcerpt || '');
  return Boolean(
    basis &&
    fold(fact.excerpt).includes(basis) &&
    type.basisPattern.test(basis) &&
    !(
      field === 'proteinPerPackageG' &&
      /servings?\s+per\s+|per\s*(?:100\s*(?:g|ml)|serving)/u.test(
        fold(fact.excerpt)
      )
    )
  );
}

function confirmedBonus(component, product, offer, options) {
  const reasons = [];
  if (!exactIdentity(component, product, offer, options)) {
    reasons.push(
      'Exact bonus identity, market or requested flavour unconfirmed'
    );
  }
  if (!confirmedEligibility(component, offer, options)) {
    reasons.push(
      'Bonus eligibility, exact order quantity or stock unconfirmed'
    );
  }
  const manufacturerVerified =
    component.product && specificationProblems(component.product).length === 0;
  if (options.requireManufacturer !== false && !manufacturerVerified) {
    reasons.push('Exact bonus manufacturer specifications unconfirmed');
  }
  const mass = componentAmount(component, 'netMassG');
  const volume = componentAmount(component, 'netVolumeMl');
  if (!(mass > 0) && !(volume > 0)) {
    reasons.push('Bonus food package quantities unknown or held for review');
  }
  if (reasons.length) {
    return {
      id: component.id,
      kind: component.kind,
      status: 'potential',
      reasons,
    };
  }
  const units = component.eligibility.units;
  const protein = proteinAmount(
    Object.fromEntries(
      NUTRIENTS.map((field) => [field, componentAmount(component, field)])
    ),
    mass * units,
    volume * units,
    units
  );
  return {
    id: component.id,
    kind: component.kind,
    status: 'confirmed',
    allocationId: component.eligibility.allocationId,
    units,
    manufacturerVerified: Boolean(manufacturerVerified),
    totalMassG: Number.isFinite(mass) ? mass * units : null,
    totalVolumeMl: Number.isFinite(volume) ? volume * units : null,
    totalProteinG: protein.proteinG,
    proteinConflict: protein.proteinConflict,
    evidenceIds: [...component.evidenceIds],
  };
}

function uniqueComponents(components) {
  if (!Array.isArray(components) || components.length > 100) {
    throw new TypeError(
      'foodComponents must contain at most100 component records'
    );
  }
  const records = new Map();
  for (const component of components) {
    const id = component?.id;
    const known = records.get(id);
    if (!known) {
      records.set(id, { component });
    } else if (JSON.stringify(known.component) !== JSON.stringify(component)) {
      known.conflict = true;
    }
  }
  return [...records.values()];
}

function conflictingAllocations(records) {
  const allocations = new Map();
  for (const { component } of records) {
    if (
      component?.kind !== 'bonus-food' ||
      !component.eligibility?.allocationId
    ) {
      continue;
    }
    const key = component.eligibility.allocationId;
    allocations.set(key, (allocations.get(key) || 0) + 1);
  }
  return new Set(
    [...allocations].filter(([, count]) => count > 1).map(([id]) => id)
  );
}

function combinedAmount(paid, bonuses, field) {
  if (!Number.isFinite(paid) || paid < 0) {
    return null;
  }
  return bonuses.every((bonus) => Number.isFinite(bonus[field]))
    ? paid + bonuses.reduce((total, bonus) => total + bonus[field], 0)
    : null;
}

function invalidComponentRecord(record, allocations) {
  return (
    !record.component?.id ||
    record.conflict ||
    allocations.has(record.component.eligibility?.allocationId)
  );
}

function accountComponent(record, state) {
  const { component } = record;
  const {
    product,
    offer,
    context,
    confirmed,
    potential,
    accessories,
    paidMetadata,
    problems,
    allocations,
  } = state;
  if (invalidComponentRecord(record, allocations)) {
    potential.push({
      id: component?.id ?? null,
      status: 'potential',
      reasons: ['Missing or conflicting component identity'],
    });
    if (component?.kind === 'paid-food') {
      problems.push(
        'Paid food components conflict with the selected selling unit'
      );
    }
    return;
  }
  switch (component.kind) {
    case 'non-food':
      accessories.push({
        id: component.id,
        name: component.name || null,
        counted: false,
      });
      break;
    case 'paid-food':
      paidMetadata.push(component.id);
      if (
        component.productId !== product.id ||
        component.unitsPerSellingUnit !== (product.packCount || 1)
      ) {
        problems.push(
          'Paid food components conflict with the selected selling unit'
        );
      }
      break;
    case 'bonus-food': {
      const result = confirmedBonus(component, product, offer, context);
      (result.status === 'confirmed' ? confirmed : potential).push(result);
      break;
    }
    default:
      potential.push({
        id: component.id,
        status: 'potential',
        reasons: ['Unsupported food component kind'],
      });
  }
}

// Paid amounts are computed by the existing selected selling-unit path.
// Explicit paid metadata never adds that same multipack a second time.
export function accountFoodComponents(product, offer, options = {}, paid = {}) {
  const quantity = positive(options.quantity ?? 1, 'quantity', {
    integer: true,
  });
  const context = { ...options, quantity, now: options.now ?? Date.now() };
  const confirmed = [],
    potential = [],
    accessories = [],
    paidMetadata = [],
    problems = [];
  const records = uniqueComponents(offer.foodComponents || []);
  const allocations = conflictingAllocations(records);
  const state = {
    product,
    offer,
    context,
    confirmed,
    potential,
    accessories,
    paidMetadata,
    problems,
    allocations,
  };
  for (const record of records) {
    accountComponent(record, state);
  }
  const totals = Object.fromEntries(
    ['totalMassG', 'totalVolumeMl', 'totalProteinG'].map((field) => [
      field,
      problems.length ? null : combinedAmount(paid[field], confirmed, field),
    ])
  );
  return {
    ...totals,
    paidFood: {
      productId: product.id,
      units: product.packageCountUnresolved
        ? null
        : (product.packCount || 1) * quantity,
      ...paid,
      metadataIds: paidMetadata,
    },
    confirmedBonuses: confirmed,
    potentialBonuses: potential,
    nonFoodAccessories: accessories,
    completeOffer: potential.length === 0 && problems.length === 0,
    problems,
    proteinConflict: confirmed.some((bonus) => bonus.proteinConflict),
  };
}
