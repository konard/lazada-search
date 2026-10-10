import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { AssociativeStore } from '../src/store.js';
import { extractPage } from '../src/browser.js';

// Inspect committed/public sources without browser, HTTP, or store mutations.
const store = new AssociativeStore({
  archive: 'data/cases/vietnam-nha-trang',
});
const output = 'docs/acceptance/urgent-whey-reviews';
const catalogBytes = await readFile('docs/tables/catalog.json');
const catalog = JSON.parse(catalogBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const benchmarkProteinG = (2268 * 30) / 33;
const benchmarkDeliveredCost = 3032500 / benchmarkProteinG;
const definitions = [
  {
    itemId: '2126595433',
    skus: ['10014178623', '10014178624', '10014178625', '10014178626'],
    name: 'NZMP seller repacks',
    inspectedImageIndexes: [0, 1, 2, 4, 5],
    identityConclusion:
      'Exact factory grade and repacked formulation not established',
    findings: [
      'Selected options are 500 g, 1 kg, Combo 2 kg and 5 kg with a claimed 1 kg gift. These are seller repacks, not the photographed sealed 20/25 kg factory bags.',
      'Description says unflavoured, but ingredient specification lists Protein whey, Stevia, vanilla powder. Flavour and composition conflict.',
      'Gallery mixes an Australian WPC80 factory bag, a New Zealand concentrate bag and a 20 kg whey protein isolate bag. A brand match cannot choose an exact ingredient grade.',
      'Factory-bag date photo reads 19/12/2024 and 18/12/2026, conflicting with description expiry 12/2030. The photo does not establish the current repack batch.',
      'No readable grade/product code, complete nutrition panel or batch-matched certificate establishes the delivered repack formulation.',
      'All weights retain generic Net Content 17 oz. Selected option mass is only a seller claim.',
      '5 kg gift option advertises 5Kg Tặng 1Kg, but gift formulation, quantity fulfillment and freight are not independently established. Do not count 6 kg automatically.',
    ],
    requiredDescriptionExcerpts: [
      'Protein whey,Stevia,vanilla powder',
      'Mùi Vị : không vị',
      '12/2030',
    ],
  },
  {
    itemId: '13430219487',
    skus: ['117214356196'],
    name: 'Generic Gold Standard-like Double Rich Chocolate',
    inspectedImageIndexes: [0, 1],
    identityConclusion: 'Manufacturer identity not established',
    findings: [
      'Selected option is Double Rich Chocolate. Front artwork prints 2 lb / 907 g and 29 servings, but has no Optimum Nutrition / ON logo; listing brand is blank.',
      'Gallery nutrition image says 74 servings at 30.4 g per serving, corresponding to a different package size from the 907 g front.',
      'Seller ingredients list cane sugar and stevia, whereas its nutrition-image ingredients list acesulfame potassium. These formulas must not be merged.',
      'No GTIN or manufacturer-controlled exact package evidence links this SKU to Optimum Nutrition. No conclusion about seller authenticity is made.',
    ],
    requiredDescriptionExcerpts: ['Đường mía', 'Stevia'],
  },
  {
    itemId: '3154800181',
    skus: ['116802296150'],
    name: 'ON ShapeyourBody chocolate 3 kg share bag',
    inspectedImageIndexes: [1, 3, 5, 7, 8],
    identityConclusion: 'Seller repack identity and batch not factory verified',
    findings: [
      'Selected options explicitly identify Gói Share 3kg and Sôcôla. Gallery shows seller zip repacks, not a sealed manufacturer 3 kg retail package.',
      'Gallery repacks say Double Rich Chocolate, but no SKU-specific batch/GTIN evidence links this 3 kg option to an exact factory formulation.',
      'Shared description still says 500 g zip bag, while generic Net Content says 2 lbs. Do not replace selected 3 kg seller mass with those unrelated values.',
      'Seller nutrition artwork combines a 30.4 g serving with a 32 g preparation instruction and 74 servings. Do not assume the retail-label serving count is the share bag yield.',
      'Manufacturer retail specifications cannot establish the seller repack fill weight, handling or original batch.',
    ],
    requiredDescriptionExcerpts: ['Túi 500gam', '2 lbs'],
  },
  {
    itemId: '3264177806',
    skus: ['15757073905'],
    name: 'VBest Nutrition Chocolate 450 g',
    inspectedImageIndexes: [2, 7, 8],
    identityConclusion:
      'Exact flavour and seller label readable; manufacturer authority and formula revision unresolved',
    sellerLabelFacts: {
      netMassG: 450,
      servingMassG: 30,
      proteinPer100g: 71.65,
      proteinPerServingG: 21.49,
      sugarPer100gAsPrinted: 13.89,
      fatPer100g: 6.32,
      kcalPer100g: 399.01,
      saturatedFatPer100g: null,
      ingredients: [
        'whey protein concentrate (87.8%)',
        'cocoa powder (5%)',
        'soy protein isolate',
        'acesulfame potassium (INS 950)',
        'silicon dioxide (INS 551)',
      ],
      businessName: 'HỘ KINH DOANH VBEST NUTRITION',
      declarationNumber: '01-WP/VBESTNUTRITION/2026',
      sourceAuthority:
        'marketplace-uploaded package artwork; manufacturer-controlled origin not independently established',
      appliedToProduct: false,
    },
    findings: [
      'Selected CHOCOLATE SKU and 450 g artwork agree. Factory authority is unresolved: searches did not establish an independently controlled manufacturer website.',
      'Package artwork says 71.65% protein, but seller-uploaded Chocolate test report issued 29 Dec 2025 says 68.9%. No current batch correspondence resolves the difference.',
      'Self-declaration says whey concentrate 87% and cocoa 6%; package artwork says 87.8% and 5%. Keep both revisions as conflicting evidence.',
      'Package says NO ADDED SUGAR and lists sugar 13.89 g/100 g. Seller promotional no-sugar text cannot mean zero total sugar.',
      'Contains soy isolate and acesulfame potassium. Whey ingredient percentage is not the total protein percentage.',
      'Saturated-fat data is absent from the readable package artwork, preventing a complete factory specification review.',
      'Government declaration URL printed in uploaded screenshot was not accessible through the web tool. The uploaded screenshot does not prove original government source bytes were obtained.',
    ],
    requiredDescriptionExcerpts: [
      'CHOCOLATE',
      'Protein whey,đạm đậu nành phân lập',
    ],
  },
  {
    itemId: '3145660834',
    skus: ['15003612515'],
    name: 'VOLAC-titled WPC seller bag',
    inspectedImageIndexes: [0, 2, 3],
    identityConclusion: 'Factory product grade and origin not established',
    findings: [
      'Description says 1000 g and unflavoured (Ko mùi, ko vị), but structured ingredients list unrelated collagen, DHA, ginseng and other substances.',
      'Photographed bag says WHEY PROTEIN CONCENTRATE and 1000 g, with no visible VOLAC product code, factory grade or original-batch identity.',
      'AI-generated seller gallery image is retained as seller artwork and cannot verify physical packaging or nutrition.',
      'Even seller-claimed 24 g protein per 30 g at 1,290,000 VND implies 1,612.50 VND/g protein before shipping, above the verified benchmark. No discount eligibility is inferred.',
    ],
    requiredDescriptionExcerpts: ['Khối lượng: 1000g', 'Ko mùi, ko vị'],
  },
];

let sourceDigestsChecked = 0;
async function verifiedBytes(blob) {
  const bytes = await store.blob(blob.sha256);
  if (!bytes || hash(bytes) !== blob.sha256) {
    throw new Error(`Missing or corrupted source ${blob.sha256}`);
  }
  sourceDigestsChecked += 1;
  return bytes;
}
const cache = await store.list('cache');
const candidates = [];
await mkdir(output, { recursive: true });
for (const definition of definitions) {
  for (const skuId of definition.skus) {
    const sku = `${definition.itemId}_VNAMZ-${skuId}`;
    const product = catalog.products.find((item) => item.sku === sku);
    const offer = catalog.offers.find(
      (item) =>
        item.productId === product?.id && item.sku === sku && !item.supersededBy
    );
    if (
      !product ||
      !offer ||
      !offer.variantConfirmed ||
      offer.priceScope !== 'observed-variant'
    ) {
      throw new Error(`Missing exact observed offer: ${sku}`);
    }
    const evidence = await store.get('evidence', offer.evidenceId);
    const html = await verifiedBytes(evidence.html);
    const { document } = parseHTML(html.toString());
    const snapshot = extractPage({
      document,
      url: evidence.url || product.url,
    });
    if (snapshot.sku !== sku) {
      throw new Error(`Captured HTML selected SKU mismatch: ${sku}`);
    }
    for (const excerpt of definition.requiredDescriptionExcerpts) {
      if (!(snapshot.description + snapshot.rawText).includes(excerpt)) {
        throw new Error(`Missing cited description excerpt: ${sku} ${excerpt}`);
      }
    }
    const imageSources = [];
    for (const index of definition.inspectedImageIndexes) {
      const url = snapshot.productImages[index];
      const source = cache.find((record) => record.id === `image:${url}`);
      if (!source?.blob) {
        throw new Error(`Missing cited cached image: ${sku} ${index}`);
      }
      await verifiedBytes(source.blob);
      imageSources.push({
        galleryIndex: index,
        url,
        blob: source.blob,
        cacheId: source.id,
      });
    }
    const candidate = {
      productId: product.id,
      sku,
      name: definition.name,
      url: product.url,
      selectedVariant: snapshot.selectedVariant,
      capturedOffer: {
        id: offer.id,
        price: offer.price,
        currency: offer.currency,
        available: offer.available,
        originalPrice: offer.originalPrice,
        saleSavings: offer.saleSavings,
        displayedDiscountPercent: offer.displayedDiscountPercent,
        priceScope: offer.priceScope,
        observedAt: offer.observedAt,
        evidenceId: evidence.id,
        html: evidence.html,
      },
      imageSources,
      identityConclusion: definition.identityConclusion,
      findings: definition.findings,
      sellerLabelFacts: definition.sellerLabelFacts,
      eligibleForFactoryVerifiedProteinCostRanking: false,
      manufacturerReviewApplied: false,
    };
    if (definition.sellerLabelFacts) {
      const proteinG =
        (definition.sellerLabelFacts.netMassG *
          definition.sellerLabelFacts.proteinPer100g) /
        100;
      candidate.conditionalSellerLabelCalculation = {
        assumption:
          'Only a scenario using unverified seller package-artwork protein percentage; not a purchase recommendation or verified ranking',
        totalProteinG: proteinG,
        merchandiseCostPerProteinG: offer.price / proteinG,
        maximumFreightAndFeesToBeatBenchmarkVnd:
          benchmarkDeliveredCost * proteinG - offer.price,
        usesGiftMass: false,
      };
    }
    candidates.push(candidate);
  }
}

const leadIds = [
  '1225994167',
  '2205403447',
  '1869611936',
  '1820626958',
  '3095127497',
];
const discoveryLeads = [];
for (const itemId of leadIds) {
  const listing = catalog.discoveries
    .filter((item) => item.url.includes(`-i${itemId}.html`))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (!listing || !Number.isFinite(listing.searchPrice)) {
    throw new Error(`Missing captured discovery card: ${itemId}`);
  }
  const source = cache.find((item) => item.id === listing.cacheId);
  await verifiedBytes(source.html);
  const card = source.snapshot.cards.find((item) => item.url === listing.url);
  if (!card || !card.priceText) {
    throw new Error(`Missing cited search card: ${itemId}`);
  }
  discoveryLeads.push({
    itemId,
    url: listing.url,
    title: listing.title,
    searchPrice: listing.searchPrice,
    priceScope:
      'search-card-only; exact selected package and flavour price not yet established',
    observedAt: listing.observedAt,
    query: listing.query,
    cacheId: listing.cacheId,
    html: source.html,
    card,
    manufacturerIdentityApplied: false,
    eligibleForFactoryVerifiedProteinCostRanking: false,
  });
}
const report = {
  checkedAt: new Date().toISOString(),
  scope:
    'Plain/unflavoured or chocolate whey; exact low-price identity audit and larger-package discovery leads',
  inputCatalog: {
    filename: 'docs/tables/catalog.json',
    sha256: hash(catalogBytes),
    bytes: catalogBytes.length,
    checkedAt: catalog.checkedAt,
  },
  validation: {
    sourceDigestsChecked,
    browserRequests: 0,
    networkRequests: 0,
    sharedStoreWrites: 0,
    manufacturerReviewsApplied: 0,
    exactSelectedSkuCheckedFromOriginalHtml: true,
  },
  benchmark: {
    productSku: '3300919067_VNAMZ-16058119853',
    netMassG: 2268,
    proteinPerServingG: 30,
    servingMassG: 33,
    quantity: 1,
    price: 2952300,
    freight: 80200,
    total: 3032500,
    totalProteinG: benchmarkProteinG,
    deliveredCostPerProteinG: benchmarkDeliveredCost,
  },
  candidates,
  discoveryLeads,
};
await writeFile(
  `${output}/low-price-identity-audit.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report.validation));
