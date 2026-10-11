import { isDeepStrictEqual } from 'node:util';
import {
  categoryOf,
  extractNutrition,
  ingredientFlags,
  massEvidence,
  parsePrice,
  proteinTypeOf,
  volumeMillilitres,
} from './nutrition.js';
import {
  resolvePackageCountReview,
  sellingPackCount,
} from './package-quantity.js';
import { productFlavour } from './flavour-scope.js';
import { applyPackageMassConsistency } from './package-mass-consistency.js';
import { applyFoodOfferDiscovery } from './food-offer-discovery.js';
import {
  canonicalUrl,
  clone,
  fold,
  normalizeText,
  positive,
  sha256,
} from './util.js';

function productsIn(value) {
  if (Array.isArray(value)) {
    return value.flatMap(productsIn);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const type = Array.isArray(value['@type'])
    ? value['@type']
    : [value['@type']];
  return [
    ...(type.includes('Product') ? [value] : []),
    ...productsIn(value['@graph']),
  ];
}

export function selectedStructuredProduct(snapshot) {
  const products = (snapshot.jsonLd || []).flatMap(productsIn);
  const exact = products.filter((product) => {
    try {
      return (
        product.url && canonicalUrl(product.url) === canonicalUrl(snapshot.url)
      );
    } catch {
      return false;
    }
  });
  if (exact.length === 1) {
    return exact[0];
  }
  return products.length === 1 ? products[0] : undefined;
}

function productIdentityUrl(value) {
  const url = new URL(value);
  const item = url.pathname.match(/-i(\d+)(?:-s\d+)?\.html$/u)?.[1];
  return item && /(?:^|\.)lazada\./u.test(url.hostname)
    ? `https://www.${url.hostname.replace(/^www\./u, '')}/products/pdp-i${item}.html`
    : value;
}

function sellingMass(selectedText, title, nutrition, description, specs) {
  const selectedAmount = massEvidence(selectedText).selected;
  const inputs = [
    ['selected-option', selectedText, 6, 3],
    ...specs.map((text) => ['specification', text, 5, 2]),
    ['description', description, 5, 2],
    ['title', title, 4, 1],
    ['nutrition-net', nutrition.excerpts.netMassG, 5, 2],
  ];
  const candidates = inputs.flatMap(
    ([origin, text, metricRank, imperialRank]) =>
      massEvidence(text).candidates.map((candidate) => ({
        ...candidate,
        origin,
        context: String(text || '').slice(
          Math.max(0, candidate.index - 100),
          candidate.index + candidate.excerpt.length + 100
        ),
        priority:
          !['selected-option', 'title'].includes(origin) &&
          selectedAmount &&
          !selectedAmount.metric &&
          candidate.metric &&
          Math.abs(candidate.value - selectedAmount.value) >
            0.02 * selectedAmount.value
            ? 2
            : ['selected-option', 'title'].includes(origin) ||
                ['net', 'selling'].includes(candidate.scope)
              ? candidate.metric
                ? metricRank
                : imperialRank
              : 0,
      }))
  );
  const eligible = candidates.filter(
    (candidate) =>
      candidate.priority > 0 &&
      ['net', 'selling', 'headline'].includes(candidate.scope)
  );
  eligible.sort(
    (left, right) => right.priority - left.priority || left.index - right.index
  );
  const winner = eligible[0];
  const conflicting = eligible.filter(
    (candidate) =>
      candidate.priority === winner?.priority &&
      candidate.value !== winner.value
  );
  return {
    selected: winner,
    candidates,
    conflicting: conflicting.length > 0,
    method: 'selected-metric-selling-unit-v1',
  };
}

function selectedAmounts(selected, title, nutrition, description, specs = []) {
  const selectedText = selected.map((entry) => entry.text).join(' ');
  const selectedCategory = categoryOf(selectedText);
  const titleCategory = categoryOf(title);
  // "Chocolate ice cream" is also a whey flavour. It cannot change an
  // explicitly identified powder into frozen food or supply a volume.
  const category =
    selectedCategory === 'unknown' ||
    (selectedCategory === 'chocolate-ice-cream' &&
      ['whey', 'protein-powder'].includes(titleCategory))
      ? titleCategory
      : selectedCategory;
  const count = sellingPackCount({ selectedText, title, description });
  const weightEvidence = sellingMass(
    selectedText,
    title,
    nutrition,
    description,
    specs
  );
  return {
    category,
    weight: weightEvidence.selected?.value,
    weightEvidence,
    packCount: count.packCount,
    packCountExcerpt: count.excerpt,
    quantityFields: count.unresolved ? { packageCountUnresolved: true } : {},
    quantityWarnings: count.warning ? [count.warning] : [],
    volume:
      category === 'chocolate-ice-cream'
        ? volumeMillilitres(selectedText) ||
          nutrition.fields.netVolumeMl ||
          volumeMillilitres(title)
        : nutrition.fields.netVolumeMl,
  };
}

// OCR alone cannot identify a selling package. The caller must attach the
// current SKU/options and identical original image digest; manual gallery
// matching additionally requires an explicit reviewer and rationale.
export function applySelectedPackageMass(product, evidence) {
  const options = (values) =>
    [
      ...new Set(
        (values || []).map((value) =>
          fold(typeof value === 'string' ? value : value.text)
        )
      ),
    ].sort();
  const reviewed =
    evidence.method === 'visual-exact-package' &&
    evidence.reviewedBy?.trim() &&
    evidence.reason?.trim();
  const selectedFlavour = productFlavour({
    category: product.category,
    title: product.title,
    selectedVariant: product.selectedVariant,
  });
  const labelFlavour = productFlavour({
    category: product.category,
    title: evidence.text,
  });
  const contradictsFlavour =
    selectedFlavour !== 'unknown' &&
    labelFlavour !== 'unknown' &&
    selectedFlavour !== labelFlavour;
  const matched =
    evidence.selectionConfirmed === true &&
    product.sku &&
    evidence.sku === product.sku &&
    JSON.stringify(options(evidence.selectedOptions)) ===
      JSON.stringify(options(product.selectedVariant)) &&
    /^[a-f\d]{64}$/u.test(evidence.imageSha256 || '') &&
    evidence.imageSha256 === evidence.matchedImageSha256 &&
    (reviewed ||
      (evidence.method === 'selected-sku-image-ocr' &&
        evidence.confidence >= 0.9));
  const mass = massEvidence(evidence.text).selected;
  if (
    !matched ||
    contradictsFlavour ||
    !mass?.metric ||
    mass.scope !== 'net' ||
    !evidence.evidenceId
  ) {
    return {
      applied: false,
      reason:
        'Exact selected package image and declared metric net mass require matching evidence',
    };
  }
  const previous = product.netMassG;
  // Sellers can reuse a factory-container image for a metric-size repack.
  // A conflicting OCR result must not replace that declared selling size,
  // regardless of whether it came from the option, title or specification.
  const protectedMass =
    product.reviewedFields?.includes('netMassG') ||
    product.manufacturerVerification?.identityMatched ||
    (!reviewed && product.massEvidence?.selected?.metric === true);
  const changed = Number.isFinite(previous) && previous !== mass.value;
  const claim = {
    field: 'netMassG',
    value: mass.value,
    evidenceId: evidence.evidenceId,
    source: reviewed ? 'selected-package-label-review' : 'selected-package-ocr',
    confidence: reviewed ? 1 : evidence.confidence,
    requiresReview: Boolean(protectedMass && changed),
    excerpt: evidence.text,
    imageSha256: evidence.imageSha256,
    selectedSku: evidence.sku,
    selectionMethod: evidence.method,
    ...(reviewed
      ? { reviewedBy: evidence.reviewedBy, reason: evidence.reason }
      : {}),
  };
  product.claims ||= [];
  if (
    !product.claims.some(
      (entry) => JSON.stringify(entry) === JSON.stringify(claim)
    )
  ) {
    product.claims.push(claim);
  }
  product.evidenceIds = [
    ...new Set([...(product.evidenceIds || []), evidence.evidenceId]),
  ];
  if (protectedMass && changed) {
    product.pendingSpecificationReview = [
      ...new Set([...(product.pendingSpecificationReview || []), 'netMassG']),
    ];
    product.warnings ||= [];
    product.warnings.push(
      'Selected package label conflicts with declared net mass; evidence review required'
    );
    if (evidence.packageIdentityChanged === true) {
      product.invalidatedSpecificationFields = [
        ...new Set([
          ...(product.invalidatedSpecificationFields || []),
          'netMassG',
        ]),
      ];
      product.specificationsInvalidated = true;
      if (product.manufacturerVerification) {
        product.manufacturerVerification = {
          ...product.manufacturerVerification,
          identityMatched: false,
          invalidationReason:
            'A newly matched selected selling package contradicts reviewed net mass',
        };
      }
    }
    return { applied: false, requiresReview: true, candidateMassG: mass.value };
  }
  if (changed) {
    product.corrections ||= [];
    product.corrections.push({
      field: 'netMassG',
      previous,
      corrected: mass.value,
      evidenceId: evidence.evidenceId,
      imageSha256: evidence.imageSha256,
      reason:
        'Matched selected package printed metric mass overrides an unreviewed headline conversion',
    });
  }
  product.netMassG = mass.value;
  product.massEvidence = {
    ...(product.massEvidence || {}),
    selected: {
      ...mass,
      origin: evidence.method,
      evidenceId: evidence.evidenceId,
      imageSha256: evidence.imageSha256,
    },
    method: 'exact-selected-package-label-v1',
  };
  return { applied: true, massG: mass.value };
}

function saleDetails(snapshot, price, currency) {
  const originalPrice = parsePrice(snapshot.originalPriceText, currency);
  const displayedDiscountPercent = Number(
    snapshot.discountPercentText
      ?.match(/(\d+(?:[.,]\d+)?)\s*%/u)?.[1]
      ?.replace(',', '.')
  );
  return {
    ...(originalPrice >= price && originalPrice > 0
      ? {
          originalPrice,
          saleSavings: originalPrice - price,
          saleDiscountPercent: (100 * (originalPrice - price)) / originalPrice,
        }
      : {}),
    ...(displayedDiscountPercent >= 0 && displayedDiscountPercent <= 100
      ? { displayedDiscountPercent }
      : {}),
  };
}

function appendAmountClaims(
  product,
  { fields, weightEvidence, amountExcerpts, title, evidenceId, source }
) {
  for (const [field, value] of Object.entries(fields)) {
    if (field === 'netMassG') {
      continue;
    }
    product.claims.push({
      field,
      value,
      evidenceId,
      source,
      confidence: source === 'ocr' ? 0 : 1,
      requiresReview: source === 'ocr',
      excerpt: amountExcerpts[field] || title,
    });
  }
  for (const candidate of weightEvidence.candidates) {
    if (candidate.scope === 'nutrition') {
      continue;
    }
    const selectedMass = candidate === weightEvidence.selected;
    product.claims.push({
      field:
        candidate.scope === 'parent'
          ? 'parentPackageMassG'
          : candidate.scope === 'gross'
            ? 'grossMassG'
            : 'netMassG',
      value: candidate.value,
      evidenceId,
      source,
      confidence: source === 'ocr' ? 0 : 1,
      requiresReview:
        source === 'ocr' || !selectedMass || weightEvidence.conflicting,
      excerpt: candidate.context,
      massUnit: candidate.unit,
      massScope: candidate.scope,
      amountOrigin: candidate.origin,
      ...(selectedMass
        ? { selectionMethod: weightEvidence.method }
        : { supersededForSellingMass: true }),
    });
  }
}

export function parseProduct(
  snapshot,
  {
    market = 'vn',
    currency = 'VND',
    evidenceId,
    originalHtmlSha256,
    source = 'dom',
    observedAt = new Date().toISOString(),
  } = {}
) {
  const structured = selectedStructuredProduct(snapshot) || {};
  const url = canonicalUrl(snapshot.url);
  const selected = snapshot.selectedVariant || [];
  const requestedSku =
    new URL(url).searchParams.get('skuId') ||
    new URL(url).pathname.match(/-s(\d+)\.html$/u)?.[1];
  const visibleSku = selected.find((entry) => entry.sku)?.sku || snapshot.sku;
  const sku = visibleSku || requestedSku || structured.sku;
  const identityUrl = productIdentityUrl(url);
  const skuNumber = (value) => String(value).split('_VNAMZ-').at(-1);
  const requestedVariantMatches =
    !requestedSku ||
    !visibleSku ||
    skuNumber(requestedSku) === skuNumber(visibleSku);
  const title = normalizeText(snapshot.title || structured.name);
  const id = `product:${sha256(`${identityUrl}:${sku || ''}`)}`;
  const nutrition = extractNutrition(
    [
      snapshot.description || '',
      ...(snapshot.specs || []),
      snapshot.rawText || '',
    ].join('\n')
  );
  const {
    weight,
    packCount,
    category,
    volume,
    packCountExcerpt,
    quantityFields,
    quantityWarnings,
    weightEvidence,
  } = selectedAmounts(
    selected,
    title,
    nutrition,
    snapshot.description,
    snapshot.specs || []
  );
  const amountExcerpts = {
    ...nutrition.excerpts,
    packCount: packCountExcerpt,
    netMassG: weightEvidence.selected?.context,
  };
  const ingredients = nutrition.fields.ingredients || [];
  const marketplaceId = new URL(url).pathname.match(/-i(\d+)/u)?.[1];
  const manufacturerSku =
    structured.mpn && String(structured.mpn) !== marketplaceId
      ? String(structured.mpn)
      : undefined;
  const product = {
    id,
    url,
    market,
    title,
    category,
    brand: normalizeText(
      snapshot.brand ||
        (typeof structured.brand === 'object'
          ? structured.brand?.name
          : structured.brand) ||
        ''
    ),
    ...(sku ? { sku: String(sku) } : {}),
    ...(manufacturerSku ? { manufacturerSku } : {}),
    ...(structured.gtin13 ||
    structured.gtin14 ||
    structured.gtin12 ||
    structured.gtin
      ? {
          gtin: String(
            structured.gtin13 ||
              structured.gtin14 ||
              structured.gtin12 ||
              structured.gtin
          ),
        }
      : {}),
    ...nutrition.fields,
    ...(volume ? { netVolumeMl: volume } : {}),
    netMassG: weight,
    ...(packCount ? { packCount } : {}),
    ...quantityFields,
    ingredients,
    proteinType: proteinTypeOf(ingredients, category),
    ingredientFlags: ingredientFlags(ingredients),
    evidenceIds: [evidenceId].filter(Boolean),
    claims: [],
    massEvidence: weightEvidence,
    warnings: [
      ...nutrition.warnings,
      ...quantityWarnings,
      ...(weightEvidence.conflicting
        ? ['Conflicting selected selling-unit metric masses require review']
        : []),
    ],
    variants: snapshot.variants || [],
    selectedVariant: selected,
    observedAt,
  };
  appendAmountClaims(product, {
    fields: {
      ...nutrition.fields,
      ...(weight ? { netMassG: weight } : {}),
      ...(volume ? { netVolumeMl: volume } : {}),
      ...(packCount ? { packCount } : {}),
    },
    weightEvidence,
    amountExcerpts,
    title,
    evidenceId,
    source,
  });
  const rawOffer = Array.isArray(structured.offers)
    ? structured.offers.length === 1
      ? structured.offers[0]
      : {}
    : structured.offers || {};
  const priceCurrency = rawOffer.priceCurrency || currency;
  const price = snapshot.priceText
    ? parsePrice(snapshot.priceText, priceCurrency)
    : Number(rawOffer.price);
  const variantConfirmed =
    requestedVariantMatches &&
    !(snapshot.variants?.length > 1 && !sku && !selected.length);
  const offer = {
    id: `offer:${sha256(`${identityUrl}:${sku || ''}:${snapshot.seller || ''}`)}`,
    productId: id,
    url,
    market,
    currency: priceCurrency,
    seller: snapshot.seller || rawOffer.seller?.name || 'unknown',
    ...(Number.isFinite(price) && price > 0 ? { price } : {}),
    ...saleDetails(snapshot, price, priceCurrency),
    promotions: (snapshot.promotions || []).map((promotion) => ({
      ...promotion,
      evidenceId,
      observedAt,
      eligibilityConfirmed: false,
    })),
    variantConfirmed,
    priceScope: variantConfirmed ? 'observed-variant' : 'unknown-variant',
    available:
      snapshot.available ??
      (/OutOfStock|SoldOut|Discontinued/iu.test(rawOffer.availability || '') ||
      /hết hàng|out of stock/iu.test(snapshot.rawText || '')
        ? false
        : true),
    // Shipping is deliberately unknown until observed for the delivery area.
    observedAt,
    evidenceId,
    ...(sku ? { sku: String(sku) } : {}),
  };
  for (const field of ['minQuantity', 'maxQuantity']) {
    const catalog = snapshot.skuCatalog?.find(
      (entry) => skuNumber(entry.sku) === skuNumber(sku)
    );
    const limits = [snapshot[field], catalog?.[field]].filter(
      (value) => Number.isSafeInteger(value) && value > 0
    );
    if (limits.length) {
      offer[field] =
        field === 'minQuantity' ? Math.max(...limits) : Math.min(...limits);
    }
  }
  if (!variantConfirmed) {
    product.warnings.push('Listing price is not tied to a confirmed variant');
  }
  if (!requestedVariantMatches) {
    product.warnings.push(
      'The page selected a different SKU from the requested URL'
    );
  }
  return applyFoodOfferDiscovery(snapshot, {
    product: applyPackageMassConsistency(product),
    offer,
    evidenceId,
    observedAt,
    originalHtmlSha256,
  });
}

const NUMERIC_PRODUCT_FIELDS = [
  'netMassG',
  'netVolumeMl',
  'packCount',
  'servingMassG',
  'proteinPer100g',
  'proteinPer100ml',
  'proteinPerPackageG',
  'sugarPer100ml',
  'fatPer100ml',
  'saturatedFatPer100ml',
  'kcalPer100ml',
  'sugarPer100g',
  'fatPer100g',
  'saturatedFatPer100g',
  'kcalPer100g',
];

export function validateProduct(input) {
  const product = clone(input);
  if (
    !product.id ||
    !product.title ||
    !['whey', 'protein-powder', 'chocolate-ice-cream', 'unknown'].includes(
      product.category
    )
  ) {
    throw new Error('Product requires id, title and a supported category');
  }
  product.url = canonicalUrl(product.url);
  if (
    product.packageCountUnresolved !== undefined &&
    typeof product.packageCountUnresolved !== 'boolean'
  ) {
    throw new Error('packageCountUnresolved must be a boolean');
  }
  for (const field of NUMERIC_PRODUCT_FIELDS) {
    if (product[field] !== undefined) {
      positive(product[field], field, {
        zero: ![
          'netMassG',
          'netVolumeMl',
          'packCount',
          'servingMassG',
        ].includes(field),
        integer: field === 'packCount',
      });
      if (
        field.endsWith('Per100g') &&
        product[field] > (field === 'kcalPer100g' ? 1000 : 100)
      ) {
        throw new Error(`Implausible ${field}`);
      }
    }
  }
  if (
    product.ingredients !== undefined &&
    (!Array.isArray(product.ingredients) ||
      product.ingredients.some((item) => typeof item !== 'string'))
  ) {
    throw new Error('ingredients must be a string array');
  }
  product.ingredients ||= [];
  product.claims ||= [];
  product.evidenceIds ||= [];
  resolvePackageCountReview(product);
  product.proteinType = proteinTypeOf(product.ingredients, product.category);
  product.ingredientFlags = ingredientFlags(product.ingredients);
  return product;
}

function componentObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function componentJson(value, label, seen = new Set(), depth = 0) {
  if (depth > 32 || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new TypeError(`${label} must contain finite JSON values`);
  }
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== 'object') {
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`${label} must contain JSON values`);
    }
    return;
  }
  if (seen.has(value)) {
    throw new TypeError(`${label} must not contain circular references`);
  }
  if (!Array.isArray(value)) {
    componentObject(value, label);
  }
  seen.add(value);
  for (const [field, child] of Object.entries(value)) {
    componentJson(child, `${label}.${field}`, seen, depth + 1);
  }
  seen.delete(value);
}

function componentIdentifier(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  ) {
    throw new TypeError(`${label} must be a nonempty stable string identifier`);
  }
}

function componentTypedFields(record, fields, type, label) {
  for (const field of fields) {
    if (record[field] !== undefined && typeof record[field] !== type) {
      throw new TypeError(`${label}.${field} must be a ${type}`);
    }
  }
}

function componentEvidence(record, label) {
  componentTypedFields(
    record,
    [
      'sourceUrl',
      'sourceSha256',
      'evidenceId',
      'excerpt',
      'reviewedBy',
      'reviewedAt',
    ],
    'string',
    label
  );
  componentTypedFields(
    record,
    ['identityMatched', 'invalidated'],
    'boolean',
    label
  );
}

function componentFacts(facts, label, eligibility = false) {
  componentObject(facts, label);
  const units = {
    netMassG: 'g',
    netVolumeMl: 'ml',
    proteinPer100g: 'g/100g',
    proteinPer100ml: 'g/100ml',
    proteinPerPackageG: 'g/package',
  };
  for (const [field, fact] of Object.entries(facts)) {
    const path = `${label}.${field}`;
    componentObject(fact, path);
    componentEvidence(fact, path);
    componentTypedFields(
      fact,
      ['unit', 'basis', 'valueExcerpt', 'basisExcerpt', 'sourceUnit'],
      'string',
      path
    );
    for (const valueField of ['value', 'sourceValue']) {
      if (fact[valueField] !== undefined) {
        positive(fact[valueField], `${path}.${valueField}`, { zero: true });
      }
    }
    const unit = eligibility ? 'count' : units[field];
    if (unit && fact.unit !== undefined && fact.unit !== unit) {
      throw new TypeError(`${path}.unit must be ${unit}`);
    }
    if (
      eligibility &&
      fact.value !== undefined &&
      !Number.isSafeInteger(fact.value)
    ) {
      throw new TypeError(`${path}.value must be a safe integer count`);
    }
  }
}

function componentProduct(product, label) {
  componentObject(product, label);
  componentTypedFields(
    product,
    ['id', 'title', 'url', 'brand', 'category', 'market'],
    'string',
    label
  );
  for (const field of ['ingredients', 'evidenceIds']) {
    if (
      product[field] !== undefined &&
      (!Array.isArray(product[field]) ||
        [...product[field]].some((value) => typeof value !== 'string'))
    ) {
      throw new TypeError(`${label}.${field} must be a string array`);
    }
  }
  if (
    product.claims !== undefined &&
    (!Array.isArray(product.claims) ||
      [...product.claims].some(
        (claim) => !claim || typeof claim !== 'object' || Array.isArray(claim)
      ))
  ) {
    throw new TypeError(`${label}.claims must be an object array`);
  }
  if (product.manufacturerVerification !== undefined) {
    componentObject(
      product.manufacturerVerification,
      `${label}.manufacturerVerification`
    );
    componentEvidence(
      product.manufacturerVerification,
      `${label}.manufacturerVerification`
    );
  }
  for (const field of NUMERIC_PRODUCT_FIELDS) {
    if (product[field] !== undefined) {
      positive(product[field], `${label}.${field}`, {
        zero: ![
          'netMassG',
          'netVolumeMl',
          'packCount',
          'servingMassG',
        ].includes(field),
        integer: field === 'packCount',
      });
    }
  }
}

function componentIdentity(identity, label) {
  componentObject(identity, label);
  componentTypedFields(
    identity,
    [
      'brand',
      'name',
      'flavour',
      'market',
      'packageType',
      'formulaRevision',
      'gtin',
      'variantCode',
    ],
    'string',
    label
  );
  componentTypedFields(identity, ['currentFormula'], 'boolean', label);
  for (const field of ['netMassG', 'netVolumeMl', 'innerPackCount']) {
    if (identity[field] !== undefined) {
      positive(identity[field], `${label}.${field}`, {
        integer: field === 'innerPackCount',
      });
    }
  }
}

function componentEligibility(eligibility, label) {
  componentObject(eligibility, label);
  for (const field of ['allocationId', 'offerId']) {
    if (eligibility[field] !== undefined) {
      componentIdentifier(eligibility[field], `${label}.${field}`);
    }
  }
  if (eligibility.sku !== undefined) {
    if (typeof eligibility.sku === 'number') {
      positive(eligibility.sku, `${label}.sku`, { integer: true });
    } else {
      componentIdentifier(eligibility.sku, `${label}.sku`);
    }
  }
  componentTypedFields(
    eligibility,
    ['confirmed', 'available', 'conditionsComplete', 'conditionsSatisfied'],
    'boolean',
    label
  );
  componentTypedFields(eligibility, ['observedAt'], 'string', label);
  for (const field of [
    'orderQuantity',
    'units',
    'minOrderQuantity',
    'maxOrderQuantity',
    'stockUnits',
    'maxUnitsPerOrder',
  ]) {
    if (eligibility[field] !== undefined) {
      positive(eligibility[field], `${label}.${field}`, {
        integer: true,
        zero: field === 'stockUnits',
      });
    }
  }
  if (eligibility.claims !== undefined) {
    componentFacts(eligibility.claims, `${label}.claims`, true);
  }
}

function componentRecord(component, label) {
  componentObject(component, label);
  componentJson(component, label);
  componentIdentifier(component.id, `${label}.id`);
  if (!['paid-food', 'bonus-food', 'non-food'].includes(component.kind)) {
    throw new TypeError(
      `${label}.kind must be paid-food, bonus-food or non-food`
    );
  }
  if (component.kind === 'paid-food') {
    componentIdentifier(component.productId, `${label}.productId`);
    positive(component.unitsPerSellingUnit, `${label}.unitsPerSellingUnit`, {
      integer: true,
    });
  }
  const nested = {
    product: componentProduct,
    identity: componentIdentity,
    sourceIdentity: componentIdentity,
    eligibility: componentEligibility,
    facts: componentFacts,
  };
  for (const [field, validate] of Object.entries(nested)) {
    if (component[field] !== undefined) {
      validate(component[field], `${label}.${field}`);
    }
  }
  if (component.review !== undefined) {
    componentObject(component.review, `${label}.review`);
    componentEvidence(component.review, `${label}.review`);
  }
  if (component.evidenceIds !== undefined) {
    if (!Array.isArray(component.evidenceIds)) {
      throw new TypeError(`${label}.evidenceIds must be an array`);
    }
    for (const id of component.evidenceIds) {
      componentIdentifier(id, `${label}.evidenceIds`);
    }
  }
}

function validatedFoodComponents(components) {
  if (!Array.isArray(components) || components.length > 100) {
    throw new TypeError(
      'foodComponents must contain at most100 component records'
    );
  }
  const records = new Map();
  for (const [index, component] of components.entries()) {
    componentRecord(component, `foodComponents[${index}]`);
    const record = clone(component);
    if (
      records.has(record.id) &&
      !isDeepStrictEqual(records.get(record.id), record)
    ) {
      throw new TypeError(`Conflicting food component ID: ${record.id}`);
    }
    records.set(record.id, record);
  }
  return [...records.values()];
}

export function validateOffer(input) {
  const foodComponents =
    input.foodComponents === undefined
      ? undefined
      : validatedFoodComponents(input.foodComponents);
  const offer = clone(input);
  if (foodComponents !== undefined) {
    offer.foodComponents = foodComponents;
  }
  if (
    !offer.id ||
    !offer.productId ||
    !/^[A-Z]{3}$/u.test(offer.currency || '')
  ) {
    throw new Error('Offer requires id, productId and ISO currency');
  }
  offer.url = canonicalUrl(offer.url);
  if (offer.price !== undefined) {
    positive(offer.price, 'price');
  }
  for (const field of [
    'shipping',
    'discount',
    'stock',
    'minQuantity',
    'maxQuantity',
    'shippingQuantity',
  ]) {
    if (offer[field] !== undefined) {
      positive(offer[field], field, {
        zero: ['shipping', 'discount', 'stock'].includes(field),
        integer: [
          'stock',
          'minQuantity',
          'maxQuantity',
          'shippingQuantity',
        ].includes(field),
      });
    }
  }
  if (!Number.isFinite(Date.parse(offer.observedAt))) {
    throw new Error('Offer requires an observedAt timestamp');
  }
  if (
    offer.quoteObservedAt !== undefined &&
    (!Number.isFinite(Date.parse(offer.quoteObservedAt)) ||
      Date.parse(offer.quoteObservedAt) > Date.now() + 60000)
  ) {
    throw new Error('Quote requires a valid observation timestamp');
  }
  for (const field of [
    'available',
    'variantConfirmed',
    'coldChainConfirmed',
    'deliveryAvailable',
  ]) {
    if (offer[field] !== undefined && typeof offer[field] !== 'boolean') {
      throw new Error(`${field} must be a boolean`);
    }
  }
  for (const tier of offer.bulkTiers || []) {
    positive(tier.minQuantity, 'bulk minQuantity', { integer: true });
    positive(tier.unitPrice, 'bulk unitPrice');
  }
  return offer;
}
