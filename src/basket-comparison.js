import { calculateOffer, compareOffers } from './compare.js';
import { comparisonInputs } from './comparison-inputs.js';
import { basketIdentity, extractBasketQuote } from './basket-quote.js';
import { deliveryContextMatches } from './delivery-context.js';
import { positive } from './values.js';
import { applyBasketComparisonTranslations } from './translation-presentation.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonical(item)])
        )
      : value;
const deliveryProblems = new Set([
  'Unknown shipping',
  'Delivery price not confirmed for this area',
  'Frozen delivery needs confirmation',
  'The listing cannot deliver to this destination',
]);
const rankingFields = [
  'costPerGramBeforeDelivery',
  'costPerGramAfterDelivery',
  'costPerMlBeforeDelivery',
  'costPerMlAfterDelivery',
  'costPerProteinGramBeforeDelivery',
  'costPerProteinGramAfterDelivery',
  'totalBeforeDelivery',
  'totalAfterDelivery',
];
const amount = (rows, field) =>
  rows.every((row) => row.metrics[field] > 0)
    ? rows.reduce((sum, row) => sum + row.metrics[field], 0)
    : null;
const rate = (total, denominator) =>
  denominator > 0 ? total / denominator : null;

async function originalQuote(application, saved, options) {
  const evidence = await application.store.get('evidence', saved.evidenceId);
  if (
    !evidence?.html ||
    evidence.invalidatedAt ||
    evidence.html.sha256 !== saved.sourceSha256 ||
    (application.store.visibility === 'public' &&
      evidence.visibility === 'private')
  ) {
    throw new Error(
      'Basket original source is missing, private or invalidated'
    );
  }
  const invalidation = await application.store.get(
    'invalidation',
    saved.sourceUrl
  );
  if (
    invalidation &&
    Date.parse(invalidation.invalidatedAt) >= Date.parse(saved.observedAt)
  ) {
    throw new Error('Basket source was invalidated after its observation');
  }
  if (
    evidence.sourceUrl !== saved.sourceUrl ||
    evidence.observedAt !== saved.observedAt
  ) {
    throw new Error('Basket evidence URL or observation date mismatch');
  }
  const quote = extractBasketQuote(
    await application.store.blob(saved.sourceSha256),
    saved.sourceMapping
  );
  const stored = Object.fromEntries(
    Object.entries(saved).filter(([key]) => key !== 'visibility')
  );
  if (JSON.stringify(canonical(quote)) !== JSON.stringify(canonical(stored))) {
    throw new Error('Basket quote no longer agrees with its original source');
  }
  if (
    quote.basketIdentity !== basketIdentity(quote.lines) ||
    !deliveryContextMatches(
      quote,
      options.deliveryArea || application.deliveryArea
    )
  ) {
    throw new Error(
      'Basket quote does not cover the exact requested destination and quantities'
    );
  }
  return quote;
}

function compareLine(line, quote, context) {
  const { products, offers, application, options } = context;
  const offer = offers.get(line.offerId);
  const product = offer && products.get(offer.productId);
  if (
    !offer ||
    !product ||
    offer.sku !== line.sku ||
    offer.currency !== quote.currency ||
    offer.priceInvalidated ||
    offer.supersededBy
  ) {
    return { problems: [`Basket selected offer unavailable: ${line.offerId}`] };
  }
  const pricedOffer = {
    ...offer,
    price: line.unitPrice,
    bulkTiers: [],
    discount: 0,
    observedAt: quote.observedAt,
    evidenceId: quote.evidenceId,
    quoteEvidenceId: quote.evidenceId,
    quoteObservedAt: quote.observedAt,
    priceScope: 'exact-checkout-line',
    shipping: undefined,
    shippingQuantity: undefined,
    deliveryArea: quote.deliveryArea,
    shippingDestination: quote.shippingDestination,
    deliveryAvailable: undefined,
    coldChainConfirmed: quote.coldChainConfirmed,
  };
  const lineOptions = {
    ...options,
    quantity: line.quantity,
    discount: 0,
    shipping: undefined,
    requireShipping: false,
    currency: quote.currency,
    deliveryArea: quote.deliveryArea,
    market: application.market,
    flavourScope: options.flavourScope || application.flavourScope,
    sort: 'costPerProteinG',
  };
  const result = calculateOffer(product, pricedOffer, lineOptions);
  const problems = result.problems.filter(
    (problem) =>
      !deliveryProblems.has(problem) &&
      !problem.startsWith('Shipping quoted for ')
  );
  if (
    !compareOffers([product], [pricedOffer], lineOptions).comparisons.length
  ) {
    problems.push(
      'Basket line does not meet the requested product or nutrition filters'
    );
  }
  if (product.category === 'chocolate-ice-cream' && !quote.coldChainConfirmed) {
    problems.push('Basket frozen delivery needs source confirmation');
  }
  return { result, problems };
}

function basketMetrics(quote, lines, options) {
  const allocations = lines.flatMap((line) =>
    line.metrics.foodComponents.confirmedBonuses.map(
      (bonus) => bonus.allocationId
    )
  );
  const repeatedAllocation = new Set(allocations).size !== allocations.length;
  const problems = repeatedAllocation
    ? ['Basket food gift allocation is counted on multiple lines']
    : [];
  const complete = !repeatedAllocation && lines.length === quote.lines.length;
  const totalMassG = complete ? amount(lines, 'totalMassG') : null;
  const totalVolumeMl = complete ? amount(lines, 'totalVolumeMl') : null;
  const totalProteinG = complete ? amount(lines, 'totalProteinG') : null;
  for (const [option, value] of [
    ['minMassG', totalMassG],
    ['minVolumeMl', totalVolumeMl],
    ['minProteinG', totalProteinG],
  ]) {
    if (options[option] !== undefined && !(value >= options[option])) {
      problems.push(`Basket does not meet ${option}`);
    }
  }
  const totalBeforeDelivery =
    quote.merchandiseSubtotal -
    quote.appliedDiscounts
      .filter((item) => item.scope !== 'shipping')
      .reduce((sum, item) => sum + item.amount, 0);
  return {
    problems,
    metrics: {
      totalMassG,
      totalVolumeMl,
      totalProteinG,
      totalBeforeDelivery,
      totalAfterDelivery: quote.total,
      shipping: quote.shipping,
      appliedDiscount: quote.discount,
      costPerGramBeforeDelivery: rate(totalBeforeDelivery, totalMassG),
      costPerGramAfterDelivery: rate(quote.total, totalMassG),
      costPerMlBeforeDelivery: rate(totalBeforeDelivery, totalVolumeMl),
      costPerMlAfterDelivery: rate(quote.total, totalVolumeMl),
      costPerProteinGramBeforeDelivery: rate(
        totalBeforeDelivery,
        totalProteinG
      ),
      costPerProteinGramAfterDelivery: rate(quote.total, totalProteinG),
    },
  };
}

async function compareQuote(saved, context) {
  const { application, options } = context;
  let quote;
  try {
    quote = await originalQuote(application, saved, options);
  } catch (error) {
    return {
      quote: saved,
      eligible: false,
      problems: [error.message],
      metrics: null,
    };
  }
  const age = (options.now ?? Date.now()) - Date.parse(quote.observedAt);
  const problems =
    age < 0 ||
    (age > (options.maxPriceAgeMs ?? 86400000) && options.allowStale !== true)
      ? ['Stale or invalid checkout quote']
      : [];
  const lines = [];
  for (const line of quote.lines) {
    const checked = compareLine(line, quote, context);
    if (checked.result) {
      lines.push(checked.result);
    }
    problems.push(...checked.problems);
  }
  const totals = basketMetrics(quote, lines, options);
  problems.push(...totals.problems);
  return {
    quote,
    lines,
    eligible: problems.length === 0,
    problems: [...new Set(problems)],
    metrics: totals.metrics,
  };
}

export async function compareBaskets(application, options = {}) {
  for (const field of [
    'minMassG',
    'minVolumeMl',
    'minProteinG',
    'maxPriceAgeMs',
  ]) {
    if (options[field] !== undefined) {
      positive(options[field], field, { zero: true });
    }
  }
  const sort =
    !options.sort || options.sort === 'costPerProteinG'
      ? 'costPerProteinGramAfterDelivery'
      : options.sort;
  if (!rankingFields.includes(sort)) {
    throw new Error('Unsupported basket ranking metric');
  }
  const saved = await application.store.list('basket-quote');
  const inputs = await comparisonInputs(application.store, {
    offerIds: new Set(
      saved.flatMap((quote) => (quote.lines || []).map((line) => line.offerId))
    ),
    manufacturerRegistry: application.manufacturerRegistry,
  });
  const context = {
    application,
    options,
    products: new Map(inputs.products.map((product) => [product.id, product])),
    offers: new Map(inputs.offers.map((offer) => [offer.id, offer])),
  };
  const observations = [];
  for (const quote of saved) {
    observations.push(await compareQuote(quote, context));
  }
  const ranked = observations
    .filter((row) => row.eligible && Number.isFinite(row.metrics?.[sort]))
    .sort((left, right) => left.metrics[sort] - right.metrics[sort]);
  const report = {
    observations,
    ranked,
    excluded: observations.filter((row) => !ranked.includes(row)),
    assumptions: {
      sort,
      quoteCoverage: 'captured-exact-baskets-only',
      allBasketCombinationsCollected: false,
    },
  };
  return applyBasketComparisonTranslations(report, application.translator);
}
