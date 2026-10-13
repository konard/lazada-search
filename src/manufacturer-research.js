import { fold, sha256 } from './util.js';
import { ManufacturerSourceCache } from './manufacturer-source-cache.js';
import { parseHTML } from 'linkedom';
import { splitIngredients } from './nutrition.js';
import { verifyOriginalBoundOcr } from './ocr-evidence.js';
import { productFlavour } from './flavour-scope.js';

const IDENTITY_FIELDS = ['brand', 'name', 'flavour', 'market', 'packageType'];
const QUANTITY_FIELDS = ['netMassG', 'netVolumeMl', 'innerPackCount'];
const UNITS = {
  netMassG: 'g',
  netVolumeMl: 'ml',
  proteinPer100g: 'g/100g',
  proteinPer100ml: 'g/100ml',
  proteinPerPackageG: 'g/package',
  fatPer100g: 'g/100g',
  fatPer100ml: 'g/100ml',
  saturatedFatPer100g: 'g/100g',
  saturatedFatPer100ml: 'g/100ml',
  carbohydratePer100g: 'g/100g',
  carbohydratePer100ml: 'g/100ml',
  sugarPer100g: 'g/100g',
  sugarPer100ml: 'g/100ml',
  kcalPer100g: 'kcal/100g',
  kcalPer100ml: 'kcal/100ml',
  ingredients: 'text',
};

function same(left, right) {
  return typeof left === 'string'
    ? Boolean(fold(left)) && fold(left) === fold(right)
    : left === right;
}

function exactIdentifier(listing, manufacturer) {
  if (listing.gtin && manufacturer.gtin) {
    return same(listing.gtin, manufacturer.gtin);
  }
  return Boolean(
    listing.variantCode &&
    manufacturer.variantCode &&
    same(listing.variantCode, manufacturer.variantCode)
  );
}

export function manufacturerIdentityGaps(listing = {}, manufacturer = {}) {
  const gaps = requiredIdentityGaps(listing, manufacturer);
  if (!exactIdentifier(listing, manufacturer)) {
    gaps.push('identity:gtin-or-manufacturer-variant-code');
  }
  gaps.push(...categoryFlavourGaps(listing, manufacturer));
  gaps.push(...knownIdentityConflicts(listing, manufacturer));
  if (manufacturer.currentFormula !== true) {
    gaps.push('current-formula-unconfirmed');
  }
  return gaps;
}

function categoryFlavourGaps(listing, manufacturer) {
  if (listing.category === 'whey') {
    const allowed = new Set(['chocolate', 'unflavoured']);
    const flavours = [listing, manufacturer].map((item) =>
      productFlavour({ category: 'whey', title: item.flavour })
    );
    return manufacturer.category === 'whey' &&
      flavours.every((flavour) => allowed.has(flavour))
      ? []
      : ['whey-category-or-flavour-unconfirmed'];
  }
  const gaps = [];
  if (
    listing.category &&
    manufacturer.category &&
    listing.category !== manufacturer.category
  ) {
    gaps.push('identity:category');
  }
  if (
    listing.coreFlavour !== 'chocolate' ||
    manufacturer.coreFlavour !== 'chocolate'
  ) {
    gaps.push('strict-chocolate-core-unconfirmed');
  }
  return gaps;
}

function requiredIdentityGaps(listing, manufacturer) {
  return IDENTITY_FIELDS.filter(
    (field) =>
      typeof listing[field] !== 'string' ||
      typeof manufacturer[field] !== 'string' ||
      !same(listing[field], manufacturer[field])
  ).map((field) => `identity:${field}`);
}

function knownIdentityConflicts(listing, manufacturer) {
  const fields = [...QUANTITY_FIELDS, 'gtin', 'variantCode', 'formulaRevision'];
  return fields
    .filter(
      (field) =>
        listing[field] !== undefined &&
        manufacturer[field] !== undefined &&
        !same(listing[field], manufacturer[field])
    )
    .map((field) => `identity-conflict:${field}`);
}

function claimShape(field, claim) {
  if (!UNITS[field] || claim.unit !== UNITS[field]) {
    throw new Error(`Unsupported manufacturer fact or unit: ${field}`);
  }
  if (!claim.excerpt?.trim() || !claim.basis?.trim()) {
    throw new Error(
      `Manufacturer fact requires an excerpt and explicit basis: ${field}`
    );
  }
  if (field === 'ingredients') {
    if (
      !Array.isArray(claim.value) ||
      !claim.value.length ||
      claim.value.some(
        (ingredient) => typeof ingredient !== 'string' || !ingredient.trim()
      )
    ) {
      throw new Error(
        'Ingredients require a nonempty array of original label entries'
      );
    }
    return;
  }
  if (!Number.isFinite(claim.value) || claim.value < 0) {
    throw new Error(
      `Manufacturer fact must be a nonnegative finite value: ${field}`
    );
  }
  if (['netMassG', 'netVolumeMl'].includes(field) && claim.value <= 0) {
    throw new Error('Net package quantities must be positive');
  }
}

function originalText(source, bytes) {
  if (/json/iu.test(source.contentType || '')) {
    return `${bytes.toString('utf8')} ${JSON.stringify(JSON.parse(bytes.toString('utf8')))}`;
  }
  if (/html/iu.test(source.contentType || '')) {
    const spaced = bytes
      .toString('utf8')
      .replace(/<\/(?:td|th|tr|p|div)>|<br\s*\/?>/giu, ' $&');
    const { document } = parseHTML(`<html><body>${spaced}</body></html>`);
    for (const element of document.querySelectorAll('script, style')) {
      element.remove();
    }
    return document.body.textContent;
  }
  if (/^text\//iu.test(source.contentType || '')) {
    return bytes.toString('utf8');
  }
  throw new Error(
    'This source needs SHA-bound OCR or extracted text before reviewing facts'
  );
}

async function claimText(store, source, claim, bytes) {
  if (source.kind !== 'label') {
    return originalText(source, bytes);
  }
  const ocr = await store.get('ocr', claim.ocrId);
  return (await verifyOriginalBoundOcr(store, source.blob, ocr)).text;
}

function supportedValue(field, claim) {
  if (field === 'ingredients') {
    const entries = splitIngredients(
      claim.excerpt.replace(/^(?:ingredients?|thành phần)\s*:\s*/iu, '')
    );
    if (
      JSON.stringify(entries.map(fold)) !==
      JSON.stringify(claim.value.map(fold))
    ) {
      throw new Error(
        'Ingredient entries must match the complete reviewed original excerpt'
      );
    }
    return;
  }
  if (
    !claim.valueExcerpt?.trim() ||
    !fold(claim.excerpt).includes(fold(claim.valueExcerpt))
  ) {
    throw new Error('A numeric claim requires its original value excerpt');
  }
  const value = claim.sourceValue ?? claim.value;
  const numbers = claim.valueExcerpt.match(/\d+(?:[.,]\d+)?/gu) || [];
  if (numbers.length !== 1 || Number(numbers[0].replace(',', '.')) !== value) {
    throw new Error(
      'Reviewed number does not appear in its original value excerpt'
    );
  }
  supportedQuantity(field, claim, value);
}

function supportedQuantity(field, claim, value) {
  if (['netMassG', 'netVolumeMl'].includes(field)) {
    const conversions =
      field === 'netMassG' ? { g: 1, kg: 1000 } : { ml: 1, L: 1000 };
    const unit = claim.sourceUnit || claim.unit;
    if (!conversions[unit] || value * conversions[unit] !== claim.value) {
      throw new Error(
        'Reviewed quantity requires an exact supported unit conversion'
      );
    }
    if (
      !new RegExp(`(?<![\\p{L}])${unit}\\b`, 'iu').test(
        claim.unitExcerpt || claim.valueExcerpt
      )
    ) {
      throw new Error(
        'Source quantity unit must appear in the original value or unit excerpt'
      );
    }
  } else if (value !== claim.value) {
    throw new Error(
      'Nutrition claims cannot infer a different quantity from the source'
    );
  }
}

function exactSinglePackage(identity) {
  const packages = [identity.listing, identity.manufacturer, identity.source];
  return (
    packages.every((item) => item?.innerPackCount === 1) &&
    ['netMassG', 'netVolumeMl'].some((field) =>
      packages.every(
        (item) =>
          Number.isFinite(item[field]) &&
          item[field] > 0 &&
          item[field] === packages[0][field]
      )
    )
  );
}

function directPackageBasis(text, basis) {
  const explicitPackage =
    /\bper\s+(?:(?:one|1|a|whole|entire)\s+)?(?:package|pack|pint|tub|bottle|container|can|unit)\b|\bmoi\s+(?:(?:mot|1)\s+)?(?:goi|hop|chai|coc|ly|don vi)\b|\btren\s+(?:mot|1)\s+(?:goi|hop|chai|coc|ly|don vi)\b/gu;
  for (const match of basis.matchAll(explicitPackage)) {
    for (
      let at = text.indexOf(basis);
      at >= 0;
      at = text.indexOf(basis, at + basis.length)
    ) {
      const position = at + match.index;
      const prefix = text.slice(Math.max(0, position - 48), position);
      if (
        !/(?:servings?|portions?|scoops?|sajian|khau phan)\s*$/u.test(prefix)
      ) {
        return true;
      }
    }
  }
  return false;
}

function supportedPackageBasis(claim, text, identity) {
  const basis = fold(claim.basisExcerpt || '');
  const otherBasis =
    /\b(?:per|moi|tren)\s*(?:100\s*(?:g|ml)\b|(?:one\s+|1\s+|a\s+)?(?:serving|portion|scoop|khau phan)\b)/u;
  if (
    !basis ||
    !fold(text).includes(basis) ||
    !fold(claim.excerpt).includes(basis) ||
    !directPackageBasis(fold(text), basis) ||
    otherBasis.test(basis)
  ) {
    throw new Error(
      'Package nutrition basis must be explicitly stated in its original source excerpt'
    );
  }
  if (
    (claim.sourceUnit && claim.sourceUnit !== 'g') ||
    !/(?<![\p{L}])g\b/iu.test(claim.unitExcerpt || claim.valueExcerpt)
  ) {
    throw new Error('Package protein requires the original gram unit');
  }
  if (!exactSinglePackage(identity)) {
    throw new Error(
      'Package protein requires an exact matched single-inner-package quantity'
    );
  }
}

function supportedBasis(field, claim, text, identity) {
  if (field === 'proteinPerPackageG') {
    supportedPackageBasis(claim, text, identity);
    return;
  }
  if (!/Per100(?:g|ml)$/u.test(field)) {
    return;
  }
  const unit = field.endsWith('ml') ? 'ml' : 'g';
  if (
    !claim.basisExcerpt ||
    !fold(text).includes(fold(claim.basisExcerpt)) ||
    !new RegExp(`(?<!\\d)100\\s*${unit}\\b`, 'iu').test(claim.basisExcerpt)
  ) {
    throw new Error('Nutrition basis must be stated in the original source');
  }
}

async function validateClaimOriginal(
  store,
  source,
  claim,
  field,
  bytes,
  identity
) {
  const text = await claimText(store, source, claim, bytes);
  if (!fold(text).includes(fold(claim.excerpt))) {
    throw new Error(
      'Reviewed excerpt is not present in the original source text'
    );
  }
  if (claim.unitExcerpt && !fold(text).includes(fold(claim.unitExcerpt))) {
    throw new Error(
      'Reviewed unit excerpt is not present in the original source text'
    );
  }
  supportedValue(field, claim);
  supportedBasis(field, claim, text, identity);
}

/** Validate a proposed fact against preserved bytes without granting authority. */
export async function validateManufacturerOriginalFact(
  store,
  source,
  claim,
  { field = claim.field, identity } = {}
) {
  claimShape(field, claim);
  const bytes = await store.blob(source.blob.sha256);
  if (
    !bytes ||
    sha256(bytes) !== source.blob.sha256 ||
    bytes.length !== source.blob.bytes ||
    claim.sourceSha256 !== source.blob.sha256
  ) {
    throw new Error(
      'Reviewed fact no longer matches its original source bytes'
    );
  }
  await validateClaimOriginal(store, source, claim, field, bytes, identity);
}

function strictChocolateEligibility(identity) {
  if (identity?.listing?.category === 'whey') {
    return null;
  }
  const cores = [
    identity?.listing?.coreFlavour,
    identity?.manufacturer?.coreFlavour,
  ];
  if (cores.some((core) => core && core !== 'chocolate')) {
    return false;
  }
  return cores.every((core) => core === 'chocolate') ? true : null;
}

async function verifiedClaim(store, review, field, claim) {
  claimShape(field, claim);
  const source = await store.get('manufacturer-source', claim.sourceId);
  if (
    source?.status !== 'captured' ||
    source.authority !== 'manufacturer' ||
    source.brand !== review.identity.manufacturer.brand
  ) {
    throw new Error(
      'A manufacturer fact requires captured primary evidence for this brand'
    );
  }
  if (claim.sourceSha256 !== source.blob.sha256) {
    throw new Error('Reviewed fact SHA-256 does not match original source');
  }
  if (!review.sourceIdentities?.[source.id]) {
    throw new Error('Every claimed source needs its own exact identity review');
  }
  const sourceGaps = manufacturerIdentityGaps(
    review.identity.listing,
    review.sourceIdentities[source.id]
  );
  if (sourceGaps.length) {
    throw new Error(
      `Claimed source identity is incomplete: ${sourceGaps.join(', ')}`
    );
  }
  const bytes = await store.blob(source.blob.sha256);
  if (!bytes || sha256(bytes) !== claim.sourceSha256) {
    throw new Error(
      'Reviewed original source bytes are unavailable or corrupt'
    );
  }
  await validateClaimOriginal(store, source, claim, field, bytes, {
    ...review.identity,
    source: review.sourceIdentities[source.id],
  });
  const quantity = review.identity.manufacturer[field];
  if (['netMassG', 'netVolumeMl'].includes(field) && quantity !== claim.value) {
    throw new Error('Quantity fact conflicts with the exact reviewed package');
  }
  return {
    ...claim,
    sourceUrl: source.finalUrl,
    sourceSha256: source.blob.sha256,
    identityMatched: true,
    authority: 'manufacturer',
    sourceAuthority: 'manufacturer',
  };
}

function researchReviewResult(review, gaps) {
  return {
    id:
      review.id ||
      `manufacturer-research-review:${sha256(JSON.stringify(review))}`,
    reviewedBy: review.reviewedBy,
    reason: review.reason,
    skus: review.skus || [],
    identity: review.identity,
    identityMatched: gaps.length === 0,
    strictChocolateEligible: strictChocolateEligibility(review.identity),
    facts: {},
    blockingEvidenceGaps: gaps,
    withheldFacts: Object.keys(review.facts || {}),
  };
}

export async function reviewManufacturerResearch(store, review) {
  if (!review.reviewedBy?.trim() || !review.reason?.trim()) {
    throw new Error(
      'Manufacturer review requires a reviewer and matching rationale'
    );
  }
  const gaps = manufacturerIdentityGaps(
    review.identity?.listing,
    review.identity?.manufacturer
  );
  const result = researchReviewResult(review, gaps);
  if (!gaps.length) {
    for (const [field, claim] of Object.entries(review.facts || {})) {
      result.facts[field] = await verifiedClaim(store, review, field, claim);
    }
    result.withheldFacts = [];
  }
  for (const field of review.requiredFields || []) {
    if (!result.facts[field]) {
      result.blockingEvidenceGaps.push(`missing-current-fact:${field}`);
    }
  }
  return await store.put('manufacturer-research-review', result);
}

function researchOcrPasses(request) {
  const passes = request.ocrPasses || [{}];
  if (
    !Array.isArray(passes) ||
    !passes.length ||
    passes.length > 8 ||
    passes.some(
      (pass) => !pass || typeof pass !== 'object' || Array.isArray(pass)
    )
  ) {
    throw new Error('Label research supports one to eight OCR passes');
  }
  return passes;
}

export class ManufacturerResearch {
  constructor(options) {
    this.sources = new ManufacturerSourceCache(options);
    this.store = options.store;
    this.ocr = options.ocr || false;
  }

  async run(plan) {
    const report = {
      id: plan.id || `manufacturer-research:${sha256(JSON.stringify(plan))}`,
      status: 'draft-requires-exact-identity-review',
      sources: [],
      labelCandidates: [],
      ocr: [],
      failures: [],
      reviews: [],
    };
    for (const request of plan.sources || []) {
      try {
        const passes = researchOcrPasses(request);
        const source = await this.sources.capture(request);
        report.sources.push(source);
        report.labelCandidates.push(...(await this.sources.images(source.id)));
        if (source.status !== 'captured') {
          report.failures.push({ sourceId: source.id, error: source.error });
        } else if (source.kind === 'label' && this.ocr) {
          for (const pass of passes) {
            report.ocr.push({
              sourceId: source.id,
              ...(await this.ocr.recognize(source.blob, pass)),
            });
          }
        }
      } catch (error) {
        report.failures.push({ url: request.url, error: error.message });
        if (error.code === 'COLLECTION_STOPPED') {
          report.status = 'stopped-security-challenge';
          report.cache = { ...this.sources.cache.stats };
          await this.store.put('manufacturer-research', report);
          throw error;
        }
      }
    }
    for (const review of plan.reviews || []) {
      report.reviews.push(await reviewManufacturerResearch(this.store, review));
    }
    report.cache = { ...this.sources.cache.stats };
    return await this.store.put('manufacturer-research', report);
  }
}
