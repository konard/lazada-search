import { catalogProducts } from './catalog-products.js';
import { manufacturerCandidates } from './manufacturers.js';
import { productFlavour, isShakerBundle } from './flavour-scope.js';
import { specificationProblems } from './verification.js';
import { canonicalUrl, sha256 } from './util.js';

const NUTRIENTS = ['protein', 'sugar', 'fat', 'saturatedFat', 'kcal'];
const IDENTITY_FIELDS = [
  'brand',
  'name',
  'flavour',
  'market',
  'packageType',
  'formulaRevision',
  'gtin',
  'variantCode',
];

export function workflowProductFingerprint(product) {
  return sha256(
    JSON.stringify({
      id: product.id,
      sku: product.sku,
      url: canonicalUrl(product.url),
      observedAt: product.observedAt,
      category: product.category,
      selected: (product.selectedVariant || [])
        .filter((entry) => entry.selected !== false)
        .map((entry) => entry.text)
        .sort(),
      evidenceIds: [...(product.evidenceIds || [])].sort(),
    })
  );
}

function scopedProduct(product) {
  if (isShakerBundle(product)) {
    return false;
  }
  const flavour = productFlavour(product);
  return (
    (product.category === 'whey' &&
      ['chocolate', 'unflavoured'].includes(flavour)) ||
    (product.category === 'chocolate-ice-cream' && flavour === 'chocolate')
  );
}

function pendingField(product, field) {
  return (
    product.pendingSpecificationReview?.includes(field) ||
    product.pendingSpecificationReview?.includes('packCount') ||
    product.specificationsInvalidated === true ||
    product.specificationHolds?.some(
      (hold) =>
        hold.active !== false && [field, 'packCount'].includes(hold.field)
    )
  );
}

function quantityGaps(product) {
  const fields =
    product.category === 'chocolate-ice-cream'
      ? ['netMassG', 'netVolumeMl']
      : ['netMassG'];
  return fields.filter(
    (field) => !(product[field] > 0) || pendingField(product, field)
  );
}

function nutritionGaps(product) {
  const suffixes =
    product.category === 'chocolate-ice-cream' ? ['100g', '100ml'] : ['100g'];
  const gaps = NUTRIENTS.filter(
    (nutrient) =>
      !suffixes.some((suffix) => {
        const field = `${nutrient}Per${suffix}`;
        return Number.isFinite(product[field]) && !pendingField(product, field);
      }) && !(nutrient === 'protein' && product.proteinPerPackageG > 0)
  ).map((nutrient) => `${nutrient}:explicit-label-basis`);
  if (!product.ingredients?.length || pendingField(product, 'ingredients')) {
    gaps.push('ingredients:complete-original-label');
  }
  return gaps;
}

function productIdentity(product) {
  const exact = product.manufacturerVerification?.identity || {};
  const value = (field) => exact[field] ?? product[field] ?? null;
  return {
    ...Object.fromEntries(
      IDENTITY_FIELDS.map((field) => [field, value(field)])
    ),
    category: product.category,
    flavour: exact.flavour || productFlavour(product),
    coreFlavour:
      product.category === 'chocolate-ice-cream'
        ? exact.coreFlavour || null
        : null,
    netMassG: product.netMassG ?? null,
    netVolumeMl: product.netVolumeMl ?? null,
    innerPackCount: product.packCount ?? null,
    currentFormula: exact.currentFormula === true,
  };
}

function requiredOriginals(evidence) {
  return ['html', 'image', 'blob', 'screenshot']
    .filter((field) => /^[a-f\d]{64}$/u.test(evidence?.[field]?.sha256 || ''))
    .map((field) => ({
      evidenceId: evidence.id,
      role: evidence.role,
      url: evidence.url || null,
      kind: field,
      sha256: evidence[field].sha256,
      bytes: evidence[field].bytes ?? null,
      invalidated: Boolean(evidence.invalidated || evidence.invalidatedAt),
    }));
}

export async function buildLabelWorklist(application, options = {}) {
  const maxProducts = options.maxProducts ?? 50000;
  if (
    !Number.isSafeInteger(maxProducts) ||
    maxProducts < 1 ||
    maxProducts > 50000
  ) {
    throw new Error('Label worklist maxProducts must be between 1 and 50000');
  }
  const selected = options.productIds ? new Set(options.productIds) : null;
  const categories = new Set(
    options.categories || ['whey', 'chocolate-ice-cream']
  );
  const all = (await catalogProducts(application.store)).filter(
    (product) =>
      scopedProduct(product) &&
      categories.has(product.category) &&
      (!selected || selected.has(product.id))
  );
  const evidence = new Map();
  const items = [];
  for (const product of all.slice(0, maxProducts)) {
    const originals = [];
    for (const id of product.evidenceIds || []) {
      if (!evidence.has(id)) {
        evidence.set(id, application.store.get('evidence', id));
      }
      originals.push(...requiredOriginals(await evidence.get(id)));
    }
    const quantities = quantityGaps(product);
    const nutrients = nutritionGaps(product);
    const identity = productIdentity(product);
    const specifications = specificationProblems(product);
    items.push({
      id: `label-work:${workflowProductFingerprint(product)}`,
      productId: product.id,
      productFingerprint: workflowProductFingerprint(product),
      sku: product.sku,
      title: product.title,
      url: canonicalUrl(product.url),
      observedAt: product.observedAt,
      category: product.category,
      identity,
      quantityFields: quantities,
      nutritionFields: nutrients,
      identityFields: IDENTITY_FIELDS.filter((field) => !identity[field]),
      manufacturerRequired: specifications.length > 0,
      specificationProblems: specifications,
      candidates: manufacturerCandidates(
        product,
        application.manufacturerRegistry
      ),
      originals,
      status:
        quantities.length || nutrients.length || specifications.length
          ? 'unresolved'
          : 'already-reviewed',
      densityConversionAllowed: false,
      automaticApprovalAllowed: false,
    });
  }
  return {
    id:
      options.id ||
      `label-worklist:${sha256(JSON.stringify(items.map((item) => item.id)))}`,
    schemaVersion: 1,
    status:
      all.length > items.length ? 'bounded-partial-worklist' : 'draft-worklist',
    items,
    targetProducts: all.length,
    omittedProducts: all.length - items.length,
    missingRequestedProducts: [...(selected || [])].filter(
      (id) => !all.some((product) => product.id === id)
    ),
    marketCompletenessGuaranteed: false,
    createdAt: new Date().toISOString(),
  };
}

export function workflowSourceInvalidated(source, cacheRecords, invalidations) {
  if (source.invalidated || source.invalidatedAt) {
    return true;
  }
  const urls = new Set([source.url, source.finalUrl].filter(Boolean));
  const cache = cacheRecords.filter(
    (record) =>
      record.id === source.id ||
      record.id === source.cacheId ||
      (record.requestFingerprint &&
        record.requestFingerprint === source.requestFingerprint) ||
      urls.has(record.url)
  );
  const date = Date.parse(source.observedAt);
  return [
    ...cache,
    ...invalidations.filter(
      (record) =>
        urls.has(record.url) ||
        record.evidenceIds?.includes(source.id) ||
        record.sourceIds?.includes(source.id) ||
        record.cacheIds?.some(
          (id) =>
            id === source.cacheId || cache.some((entry) => entry.id === id)
        )
    ),
  ].some(
    (record) =>
      record.active !== false &&
      record.invalidated !== false &&
      !record.resolvedAt &&
      (record.invalidated === true ||
        (record.invalidatedAt &&
          (!Number.isFinite(date) || Date.parse(record.invalidatedAt) >= date)))
  );
}
