import {
  categoryOf,
  extractNutrition,
  ingredientFlags,
  massGrams,
  parsePrice,
  proteinTypeOf,
  volumeMillilitres,
} from './nutrition.js';
import {
  canonicalUrl,
  clone,
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

export function parseProduct(
  snapshot,
  {
    market = 'vn',
    currency = 'VND',
    evidenceId,
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
  const skuNumber = (value) => String(value).split('_VNAMZ-').at(-1);
  const requestedVariantMatches =
    !requestedSku ||
    !visibleSku ||
    skuNumber(requestedSku) === skuNumber(visibleSku);
  const title = normalizeText(snapshot.title || structured.name);
  const id = `product:${sha256(`${url}:${sku || ''}`)}`;
  const nutrition = extractNutrition(
    [
      snapshot.description || '',
      ...(snapshot.specs || []),
      snapshot.rawText || '',
    ].join('\n')
  );
  const weight =
    massGrams(selected.map((entry) => entry.text).join(' ')) ||
    nutrition.fields.netMassG ||
    massGrams(title);
  const ingredients = nutrition.fields.ingredients || [];
  const category = categoryOf(title);
  const volume =
    category === 'chocolate-ice-cream'
      ? nutrition.fields.netVolumeMl ||
        volumeMillilitres(selected.map((entry) => entry.text).join(' ')) ||
        volumeMillilitres(title)
      : nutrition.fields.netVolumeMl;
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
    ...(volume ? { netVolumeMl: volume } : {}),
    ...nutrition.fields,
    ...(weight ? { netMassG: weight } : {}),
    ingredients,
    proteinType: proteinTypeOf(ingredients, category),
    ingredientFlags: ingredientFlags(ingredients),
    evidenceIds: [evidenceId].filter(Boolean),
    claims: [],
    warnings: nutrition.warnings,
    variants: snapshot.variants || [],
    selectedVariant: selected,
    observedAt,
  };
  for (const [field, value] of Object.entries({
    ...nutrition.fields,
    ...(weight ? { netMassG: weight } : {}),
    ...(volume ? { netVolumeMl: volume } : {}),
  })) {
    product.claims.push({
      field,
      value,
      evidenceId,
      source,
      confidence: source === 'ocr' ? 0 : 1,
      requiresReview: source === 'ocr',
      excerpt: nutrition.excerpts[field] || title,
    });
  }
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
    id: `offer:${sha256(`${url}:${sku || ''}:${snapshot.seller || ''}`)}`,
    productId: id,
    url,
    market,
    currency: priceCurrency,
    seller: snapshot.seller || rawOffer.seller?.name || 'unknown',
    ...(Number.isFinite(price) && price > 0 ? { price } : {}),
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
    if (Number.isSafeInteger(snapshot[field]) && snapshot[field] > 0) {
      offer[field] = snapshot[field];
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
  return { product, offer };
}

const NUMERIC_PRODUCT_FIELDS = [
  'netMassG',
  'netVolumeMl',
  'packCount',
  'servingMassG',
  'proteinPer100g',
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
  product.proteinType = proteinTypeOf(product.ingredients, product.category);
  product.ingredientFlags = ingredientFlags(product.ingredients);
  return product;
}

export function validateOffer(input) {
  const offer = clone(input);
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
