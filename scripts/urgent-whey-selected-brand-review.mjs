import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { LazadaSearch, specificationProblems } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (!options.offline || options.account) {
  throw new Error(
    'Selected brand review requires --offline and a public store'
  );
}
const store = configuredStore(options);
const app = new LazadaSearch({ store, offline: true, ocr: false });
const productId =
  'product:00ff172f392e539bb3db42a000bde0e354748b20eda8df7175037ae84d84a9ef';
const listingEvidenceId =
  'evidence:acce951c67e932f13b88a0660365ff4a8fa927a05dd962e63e95a70ae8970b75';
const manufacturerUrl =
  'https://138foods.com/products/its-just-whey-protein-isolate';
try {
  const product = await store.get('product', productId);
  if (
    product.sku !== '2326481300_VNAMZ-15339529115' ||
    !product.selectedVariant.some((v) => v.text === "IT'S JUST WHEY ISOLA")
  ) {
    throw new Error('Selected option no longer matches the reviewed brand');
  }
  const listingCorrections = [
    {
      field: 'brand',
      value: "It's Just",
      evidenceId: listingEvidenceId,
      reason:
        "Selected SKU15339529115 is IT'S JUST WHEY ISOLA despite the AMIX listing headline. Its SKU image clearly identifies unflavoured IT'S JUST Whey Protein Isolate, 5 lbs (2268 g), 30 g protein, 68 servings. Other AMIX options must not inherit these facts.",
    },
  ];
  await app.review(productId, 'brand', "It's Just", listingEvidenceId);
  const check = await app.verify(productId, manufacturerUrl);
  const template = JSON.parse(
    await readFile(
      'docs/acceptance/manufacturer-reviews/its-just-15280912681.json',
      'utf8'
    )
  );
  const review = {
    ...template,
    productId,
    evidenceId: check.evidenceId,
    listingEvidenceId,
    listingCorrections,
    reason:
      "The selected IT'S JUST WHEY ISOLA SKU image matches the official unflavoured 5 lb package, 2268 g, 30 g protein, 68 servings and sunflower lecithin formula. The AMIX listing title describes other selling options and must not determine this SKU's brand. Official 33 g scoop label supplies nutrition, including 1 g sugar despite seller sugar-free artwork. This verifies published specifications, not seller authenticity.",
  };
  for (const fact of Object.values(review.facts)) {
    if (fact.evidenceId === template.evidenceId) {
      fact.evidenceId = check.evidenceId;
    }
  }
  const verified = await app.reviewManufacturer(productId, review);
  const problems = specificationProblems(verified);
  if (problems.length) {
    throw new Error(problems.join('; '));
  }
  const offers = (await store.list('offer')).filter(
    (o) => o.productId === productId && !o.supersededBy
  );
  const result = {
    checkedAt: new Date().toISOString(),
    productId,
    sku: verified.sku,
    specificationProblems: problems,
    cache: app.cache.stats,
    listingImage: {
      url: 'https://img.lazcdn.com/g/p/7526b9677a752cc8a60e5bbc6e265049.png_960x960q80.png_.webp',
      sha256:
        '14e117045dd914e16b8fc146f406b1648de9f881678fc5057205ed52918f2b1b',
    },
    manufacturerVerification: verified.manufacturerVerification,
    historicalOffers: offers.map((offer) => ({
      ...offer,
      verifiedFoodMassG: verified.netMassG,
      verifiedProteinMassG: (verified.netMassG * verified.proteinPer100g) / 100,
      pricePerFoodG: offer.price / verified.netMassG,
      pricePerProteinG:
        (offer.price * 100) / (verified.netMassG * verified.proteinPer100g),
      purchaseReady: false,
      limitations: [
        'Current selected-SKU price, stock and vouchers require confirmation',
        'No Nha Trang bulk-delivery quote for this selling option yet',
      ],
    })),
  };
  await mkdir('docs/acceptance/urgent-whey-reviews', { recursive: true });
  for (const [name, value] of Object.entries({
    'its-just-15339529115.json': review,
    'its-just-15339529115-result.json': result,
  })) {
    await writeFile(
      `docs/acceptance/urgent-whey-reviews/${name}`,
      `${JSON.stringify(value, null, 2)}\n`
    );
  }
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
