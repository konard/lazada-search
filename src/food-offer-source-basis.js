import { fold, normalizeText } from './text.js';
import { massEvidence } from './nutrition.js';
import { sha256 } from './util.js';
import { hasReviewedPackageMass } from './reviewed-package-mass.js';

const foodUnits =
  '(?:tui|goi|bich|hop|ly|chai|cay|que|bags?|pouches?|packs?|tubs?|cups?|bottles?|bars?|sticks?)';
const promotion = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?:(mua|buy)\\s*)?(\\d{1,3})(?![\\d.,])\\s*(${foodUnits})?\\s*(?:tang|get)\\s*(\\d{1,3})(?![\\d.,])\\s*(${foodUnits})?(?:\\s+free)?\\b`,
  'u'
);
const giftMarker = /\b(?:tang|get|free|bonus)\b/u;
const dietaryTerm =
  '(?:sugar|lactose|gluten|fat|dairy|cholesterol|calories?|carbs?|soy|nuts?)';
const accessory =
  /\b(?:shakers?|binh(?:\s+lac)?|water\s+bottles?|gloves?|gang\s+tay|muong|scoops?|giao\s+an|thuc\s+don|training\s+plan|meal\s+plan|vouchers?|coupons?)\b/u;
const edibleUnit = new RegExp(`\\b${foodUnits}\\b`, 'u');
const foodCategories = new Set([
  'whey',
  'protein-powder',
  'chocolate-ice-cream',
]);

function promotionText(value) {
  return fold(value)
    .replace(/(\d)(?=\p{L})/gu, '$1 ')
    .replace(/(\p{L})(?=\d)/gu, '$1 ');
}

function skuNumber(value) {
  return value ? String(value).split('_VNAMZ-').at(-1) : undefined;
}

function optionText(entry) {
  return normalizeText(
    typeof entry === 'string' ? entry : entry?.text || entry?.value || ''
  );
}

function selectedOptions(snapshot, sku) {
  const selected = (snapshot.selectedVariant || [])
    .filter((entry) => entry?.selected !== false)
    .map(optionText)
    .filter(Boolean);
  const catalog =
    snapshot.skuCatalogObserved === true
      ? snapshot.skuCatalog?.find((entry) => skuNumber(entry.sku) === sku)
      : undefined;
  const catalogOptions = (catalog?.options || [])
    .map(optionText)
    .filter(Boolean);
  const contradiction = Boolean(
    catalogOptions.length &&
    selected.some(
      (text) => !catalogOptions.some((value) => fold(value) === fold(text))
    )
  );
  return { selected, catalogOptions, contradiction };
}

function selectionContext(snapshot, product, offer) {
  const entrySkus = (snapshot.selectedVariant || [])
    .filter((entry) => entry?.selected !== false && entry?.sku)
    .map((entry) => entry.sku);
  const values = [snapshot.sku, product.sku, offer.sku, ...entrySkus]
    .filter(Boolean)
    .map(skuNumber);
  const { selected, catalogOptions, contradiction } = selectedOptions(
    snapshot,
    values[0]
  );
  const conflicts = new Set(values).size > 1 || contradiction;
  return {
    sku: [offer.sku, product.sku, snapshot.sku].find(Boolean) || null,
    bound: Boolean(
      (snapshot.sku || entrySkus.length) &&
      !conflicts &&
      offer.variantConfirmed !== false
    ),
    options: conflicts
      ? []
      : [...new Set(catalogOptions.length ? catalogOptions : selected)],
    method: catalogOptions.length
      ? 'observed-selected-sku-catalogue'
      : 'displayed-selected-option',
    conflict: conflicts,
  };
}

function firstPresent(...values) {
  return (
    values.find(
      (value) => value !== undefined && value !== null && value !== ''
    ) ?? null
  );
}

function sourceObservation(context, snapshot, selection, excerpt) {
  const evidence = context.evidence || {};
  return {
    evidenceId: firstPresent(
      evidence.id,
      context.evidenceId,
      context.offer?.evidenceId
    ),
    sourceUrl: firstPresent(evidence.url, evidence.sourceUrl, snapshot.url),
    sourceSha256: firstPresent(
      evidence.html?.sha256,
      context.originalHtmlSha256
    ),
    observedAt: firstPresent(
      evidence.observedAt,
      context.observedAt,
      context.offer?.observedAt
    ),
    selectedSku: selection.sku,
    selectedSkuBound: selection.bound,
    method: selection.method,
    excerpt,
    requiresReview: true,
    originalValidated: false,
  };
}

function advertisedCounts(text) {
  const match = text.match(promotion);
  if (!match) {
    return {};
  }
  const [paid, bonus] = [Number(match[2]), Number(match[4])];
  if (
    ![paid, bonus].every(
      (count) => Number.isSafeInteger(count) && count > 0 && count <= 100
    )
  ) {
    return {};
  }
  return {
    advertisedPaidUnits: paid,
    advertisedBonusUnits: bonus,
    paidCountBasis:
      match[1] || !match[3]
        ? 'promotion-purchase-threshold'
        : 'selected-paid-food-package-count',
  };
}

function dietaryFree(text, index) {
  const before = text.slice(0, index);
  const after = text.slice(index + 'free'.length);
  return (
    new RegExp(`\\b${dietaryTerm}[\\s\\p{Pd}]*$`, 'u').test(before) ||
    new RegExp(
      `^[\\s\\p{Pd}]+(?:of|from)\\s+(?:(?:any|all|added|artificial)\\s+)*${dietaryTerm}\\b`,
      'u'
    ).test(after)
  );
}

function giftIndex(text) {
  for (const match of text.matchAll(new RegExp(giftMarker.source, 'gu'))) {
    if (match[0] !== 'free' || !dietaryFree(text, match.index)) {
      return match.index;
    }
  }
  return -1;
}

function componentMarker(text, originalText) {
  const index = giftIndex(text);
  if (index >= 0) {
    return index;
  }
  const accessoryWith =
    accessory.test(text) &&
    /(?<!\p{L})(?:kèm|with)(?!\p{L})/iu.test(originalText);
  return accessoryWith ? text.search(/\b(?:kem|with)\b/u) : -1;
}

function advertisedComponent(text, originalText, context, snapshot, selection) {
  const marker = componentMarker(text, originalText);
  if (marker < 0) {
    return undefined;
  }
  const gift = text.slice(marker);
  const nonFood = accessory.test(gift);
  const counts = advertisedCounts(text);
  if (
    !nonFood &&
    !edibleUnit.test(gift) &&
    !(
      foodCategories.has(context.product?.category) &&
      counts.advertisedBonusUnits
    )
  ) {
    return undefined;
  }
  const kind = nonFood ? 'non-food' : 'bonus-food';
  const source = sourceObservation(context, snapshot, selection, originalText);
  return {
    id: `discovered-food-component:${sha256(JSON.stringify([selection.sku, kind, text]))}`,
    kind,
    ...(nonFood ? { name: originalText } : { status: 'potential' }),
    originalText,
    evidenceIds: source.evidenceId ? [source.evidenceId] : [],
    discovery: {
      method: 'selected-option-food-gift-v1',
      ...counts,
      source,
      requiresReview: true,
      factualApprovalGranted: false,
    },
  };
}

function potentialComponents(snapshot, context, selection) {
  const records = new Map();
  for (const originalText of selection.options) {
    const text = promotionText(originalText);
    for (const clause of text.split(/\s*(?:[+;]|,\s*|\bva\b|\band\b)\s*/u)) {
      const component = advertisedComponent(
        clause,
        originalText,
        context,
        snapshot,
        selection
      );
      if (component) {
        records.set(component.id, component);
      }
    }
  }
  return [...records.values()];
}

function massStatementBasis(candidate, candidates, text, packCount) {
  const index = candidates.indexOf(candidate);
  const previous = candidates[index - 1];
  const next = candidates[index + 1];
  const before = fold(
    text.slice(
      previous
        ? previous.index + previous.excerpt.length
        : Math.max(0, candidate.index - 80),
      candidate.index
    )
  );
  const after = fold(
    text.slice(
      candidate.index + candidate.excerpt.length,
      next ? next.index : candidate.index + candidate.excerpt.length + 60
    )
  );
  if (giftIndex(before) >= 0) {
    return 'bonus-package-or-promotion';
  }
  const eachBefore = new RegExp(
    `\\b(?:moi|tung|each|every)\\s+${foodUnits}(?:\\s+(?:nang|net|weight|weighs|contains)){0,3}\\s*[:=]?\\s*$`,
    'u'
  );
  const eachAfter = new RegExp(`^\\s*(?:/|per)\\s*${foodUnits}\\b`, 'u');
  const multiplication =
    before.match(
      new RegExp(
        `(?<![\\p{L}\\p{N}.,])(\\d+)(?![\\d.,])\\s*(?:${foodUnits}\\s*)?[x×]\\s*$`,
        'u'
      )
    ) ||
    before.match(
      new RegExp(
        `(?<![\\p{L}\\p{N}.,])(\\d+)(?![\\d.,])\\s*${foodUnits}\\s+of\\s*$`,
        'u'
      )
    ) ||
    after.match(
      new RegExp(`^\\s*[x×]\\s*(\\d+)(?![\\d.,])(?:\\s*${foodUnits})?\\b`, 'u')
    );
  const inner =
    eachBefore.test(before) ||
    eachAfter.test(after) ||
    Boolean(multiplication && Number(multiplication[1]) === packCount);
  const total =
    /\b(?:total|tong|combined)(?:\s+(?:net|weight|mass|content|khoi|luong|trong|ca|combo|bundle|paid|of|the)){0,5}\s*[:=]?\s*$/u.test(
      before
    ) ||
    new RegExp(
      `^\\s*(?:for|cho)\\s*(?:(?:all|ca)\\s*)?\\d+\\s*${foodUnits}\\b`,
      'u'
    ).test(after);
  return inner && total
    ? 'conflicting'
    : inner
      ? 'one-inner-food-package'
      : total
        ? 'total-selling-unit'
        : 'ambiguous';
}

function foodMassContexts(product) {
  const selected = product.massEvidence?.selected;
  if (selected?.origin !== 'nutrition-net') {
    return selected ? [selected] : [];
  }
  // Nutrition's short net-weight excerpt can omit "per bottle". Recover its
  // equally ranked original package declaration without using a parent title,
  // another size, shipping weight or a lower-priority sibling declaration.
  const originals = (product.massEvidence.candidates || []).filter(
    (candidate) =>
      candidate.metric &&
      candidate.value === selected.value &&
      candidate.priority === selected.priority &&
      ['net', 'selling'].includes(candidate.scope) &&
      !['nutrition-net', 'title'].includes(candidate.origin) &&
      candidate.context
  );
  return originals.length ? originals : [selected];
}

function contextMassStatements(context, packCount) {
  const text = String(context.context || context.excerpt || '');
  const candidates = massEvidence(text).candidates;
  return candidates
    .filter(
      (candidate) =>
        candidate.metric &&
        !['nutrition', 'gross', 'parent'].includes(candidate.scope)
    )
    .map((candidate) => ({
      origin: context.origin,
      excerpt: text,
      massG: candidate.value,
      matchedMassExcerpt: candidate.excerpt,
      basis: massStatementBasis(candidate, candidates, text, packCount),
    }));
}

function foodMassStatements(product) {
  return foodMassContexts(product).flatMap((context) =>
    contextMassStatements(context, product.packCount)
  );
}

function selectedBundleCount(selection) {
  return selection.options
    .map((text) => advertisedCounts(promotionText(text)))
    .find(
      (counts) => counts.paidCountBasis === 'selected-paid-food-package-count'
    )?.advertisedPaidUnits;
}

function unresolvedMassAssessment(product) {
  return {
    selectedMassG: product.netMassG || null,
    packCount: product.packCount || null,
    basis: 'ambiguous',
    safeToMultiplyByPackCount: false,
    holdFields: [],
    requiresReview: true,
    factualApprovalGranted: false,
    sourceStatements: [],
    reasons: [],
  };
}

function existingMassHold(product) {
  return (
    !(product.netMassG > 0) ||
    product.specificationsInvalidated ||
    product.pendingSpecificationReview?.includes('netMassG')
  );
}

function massAssessment(product, selection) {
  const result = unresolvedMassAssessment(product);
  if (existingMassHold(product)) {
    return {
      ...result,
      basis: 'missing-or-already-held',
      reasons: ['Existing unknown or held mass remains unresolved'],
    };
  }
  const advertisedPaidCount = selectedBundleCount(selection);
  if (advertisedPaidCount && advertisedPaidCount !== product.packCount) {
    return {
      ...result,
      holdFields: ['netMassG', 'packCount'],
      reasons: [
        'Selected advertised paid count contradicts or lacks its recorded pack count',
      ],
    };
  }
  if (hasReviewedPackageMass(product)) {
    return {
      ...result,
      basis: 'existing-reviewed-mass-preserved',
      safeToMultiplyByPackCount: true,
      requiresReview: false,
      reasons: [
        'Existing exact reviewed facts are preserved; this helper grants no new authority',
      ],
    };
  }
  if (!product.packCount || product.packCount === 1) {
    return {
      ...result,
      basis: 'single-selling-unit',
      safeToMultiplyByPackCount: true,
      requiresReview: false,
    };
  }
  return unreviewedMultipackAssessment(product, selection, result);
}

function unreviewedMultipackAssessment(product, selection, result) {
  const statements = foodMassStatements(product);
  result.sourceStatements = statements.filter(
    (statement) => statement.massG === product.netMassG
  );
  const expectedTotal = product.netMassG * product.packCount;
  const contradictoryTotals = statements.filter(
    (statement) =>
      statement.basis === 'total-selling-unit' &&
      Math.abs(statement.massG - expectedTotal) >
        Number.EPSILON * Math.max(statement.massG, expectedTotal) * 8
  );
  if (
    contradictoryTotals.length &&
    result.sourceStatements.some(
      (statement) => statement.basis === 'one-inner-food-package'
    )
  ) {
    return {
      ...result,
      basis: 'conflicting-total-selling-unit',
      holdFields: ['netMassG'],
      sourceStatements: [
        ...new Set([...result.sourceStatements, ...contradictoryTotals]),
      ],
      reasons: [
        'The explicit total selling-unit mass contradicts the recorded per-inner mass and paid pack count; no replacement is inferred',
      ],
    };
  }
  const bases = new Set(
    result.sourceStatements.map((statement) => statement.basis)
  );
  const boundInner =
    selection.bound &&
    bases.size === 1 &&
    bases.has('one-inner-food-package') &&
    result.sourceStatements.every((statement) => statement.origin !== 'title');
  if (boundInner) {
    return {
      ...result,
      basis: 'one-inner-food-package',
      safeToMultiplyByPackCount: true,
      requiresReview: false,
    };
  }
  return {
    ...result,
    basis:
      bases.size === 1 && bases.has('total-selling-unit')
        ? 'total-selling-unit'
        : 'ambiguous',
    holdFields: ['netMassG'],
    reasons: [
      'A multipack mass needs explicit selected per-inner-package basis; total or parent mass cannot be multiplied',
    ],
  };
}

/** Pure draft observations. No gift facts, stock, eligibility or new mass approval. */
export function discoverFoodOfferSourceBasis(snapshot, context = {}) {
  const product = context.product || {};
  const offer = context.offer || {};
  const selection = selectionContext(snapshot, product, offer);
  return {
    method: 'food-offer-source-basis-v1',
    selectedSku: selection.sku,
    selectedSkuBound: selection.bound,
    selectionConflict: selection.conflict,
    foodComponents: potentialComponents(snapshot, context, selection),
    paidMassBasis: massAssessment(product, selection),
  };
}
