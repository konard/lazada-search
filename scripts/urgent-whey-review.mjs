import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LazadaSearch, specificationProblems } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';

const options = parseArguments(process.argv.slice(2));
if (!options.offline || options.account) {
  throw new Error('Exact cached review requires --offline and a public store');
}
const store = configuredStore(options);
const app = new LazadaSearch({ store, offline: true, ocr: false });
const productId =
  'product:70c8d6356014a3083c2c868ef6adbf60a2f38e4942879101f048237725ed2478';
const manufacturerUrl =
  'https://138foods.com/products/its-just-whey-protein-isolate';
const directory = 'docs/acceptance/urgent-whey-reviews';
try {
  const template = JSON.parse(
    await readFile(
      'docs/acceptance/manufacturer-reviews/its-just-15280912681.json',
      'utf8'
    )
  );
  const check = await app.verify(productId, manufacturerUrl);
  if (check.sourceAuthority !== 'manufacturer') {
    throw new Error('Cached official source is not trusted for this product');
  }
  const review = {
    ...template,
    productId,
    evidenceId: check.evidenceId,
    listingEvidenceId:
      'evidence:35f63f314d74abca334a6daf23cb3e5c784fd2a3affb02e5bbba705e24846358',
    reason:
      "Visually inspected this listing's cached original front image: It's Just Whey Protein Isolate with Sunflower Lecithin, unflavoured, 5 lbs (2268 g), 30 g protein, about 68 servings. The selected option is VỊ TỰ NHIÊN. These match the official 5 lb back and side images: 33 g scoop, 30 g protein, same formula and one container. Correct seller headline rounding of 2.3 kg to the label's 2268 g. Seller image advertising zero sugar contradicts the official 1 g sugar per scoop; use the official nutrition label. This matches published product specifications and does not establish seller authenticity.",
  };
  for (const fact of Object.values(review.facts)) {
    if (fact.evidenceId === template.evidenceId) {
      fact.evidenceId = check.evidenceId;
    }
  }
  const product = await app.reviewManufacturer(productId, review);
  const problems = specificationProblems(product);
  if (problems.length) {
    throw new Error(`Exact review remains incomplete: ${problems.join('; ')}`);
  }
  const offers = (await store.list('offer')).filter(
    (offer) => offer.productId === productId && !offer.supersededBy
  );
  const result = {
    checkedAt: new Date().toISOString(),
    productId,
    sku: product.sku,
    exactManufacturerIdentity: product.manufacturerVerification,
    specificationProblems: problems,
    cache: app.cache.stats,
    listingFront: {
      url: 'https://img.lazcdn.com/g/p/3cbc369ccde401b2ddaf333821e2fda2.jpg_720x720q80.jpg_.webp',
      sha256:
        'e7d4d976939a204dede0220d67405c9db2cbc04ecd07f561bb07a57c914511d3',
    },
    manufacturerNutrition: {
      url: 'https://138foods.com/cdn/shop/files/WheyIsolate5lbback.jpg?v=1697246262&width=3840',
      sha256:
        '4fcaa035874c333b47cb935f1804133f167c75979843a95a0c8c802c1eddadf3',
    },
    reviewedFacts: review.facts,
    historicalOffers: offers.map((offer) => ({
      ...offer,
      verifiedFoodMassG: product.netMassG * product.packCount,
      verifiedProteinMassG:
        (product.netMassG * product.packCount * product.proteinPer100g) / 100,
      pricePerFoodG: offer.price / (product.netMassG * product.packCount),
      pricePerProteinG:
        (offer.price * 100) /
        (product.netMassG * product.packCount * product.proteinPer100g),
      purchaseReady: false,
      limitations: [
        'Price and stock require current selected-SKU confirmation',
        'No Nha Trang delivery or bulk-freight quote for this listing yet',
        'Additional voucher eligibility has not been established',
      ],
    })),
  };
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries({
    'its-just-16058119853.json': review,
    'its-just-16058119853-result.json': result,
  })) {
    await writeFile(
      join(directory, name),
      `${JSON.stringify(value, null, 2)}\n`
    );
  }
  console.log(
    JSON.stringify({
      productId,
      sku: product.sku,
      problems,
      cache: app.cache.stats,
    })
  );
} finally {
  await app.close();
}
