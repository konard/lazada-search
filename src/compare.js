import { positive } from './values.js';
import { specificationProblems } from './verification.js';
import { matchesFlavourScope } from './flavour-scope.js';
import { uniqueComparisons } from './comparison-observations.js';
import { proteinAmount } from './protein-amount.js';
import { deliveryContextMatches } from './delivery-context.js';
import { accountFoodComponents } from './food-components.js';

function evidenceProblem(product, field) {
  if (product.pendingSpecificationReview?.includes(field)) {
    return `Selected package conflicts with reviewed ${field}; new evidence review required`;
  }
  if (
    product.crossChecks?.some((check) =>
      check.conflicts?.some((conflict) => conflict.field === field)
    ) &&
    !product.reviewedFields?.includes(field)
  ) {
    return `Conflicting ${field} evidence`;
  }
  const claims =
    product.claims?.filter(
      (claim) =>
        claim.field === field &&
        JSON.stringify(claim.value) === JSON.stringify(product[field])
    ) || [];
  if (claims.length && claims.every((claim) => claim.requiresReview)) {
    return `${field} needs evidence review`;
  }
  return undefined;
}

function componentProteinDensity(product, foodComponents) {
  if (!foodComponents.confirmedBonuses.length) {
    return product.proteinPer100g ?? null;
  }
  return foodComponents.totalMassG > 0 &&
    Number.isFinite(foodComponents.totalProteinG)
    ? (100 * foodComponents.totalProteinG) / foodComponents.totalMassG
    : null;
}

function paidPackageCount(product) {
  return product.packageCountUnresolved ||
    product.pendingSpecificationReview?.includes('packCount')
    ? undefined
    : product.packCount || 1;
}

export function calculateOffer(product, offer, options = {}) {
  const quantity = positive(options.quantity ?? 1, 'quantity', {
    integer: true,
  });
  const currency = options.currency || offer.currency;
  const problems = [];
  if (offer.priceInvalidated) {
    problems.push('Price source invalidated; reload the listing');
  }
  if (product.specificationsInvalidated) {
    problems.push('Specification source invalidated; reload and verify');
  }
  if (options.requireManufacturer !== false) {
    problems.push(...specificationProblems(product));
  }
  if (
    !['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
      product.category
    )
  ) {
    problems.push('Outside the supported product categories');
  }
  if (offer.currency !== currency) {
    problems.push('Different currency; no implicit exchange rate');
  }
  if (offer.available === false) {
    problems.push('Unavailable');
  }
  const quoteMatchesDestination = deliveryContextMatches(
    offer,
    options.deliveryArea
  );
  if (offer.deliveryAvailable === false && quoteMatchesDestination) {
    problems.push('The listing cannot deliver to this destination');
  }
  if (offer.variantConfirmed !== true) {
    problems.push('Variant price needs confirmation');
  }
  if (!(offer.price > 0)) {
    problems.push('Unknown price');
  }
  if (!(product.netMassG > 0)) {
    problems.push('Unknown net mass');
  }
  if (product.packageCountUnresolved) {
    problems.push(
      'The selling unit has no confirmed count of inner food packages'
    );
  }
  for (const field of [
    'packCount',
    'netMassG',
    'netVolumeMl',
    'proteinPer100g',
    'proteinPer100ml',
    'proteinPerPackageG',
  ]) {
    const problem = evidenceProblem(product, field);
    if (problem) {
      problems.push(problem);
    }
  }
  if (offer.minQuantity && quantity < offer.minQuantity) {
    problems.push('Below minimum order quantity');
  }
  if (
    (offer.maxQuantity !== undefined && quantity > offer.maxQuantity) ||
    (offer.stock !== undefined && quantity > offer.stock)
  ) {
    problems.push('Quantity exceeds available offer');
  }
  if (
    product.category === 'chocolate-ice-cream' &&
    offer.coldChainConfirmed !== true
  ) {
    problems.push('Frozen delivery needs confirmation');
  }
  if (!quoteMatchesDestination) {
    problems.push('Delivery price not confirmed for this area');
  }
  const quoteMatchesQuantity =
    offer.shippingQuantity === undefined || offer.shippingQuantity === quantity;
  const shipping =
    options.shipping ??
    (quoteMatchesDestination &&
    quoteMatchesQuantity &&
    !offer.shippingInvalidated
      ? offer.shipping
      : undefined);
  if (!quoteMatchesQuantity && options.shipping === undefined) {
    problems.push(
      `Shipping quoted for ${offer.shippingQuantity} packages, not ${quantity}`
    );
  }
  const shippingKnown = Number.isFinite(shipping) && shipping >= 0;
  if (!shippingKnown && options.requireShipping !== false) {
    problems.push('Unknown shipping');
  }
  if (options.shipping !== undefined) {
    positive(options.shipping, 'shipping', { zero: true });
  }
  const now = options.now ?? Date.now();
  const priceAgeMs = now - Date.parse(offer.observedAt);
  if (priceAgeMs < 0 || !Number.isFinite(priceAgeMs)) {
    problems.push('Invalid price timestamp');
  }
  if (
    priceAgeMs > (options.maxPriceAgeMs ?? 86400000) &&
    options.allowStale !== true
  ) {
    problems.push('Stale price');
  }
  let unitPrice = offer.price;
  for (const tier of [...(offer.bulkTiers || [])].sort(
    (a, b) => a.minQuantity - b.minQuantity
  )) {
    if (quantity >= tier.minQuantity) {
      unitPrice = tier.unitPrice;
    }
  }
  // Coupon/discount is a confirmed fixed order amount, never multiplied by units.
  const discount = options.discount ?? offer.discount ?? 0;
  positive(discount, 'discount', { zero: true });
  const totalCost = Math.max(
    0,
    unitPrice * quantity + (shippingKnown ? shipping : 0) - discount
  );
  if (discount > unitPrice * quantity + (shippingKnown ? shipping : 0)) {
    problems.push('Discount exceeds the confirmed order cost');
  }
  const packages = paidPackageCount(product);
  let totalMassG = product.pendingSpecificationReview?.includes('netMassG')
    ? undefined
    : product.netMassG * packages * quantity;
  let totalVolumeMl = product.pendingSpecificationReview?.includes(
    'netVolumeMl'
  )
    ? undefined
    : product.netVolumeMl * packages * quantity;
  const proteinFields = Object.fromEntries(
    ['proteinPer100g', 'proteinPer100ml', 'proteinPerPackageG'].map((field) => [
      field,
      evidenceProblem(product, field) ? undefined : product[field],
    ])
  );
  let {
    proteinG: totalProteinG,
    proteinBasis,
    proteinConflict,
  } = proteinAmount(
    proteinFields,
    evidenceProblem(product, 'netMassG') ? undefined : totalMassG,
    evidenceProblem(product, 'netVolumeMl') ? undefined : totalVolumeMl,
    packages * quantity
  );
  const foodComponents = accountFoodComponents(
    product,
    offer,
    { ...options, quantity, now },
    { totalMassG, totalVolumeMl, totalProteinG }
  );
  ({ totalMassG, totalVolumeMl, totalProteinG } = foodComponents);
  proteinConflict = [proteinConflict, foodComponents.proteinConflict].includes(
    true
  );
  if (foodComponents.confirmedBonuses.length) {
    proteinBasis = totalProteinG === null ? null : 'components';
  }
  problems.push(...foodComponents.problems);
  if (proteinConflict) {
    problems.push(
      'Conflicting protein amounts across declared nutrition bases'
    );
  } else if (!(totalProteinG > 0)) {
    problems.push('Unknown protein density');
  }
  const merchandiseSubtotal = unitPrice * quantity;
  // The fixed order discount is subtracted once. Unknown delivery stays null.
  const totalBeforeDelivery = Math.max(0, merchandiseSubtotal - discount);
  const totalAfterDelivery = shippingKnown ? totalCost : null;
  const unitCost = (total, amount, scale = 1) =>
    total !== null && Number.isFinite(total) && amount > 0
      ? (scale * total) / amount
      : null;
  const nutritionRatio = (denominator, scale) => {
    if (foodComponents.confirmedBonuses.length) {
      // Mixed-component sugar/energy ratios need independently sourced
      // amounts for every food. Retaining the paid-only ratio is misleading.
      return null;
    }
    for (const basis of ['100g', '100ml']) {
      const numerator = product[`proteinPer${basis}`];
      const value = product[`${denominator}Per${basis}`];
      if (
        !proteinConflict &&
        !evidenceProblem(product, `proteinPer${basis}`) &&
        !evidenceProblem(product, `${denominator}Per${basis}`) &&
        Number.isFinite(numerator) &&
        numerator > 0 &&
        Number.isFinite(value) &&
        value >= 0
      ) {
        return denominator === 'kcal'
          ? value > 0
            ? (scale * numerator) / value
            : null
          : (scale * value) / numerator;
      }
    }
    return null;
  };
  const metrics = {
    quantity,
    currency,
    unitPrice,
    shipping: shippingKnown ? shipping : null,
    discount,
    merchandiseSubtotal: Number.isFinite(merchandiseSubtotal)
      ? merchandiseSubtotal
      : null,
    totalBeforeDelivery: Number.isFinite(totalBeforeDelivery)
      ? totalBeforeDelivery
      : null,
    totalAfterDelivery: Number.isFinite(totalAfterDelivery)
      ? totalAfterDelivery
      : null,
    totalCost: Number.isFinite(totalCost) ? totalCost : null,
    totalMassG: Number.isFinite(totalMassG) ? totalMassG : null,
    totalVolumeMl: Number.isFinite(totalVolumeMl) ? totalVolumeMl : null,
    totalProteinG: Number.isFinite(totalProteinG) ? totalProteinG : null,
    foodComponents,
    proteinBasis,
    proteinConflict,
    costPerGramBeforeDelivery: unitCost(totalBeforeDelivery, totalMassG),
    costPerGramAfterDelivery: unitCost(totalAfterDelivery, totalMassG),
    costPerMlBeforeDelivery: unitCost(totalBeforeDelivery, totalVolumeMl),
    costPerMlAfterDelivery: unitCost(totalAfterDelivery, totalVolumeMl),
    costPerProteinGramBeforeDelivery: unitCost(
      totalBeforeDelivery,
      totalProteinG
    ),
    costPerProteinGramAfterDelivery: unitCost(
      totalAfterDelivery,
      totalProteinG
    ),
    costPer25gProteinBeforeDelivery: unitCost(
      totalBeforeDelivery,
      totalProteinG,
      25
    ),
    costPer25gProteinAfterDelivery: unitCost(
      totalAfterDelivery,
      totalProteinG,
      25
    ),
    costPerKgBeforeDelivery: unitCost(totalBeforeDelivery, totalMassG, 1000),
    costPerKgAfterDelivery: unitCost(totalAfterDelivery, totalMassG, 1000),
    costPerProteinG: totalProteinG > 0 ? totalCost / totalProteinG : null,
    costPer25gProtein:
      totalProteinG > 0 ? (25 * totalCost) / totalProteinG : null,
    costPerKg: totalMassG > 0 ? (1000 * totalCost) / totalMassG : null,
    proteinPer100g: componentProteinDensity(product, foodComponents),
    proteinPer100kcal: nutritionRatio('kcal', 100),
    sugarPer25gProtein: nutritionRatio('sugar', 25),
    priceAgeMs,
    shippingKnown,
    shippingQuantity: offer.shippingQuantity ?? null,
    shippingDestination: offer.shippingDestination ?? null,
  };
  return {
    product,
    offer,
    metrics,
    manufacturerVerified:
      specificationProblems(product).length === 0 &&
      foodComponents.confirmedBonuses.every(
        (bonus) => bonus.manufacturerVerified
      ),
    eligible: problems.length === 0,
    problems,
  };
}

export function compareOffers(products, offers, options = {}) {
  if (
    options.flavourScope &&
    !['all', 'chocolate-or-unflavoured'].includes(options.flavourScope)
  ) {
    throw new Error('Unsupported flavour scope');
  }
  const currency = options.currency || offers[0]?.currency;
  for (const field of ['minProtein', 'maxSugar', 'maxPriceAgeMs']) {
    if (options[field] !== undefined) {
      positive(options[field], field, { zero: true });
    }
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  const observations = [];
  for (const offer of offers) {
    const product = byId.get(offer.productId);
    if (
      !product ||
      !matchesFlavourScope(product, options.flavourScope) ||
      (options.category && product.category !== options.category) ||
      (options.proteinType && product.proteinType !== options.proteinType)
    ) {
      continue;
    }
    if (options.proteinType && evidenceProblem(product, 'ingredients')) {
      continue;
    }
    if (
      options.minProtein !== undefined &&
      !(product.proteinPer100g >= options.minProtein)
    ) {
      continue;
    }
    if (
      options.maxSugar !== undefined &&
      !(product.sugarPer100g <= options.maxSugar)
    ) {
      continue;
    }
    if (
      options.excludeIngredients?.some((ingredient) =>
        product.ingredients?.some((value) =>
          value.toLowerCase().includes(ingredient.toLowerCase())
        )
      )
    ) {
      continue;
    }
    if (options.excludeIngredients?.length && !product.ingredients?.length) {
      continue;
    }
    observations.push(calculateOffer(product, offer, { ...options, currency }));
  }
  const { comparisons: results, duplicateObservations } =
    uniqueComparisons(observations);
  const sort = options.sort || 'costPerProteinG';
  if (
    ![
      'costPerProteinG',
      'costPerKg',
      'totalCost',
      'proteinPer100g',
      'totalBeforeDelivery',
      'totalAfterDelivery',
      'costPerGramBeforeDelivery',
      'costPerGramAfterDelivery',
      'costPerMlBeforeDelivery',
      'costPerMlAfterDelivery',
      'costPerProteinGramBeforeDelivery',
      'costPerProteinGramAfterDelivery',
      'costPer25gProteinBeforeDelivery',
      'costPer25gProteinAfterDelivery',
      'costPerKgBeforeDelivery',
      'costPerKgAfterDelivery',
    ].includes(sort)
  ) {
    throw new Error('Unsupported comparison sort');
  }
  results.sort(
    (left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      (sort === 'proteinPer100g'
        ? (right.metrics[sort] ?? -Infinity) - (left.metrics[sort] ?? -Infinity)
        : (left.metrics[sort] ?? Infinity) -
          (right.metrics[sort] ?? Infinity)) ||
      left.offer.id.localeCompare(right.offer.id)
  );
  // Captured prices remain sortable while exact nutrition or delivery is
  // pending. These observations do not acquire purchase eligibility.
  const observedPrices = results.filter(
    (row) =>
      row.offer.variantConfirmed === true &&
      ['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
        row.product.category
      ) &&
      !row.offer.priceInvalidated &&
      (!row.product.specificationsInvalidated ||
        ['totalBeforeDelivery', 'totalAfterDelivery', 'totalCost'].includes(
          sort
        )) &&
      row.offer.price > 0 &&
      Number.isFinite(row.metrics[sort])
  );
  observedPrices.sort(
    (left, right) =>
      (sort === 'proteinPer100g'
        ? right.metrics[sort] - left.metrics[sort]
        : left.metrics[sort] - right.metrics[sort]) ||
      left.offer.id.localeCompare(right.offer.id)
  );
  return {
    comparisons: results,
    duplicateObservations,
    observedPrices,
    unsortable: results.filter((row) => !observedPrices.includes(row)),
    ranked: results.filter((result) => result.eligible),
    excluded: results.filter((result) => !result.eligible),
    bestByCategory: Object.fromEntries(
      ['whey', 'protein-powder', 'chocolate-ice-cream'].map((category) => [
        category,
        results.find(
          (result) => result.eligible && result.product.category === category
        ) || null,
      ])
    ),
    assumptions: {
      quantity: options.quantity ?? 1,
      currency: currency || null,
      shippingOverride: options.shipping ?? null,
      deliveryArea: options.deliveryArea || null,
      requireShipping: options.requireShipping !== false,
      requireManufacturer: options.requireManufacturer !== false,
      sort,
      flavourScope: options.flavourScope || 'all',
      discountScope:
        'Fixed amount per order, subtracted once; no assumed volume-to-mass conversion',
    },
    calculatedAt: new Date(options.now ?? Date.now()).toISOString(),
  };
}
