import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LazadaSearch, specificationProblems } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (!options.offline || options.account || !options.dataDir) {
  throw new Error(
    'CGN review requires --offline and an explicit public --data-dir'
  );
}
const directory = 'docs/acceptance/urgent-whey-reviews/cgn-sources';
const output = 'docs/acceptance/urgent-whey-reviews';
const sourceBytes = await readFile(`${directory}/primary-web-source.json`);
const source = JSON.parse(sourceBytes);
const store = configuredStore(options);
const app = new LazadaSearch({ store, offline: true, maxImages: 2 });
const productId =
  'product:fb390ba4295fb7ba01aceac0ffc4bd024e5b508edb4a43eb670596bdf7d7955e';
const listingEvidenceId =
  'evidence:537f5a7060e24d35c07f456342103a0085100fc0cb3c8599922e4e5738935986';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  const listing = await store.get('product', productId);
  if (
    listing?.sku !== '2582378529_VNAMZ-12587822048' ||
    !listing.selectedVariant.some(
      (variant) => variant.text === 'Dark Chocolate'
    )
  ) {
    throw new Error('Selected CGN package identity changed');
  }
  const imageSources = [];
  for (const name of [
    'dark-chocolate-907g-back-original',
    'dark-chocolate-907g-front-original',
    'dark-chocolate-907g-back',
    'dark-chocolate-907g-front',
  ]) {
    const metadata = JSON.parse(
      await readFile(`${directory}/${name}-source.json`, 'utf8')
    );
    const bytes = await readFile(metadata.filename);
    if (!metadata.success || digest(bytes) !== metadata.sha256) {
      throw new Error(`Invalid original official image ${name}`);
    }
    const blob = await store.putBlob(bytes);
    await store.put('cache', {
      id: `image:${metadata.url}`,
      url: metadata.url,
      blob,
      contentType: metadata.contentType,
      fetchedAt: Date.parse(metadata.observedAt),
      checkedAt: Date.parse(metadata.observedAt),
      repositoryReusable: true,
      sourceCapture: metadata,
    });
    imageSources.push({ ...metadata, blob });
  }
  const document = await store.putBlob(sourceBytes);
  const snapshot = {
    url: source.retrievedUrl,
    title:
      'California Gold Nutrition Sport Whey Protein Isolate Dark Chocolate 907 g',
    brand: source.identity.brand,
    sku: source.identity.manufacturerProductCode,
    gtin: source.identity.gtin,
    description: 'One Dark Chocolate pouch, net food mass 907 g.',
    rawText:
      'California Gold Nutrition Sport Whey Protein Isolate Dark Chocolate 907 g. Manufacturer-owned brand source; original front and back labels retained.',
    selectedVariant: [{ text: 'Dark Chocolate', selected: true }],
    productImages: imageSources.map((image) => image.url),
  };
  // This is a factual JSON extraction, not captured HTML. The original label
  // bytes and source relationships are retained separately and checked above.
  const sourceDocument = {
    blob: document,
    format: 'json',
    method: source.method,
    originalProductHtmlCaptured: false,
    providerReportedCacheAge: source.providerReportedCacheAge,
    ownership: source.ownership,
    imageSources,
  };
  await store.put('cache', {
    id: `manufacturer:${source.url}`,
    url: source.url,
    finalUrl: source.retrievedUrl,
    status: 'ok',
    snapshot,
    sourceDocument,
    fetchedAt: Date.now(),
    checkedAt: Date.now(),
    repositoryReusable: true,
  });
  const check = await app.verify(productId, source.url);
  const official = await store.get('evidence', check.evidenceId);
  await store.put('evidence', { ...official, sourceDocument });
  const labelEvidence = (await store.list('evidence')).find(
    (evidence) =>
      evidence.role === 'ocr' &&
      evidence.url === imageSources[0].url &&
      evidence.image?.sha256 === imageSources[0].sha256
  );
  const frontEvidence = (await store.list('evidence')).find(
    (evidence) =>
      evidence.role === 'ocr' &&
      evidence.url === imageSources[1].url &&
      evidence.image?.sha256 === imageSources[1].sha256
  );
  if (!labelEvidence || !frontEvidence) {
    throw new Error(
      'Original official labels require successful local OCR evidence'
    );
  }
  const values = {
    servingMassG: 40,
    proteinPer100g: 67.5,
    sugarPer100g: 15,
    fatPer100g: 1.25,
    saturatedFatPer100g: 0,
    kcalPer100g: 375,
    ingredients: source.ingredients,
  };
  const excerpts = {
    servingMassG:
      'One scoop is 40 g; approximately 23 servings in a 907 g pouch.',
    proteinPer100g: '27 g protein per 40 g scoop.',
    sugarPer100g: '6 g total sugars per 40 g scoop.',
    fatPer100g: '0.5 g total fat per 40 g scoop.',
    saturatedFatPer100g: '0 g saturated fat per 40 g scoop.',
    kcalPer100g: '150 kcal per 40 g scoop.',
    ingredients:
      'Official complete ingredient list includes whey isolate, cane sugar, cocoa, natural flavors, sea salt, xanthan gum, sunflower lecithin and stevia.',
  };
  const identity = {
    brand: source.identity.brand,
    name: source.identity.name,
    flavour: source.identity.flavour,
    netMassG: 907,
    packCount: 1,
  };
  const review = {
    productId,
    evidenceId: check.evidenceId,
    listingEvidenceId,
    identity: { listing: identity, manufacturer: identity },
    reviewedBy: 'Codex visual review',
    reason:
      'Cached selected SKU 12587822048 front is California Gold Nutrition Sport Dark Chocolate Whey Protein Isolate, one 907 g pouch with 27 g protein. Official brand-owner product 82696 and original package front/back identify the same product and UPC 898220012022. Official and seller labels agree on the 40 g scoop, protein, total sugar, fat, saturated fat, calories and all ingredients. Retain seller 6 g versus current official 5 g added-sugar declaration as a label revision conflict. This verifies published specifications, not seller authenticity.',
    facts: {
      netMassG: {
        value: 907,
        evidenceId: frontEvidence.id,
        excerpt:
          'Official front net weight is 32 oz (2 lb), 907 g; selected seller front also reads 907 g.',
      },
      packCount: {
        value: 1,
        evidenceId: frontEvidence.id,
        excerpt: 'One 907 g pouch.',
      },
      ...Object.fromEntries(
        Object.entries(values).map(([field, value]) => [
          field,
          { value, evidenceId: labelEvidence.id, excerpt: excerpts[field] },
        ])
      ),
    },
    additionalManufacturerFacts: {
      gtin: source.identity.gtin,
      manufacturerProductCode: source.identity.manufacturerProductCode,
      addedSugarPerServingG: 5,
      addedSugarPer100g: 12.5,
      retainedConflict: source.retainedConflict,
    },
    sourceDocument,
  };
  const product = await app.reviewManufacturer(productId, review);
  const problems = specificationProblems(product);
  if (problems.length) {
    throw new Error(problems.join('; '));
  }
  if (
    !product.ingredientFlags.addedSugar ||
    !product.ingredientFlags.sweeteners
  ) {
    throw new Error(
      'Sugar and stevia must correct the misleading seller claims'
    );
  }
  const offers = (await store.list('offer')).filter(
    (offer) => offer.productId === productId && !offer.supersededBy
  );
  const result = {
    checkedAt: new Date().toISOString(),
    productId,
    sku: product.sku,
    manufacturerVerification: product.manufacturerVerification,
    specificationProblems: problems,
    ingredientFlags: product.ingredientFlags,
    cache: app.cache.stats,
    originalProductHtmlCaptured: false,
    sourceDocument,
    historicalOffers: offers.map((offer) => ({
      price: offer.price,
      currency: offer.currency,
      sku: offer.sku,
      available: offer.available,
      observedAt: offer.observedAt,
      evidenceId: offer.evidenceId,
      verifiedFoodMassG: 907,
      verifiedProteinMassG: (907 * 27) / 40,
      pricePerFoodG: offer.price / 907,
      pricePerProteinG: (offer.price * 40) / (907 * 27),
      purchaseReady: false,
      limitations: [
        'Current selected-SKU price, stock and vouchers require confirmation.',
        'No Nha Trang bulk-delivery quote for this selling option yet.',
      ],
    })),
  };
  await mkdir(output, { recursive: true });
  for (const [name, value] of Object.entries({
    'cgn-dark-chocolate-12587822048.json': review,
    'cgn-dark-chocolate-12587822048-result.json': result,
  })) {
    await writeFile(`${output}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
  }
  console.log(JSON.stringify({ productId, problems, cache: app.cache.stats }));
} finally {
  await app.close();
}
