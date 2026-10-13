import { parseHTML } from 'linkedom';
import { fold, sha256 } from './util.js';
import { massEvidence, splitIngredients } from './nutrition.js';
import { manufacturerIdentityGaps } from './manufacturer-research.js';
import { verifyOriginalBoundOcr } from './ocr-evidence.js';

const NUTRIENTS = {
  protein: /\bprotein\b|\bdam\b|단백질/iu,
  sugar: /\bsugars?\b|\bduong\b|당류/iu,
  saturatedFat: /saturated\s+fat|beo\s+bao\s+hoa|포화지방/iu,
  fat: /\btotal\s+fat\b|^\s*fat\b|chat\s+beo|^\s*지방/iu,
  kcal: /\bkcal\b|\bcalories\b|nang\s+luong|열량/iu,
};
const FACT_UNITS = {
  netMassG: 'g',
  netVolumeMl: 'ml',
  proteinPerPackageG: 'g/package',
  ingredients: 'text',
};

export async function readWorkflowOriginal(store, source) {
  const hash = source?.blob?.sha256;
  const bytes = hash ? await store.blob(hash) : undefined;
  if (!bytes || sha256(bytes) !== hash || source.blob.bytes !== bytes.length) {
    throw new Error('Workflow source original is missing or corrupt');
  }
  return bytes;
}

export function workflowSourceText(source, bytes) {
  if (/html/iu.test(source.contentType || '')) {
    const spaced = bytes
      .toString('utf8')
      .replace(/<\/(?:td|th|tr|p|div)>|<br\s*\/?>/giu, '\n$&');
    const { document } = parseHTML(`<html><body>${spaced}</body></html>`);
    for (const element of document.querySelectorAll(
      'script, style, template'
    )) {
      element.remove();
    }
    return document.body.textContent;
  }
  return /^text\/|json/iu.test(source.contentType || '')
    ? bytes.toString('utf8')
    : '';
}

export async function boundWorkflowOcrText(store, source, ocr) {
  return (await verifyOriginalBoundOcr(store, source.blob, ocr)).text;
}

function amountCandidates(text) {
  const mass = massEvidence(text)
    .candidates.filter((candidate) => candidate.scope === 'net')
    .map((candidate) => ({
      field: 'netMassG',
      value: candidate.value,
      unit: 'g',
      sourceUnit: candidate.unit,
      sourceValue:
        candidate.value / (/^(?:kg|kilogram)/u.test(candidate.unit) ? 1000 : 1),
      valueExcerpt: candidate.excerpt,
      excerpt: text.slice(
        Math.max(0, candidate.index - 60),
        candidate.index + candidate.excerpt.length + 50
      ),
      basis: 'one-inner-food-package',
    }));
  const volume = [];
  const pattern =
    /(?:net\s*(?:volume|content)|contents?|dung\s*tich(?:\s*tinh)?)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(ml|l|litres?|liters?)(?![\p{L}])/giu;
  for (const match of text.matchAll(pattern)) {
    const multiplier = /^ml$/iu.test(match[2]) ? 1 : 1000;
    volume.push({
      field: 'netVolumeMl',
      value: Number(match[1].replace(',', '.')) * multiplier,
      unit: 'ml',
      sourceUnit: match[2],
      sourceValue: Number(match[1].replace(',', '.')),
      valueExcerpt: `${match[1]} ${match[2]}`,
      excerpt: match[0],
      basis: 'one-inner-food-package',
    });
  }
  return [...mass, ...volume];
}

function nutrientCandidates(text) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const basis = lines.filter((line) =>
    /(?<!\d)100\s*(?:g|ml)\b|\bper\s+(?:(?:one|1|whole|entire)\s+)?(?:package|pack|tub|bottle|container|unit)\b/iu.test(
      line
    )
  );
  if (basis.length !== 1) {
    return [];
  }
  const packageBasis = !/(?<!\d)100\s*(?:g|ml)\b/iu.test(basis[0]);
  const suffix = packageBasis
    ? 'PackageG'
    : /(?<!\d)100\s*ml\b/iu.test(basis[0])
      ? '100ml'
      : '100g';
  const candidates = [];
  for (const line of lines) {
    const value = line.match(/(?<![\d.])(\d+(?:[.,]\d+)?)\s*(g|kcal)\b/iu);
    if (!value || /(?<!\d)100\s*(?:g|ml)\b/iu.test(line)) {
      continue;
    }
    for (const [name, pattern] of Object.entries(NUTRIENTS)) {
      if (packageBasis && name !== 'protein') {
        continue;
      }
      if (!pattern.test(fold(line)) && !pattern.test(line)) {
        continue;
      }
      if ((name === 'kcal') !== /^kcal$/iu.test(value[2])) {
        continue;
      }
      candidates.push({
        field: `${name}Per${suffix}`,
        value: Number(value[1].replace(',', '.')),
        unit: packageBasis
          ? 'g/package'
          : `${name === 'kcal' ? 'kcal' : 'g'}/${suffix}`,
        sourceUnit: value[2],
        valueExcerpt: value[0],
        excerpt:
          packageBasis && text.includes(`${basis[0]}\n${line}`)
            ? `${basis[0]}\n${line}`
            : line,
        basis: packageBasis ? 'per-one-inner-food-package' : `per-${suffix}`,
        basisExcerpt: basis[0],
        labelColumnAssociationRequiresReview: true,
      });
    }
  }
  return candidates;
}

export function extractWorkflowFactCandidates({ text }) {
  const candidates = [...amountCandidates(text), ...nutrientCandidates(text)];
  const ingredients = text.match(
    /(?:ingredients?|thành phần)\s*:\s*([^\r\n]+)/iu
  );
  if (ingredients) {
    candidates.push({
      field: 'ingredients',
      value: splitIngredients(ingredients[1]),
      unit: 'text',
      excerpt: ingredients[0],
      basis: 'complete-original-ingredient-list',
      completeLabelUnconfirmed: true,
    });
  }
  return { candidates, identity: null, currentFormulaConfirmed: false };
}

function originalIdentity(input) {
  const fields = [
    'brand',
    'name',
    'flavour',
    'market',
    'packageType',
    'formulaRevision',
  ];
  if (
    !input ||
    fields.some(
      (field) => typeof input[field] !== 'string' || !input[field].trim()
    ) ||
    input.currentFormula !== true ||
    !['gtin', 'variantCode'].some(
      (field) => typeof input[field] === 'string' && input[field].trim()
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    [
      ...fields,
      'currentFormula',
      'gtin',
      'variantCode',
      'category',
      'coreFlavour',
      'netMassG',
      'netVolumeMl',
      'innerPackCount',
    ]
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]])
  );
}

export function extractStructuredWorkflowCandidates({ text, source }) {
  if (!/json/iu.test(source.contentType || '')) {
    return extractWorkflowFactCandidates({ text });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      candidates: [],
      identity: null,
      blockers: ['invalid-structured-source-json'],
    };
  }
  const identity = originalIdentity(data.identity || data.productIdentity);
  if (!identity) {
    return {
      candidates: [],
      identity: null,
      currentFormulaConfirmed: false,
      blockers: ['structured-revision-currentness-or-exact-identity-absent'],
    };
  }
  const candidates = [];
  for (const field of ['netMassG', 'netVolumeMl']) {
    const quantity = data.quantities?.[field];
    if (
      quantity?.value > 0 &&
      quantity.unit === FACT_UNITS[field] &&
      quantity.basis === 'one-inner-food-package' &&
      identity[field] === quantity.value &&
      quantity.originalLabelExcerpt?.trim() &&
      quantity.valueExcerpt?.trim()
    ) {
      candidates.push({
        field,
        ...quantity,
        excerpt: quantity.originalLabelExcerpt,
        structuredJsonPointer: `/quantities/${field}`,
        structuredOriginalSha256: source.blob.sha256,
      });
    }
  }
  for (const [field, fact] of Object.entries(data.nutrition || {})) {
    const supportedValue =
      field === 'ingredients'
        ? Array.isArray(fact.value) &&
          fact.value.length > 0 &&
          fact.value.every((entry) => typeof entry === 'string' && entry.trim())
        : Number.isFinite(fact.value) && fact.value >= 0;
    if (
      allowedFact({ field, ...fact }) &&
      supportedValue &&
      typeof fact.originalLabelExcerpt === 'string' &&
      fact.originalLabelExcerpt.trim()
    ) {
      // Numeric JSON keys do not establish a nutrition label's unit/basis.
      // The exact label excerpt remains subject to source-bound human review.
      candidates.push({
        field,
        ...fact,
        excerpt: fact.originalLabelExcerpt,
        structuredJsonPointer: `/nutrition/${field}`,
        structuredOriginalSha256: source.blob.sha256,
      });
    }
  }
  return {
    candidates,
    identity,
    currentFormulaConfirmed: identity?.currentFormula === true,
    blockers: identity
      ? []
      : ['structured-revision-currentness-or-exact-identity-absent'],
  };
}

function allowedFact(candidate) {
  const field = candidate.field;
  const unit =
    FACT_UNITS[field] ||
    (/^(?:protein|sugar|fat|saturatedFat)Per100(?:g|ml)$/u.test(field)
      ? `g/${field.endsWith('ml') ? '100ml' : '100g'}`
      : /^kcalPer100(?:g|ml)$/u.test(field)
        ? `kcal/${field.endsWith('ml') ? '100ml' : '100g'}`
        : null);
  return Boolean(unit && unit === candidate.unit && candidate.basis?.trim());
}

export function prepareWorkflowFacts(item, source, extracted, text, ocr) {
  const identity = extracted.identity || null;
  const gaps = manufacturerIdentityGaps(item.identity, identity || {});
  const candidates = [];
  const rejected = [];
  for (const candidate of extracted.candidates || []) {
    const numeric = candidate.field !== 'ingredients';
    const originalExcerpt = candidate.excerpt?.trim();
    // A parser or provider proposes facts; only the existing review APIs can
    // approve them after exact identity and original source validation.
    if (
      !allowedFact(candidate) ||
      !originalExcerpt ||
      !fold(text).includes(fold(originalExcerpt)) ||
      (numeric && (!Number.isFinite(candidate.value) || candidate.value < 0)) ||
      (!numeric && (!Array.isArray(candidate.value) || !candidate.value.length))
    ) {
      rejected.push({
        field: candidate.field || null,
        reason: 'unsupported-or-not-in-original',
      });
      continue;
    }
    const zero = numeric && candidate.value === 0;
    candidates.push({
      ...candidate,
      id: `manufacturer-fact-candidate:${sha256(JSON.stringify([item.productFingerprint, source.id, source.blob.sha256, candidate]))}`,
      productId: item.productId,
      sourceId: source.id,
      sourceRecordKind: source.sourceRecordKind || 'manufacturer-source',
      ...(source.evidenceId ? { sourceEvidenceId: source.evidenceId } : {}),
      sourceUrl: source.finalUrl,
      sourceSha256: source.blob.sha256,
      sourceAuthority: source.authority,
      ...(ocr
        ? {
            ocrId: ocr.id,
            ocrTsvSha256: ocr.rawTsv.sha256,
            confidence: ocr.confidence,
          }
        : {}),
      identity,
      identityGaps: gaps,
      zeroValueRequiresPlaceholderReview: zero,
      identityMatched: false,
      requiresReview: true,
      approvalStatus: 'candidate-only',
    });
  }
  return { candidates, rejected, identityGaps: gaps };
}

export function workflowReviewDraft(item, candidates, kind) {
  const selected = candidates.filter((candidate) =>
    kind === 'quantity'
      ? ['netMassG', 'netVolumeMl'].includes(candidate.field)
      : !['netMassG', 'netVolumeMl'].includes(candidate.field)
  );
  return {
    productId: item.productId,
    productFingerprint: item.productFingerprint,
    sku: item.sku,
    listingIdentity: item.identity,
    kind,
    requiredFields:
      kind === 'quantity' ? item.quantityFields : item.nutritionFields,
    candidates: selected,
    listingOriginals: item.originals.filter(
      (original) => original.role === 'listing'
    ),
    approvalStatus: 'draft-requires-source-and-exact-package-review',
    blockingReasons: [
      ...(!selected.length ? ['no-supported-original-fact-candidates'] : []),
      ...(kind === 'nutrition' &&
      selected.some((candidate) => candidate.sourceAuthority !== 'manufacturer')
        ? [
            'non-manufacturer-nutrition-withheld-until-primary-label-cross-check',
          ]
        : []),
      ...new Set(selected.flatMap((candidate) => candidate.identityGaps)),
      ...(selected.some(
        (candidate) => candidate.zeroValueRequiresPlaceholderReview
      )
        ? ['zero-value-placeholder-or-genuine-label-value-needs-review']
        : []),
      'explicit-reviewer-and-original-evidence-attachment-required',
    ],
    automaticApprovalAllowed: false,
    densityConversionAllowed: false,
    targetReviewApi:
      kind === 'quantity'
        ? 'reviewPackageQuantities'
        : 'reviewManufacturerResearch',
  };
}
