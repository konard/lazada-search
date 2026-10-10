import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AssociativeStore } from '../src/store.js';

// Read-only audit: no browser, HTTP requests, or shared-store writes.
const store = new AssociativeStore({ archive: 'data/cases/vietnam-nha-trang' });
const output = 'docs/acceptance/urgent-whey-reviews';
const definitions = [
  {
    productId:
      'product:dfa060897269f04ec2846eade8608f56a09fcf2317217e0a78c5f8c1de824422',
    sku: '1553990700_VNAMZ-6552645102',
    name: 'ProSupps Chocolate Ice Cream',
    manufacturerEvidenceId:
      'evidence:f638dadd0769e87788c24c0cddde4fc77ccfed1d28ba22a6ded3f17b4b373caf',
    officialLabel: {
      url: 'https://prosupps.com/cdn/shop/files/ps-whey-isolate-chocolate_ff1c07c0-801a-4cc1-9522-d64f4a4f2a77.png?v=1785328970&width=1800',
      sha256:
        '26fe2ab99d1a54bef978628c777b1c9cd49997a2f27088882606ac0105d50fcb',
      preview: '../manufacturer-labels/prosupps-current-label.png',
    },
    blockers: [
      'Seller gallery mixes Premium 28-serving packaging with older Advanced Leaning L-carnitine 23/24-serving packaging. The exact formulation supplied for this SKU is unresolved.',
      'Current manufacturer Premium nutrition must not be assigned to the older formulation.',
      'No current selected-SKU price and destination-specific bulk shipping quote.',
    ],
    extractionProblems: [
      'HTML ingredients were incorrectly extracted as third party tested, with false milk and soy flags; the official nutrition image contains whey protein isolate and soy lecithin.',
      'The current official label has fat 0.5 g per serving, despite seller promotional zero-fat wording.',
    ],
  },
  {
    productId:
      'product:23b5b6153d25bd74bc988584dfed638edd5f588690c437fba3f115c9961f47a4',
    sku: '524088580_VNAMZ-1126718015',
    name: 'Rule One R1 Protein Chocolate Fudge',
    manufacturerEvidenceId:
      'evidence:a00b2e9b761366dd9ed09a805ddefc29890250e63b85c7dd13ea27be2c01ef3e',
    officialLabel: {
      url: 'https://www.ruleoneproteins.com/cdn/shop/files/R1_Protein_Whey_Isolate_Chocolate_Fudge_panel.png?v=1718924045275634866',
      sha256:
        'f712b1ba720cbaf269cf2cf95a5a4dbc4660785100a82b495c02707554fee224',
      original: 'rule1-chocolate-fudge-original.png',
      preview: 'rule1-chocolate-fudge-white.png',
      previewMethod:
        'Original RGBA pixels composited onto a white background. No text was reconstructed or changed.',
      manuallyReadFacts: {
        flavour: 'Chocolate Fudge',
        servingMassG: 32,
        proteinPerServingG: 25,
        sugarPerServingG: 0,
        fatPerServingG: 0.5,
        saturatedFatPerServingG: 0,
        kcalPerServing: 120,
        ingredients: [
          'protein blend (whey protein isolate, hydrolyzed whey protein isolate)',
          'cocoa (processed with alkali)',
          'natural and artificial flavors (2% or less)',
          'sucralose (2% or less)',
          'salt (2% or less)',
          'acesulfame potassium (2% or less)',
          'soy lecithin (2% or less)',
          'sunflower lecithin (2% or less)',
        ],
        allergens: ['milk', 'soy'],
        reviewedBy: 'Codex visual review',
        appliedToListing: false,
      },
    },
    listingImage: {
      url: 'https://img.lazcdn.com/g/p/9296b2cc4181eda1f6cdd4f908b54b27.jpg_720x720q80.jpg_.webp',
      sha256:
        '9cdd33c28c5756574fb48b7e6c1238a6bc640d6658f781ee31bd5a1d2fe715f6',
      manuallyReadIdentity: {
        flavour: 'Chocolate Fudge',
        printedNetMassG: 2270,
        printedNetMassLb: 5.01,
        servings: 71,
        proteinPerServingG: 25,
      },
    },
    blockers: [
      'Current official Chocolate Fudge image references are for 1.5 lb packaging; current cached variant data does not establish the selected 5.01 lb / 2270 g package.',
      'Captured selected Chocolate SKU is unavailable. The available 1 kg trial bag is a separate repack option with unspecified exact flavour.',
      'No current selected-SKU price and destination-specific bulk shipping quote.',
    ],
    extractionProblems: [
      'Automatic ingredient extraction stopped at Protein Blend (Whey; the complete factory label is readable after compositing its transparent background onto white.',
    ],
  },
  {
    productId:
      'product:fb390ba4295fb7ba01aceac0ffc4bd024e5b508edb4a43eb670596bdf7d7955e',
    sku: '2582378529_VNAMZ-12587822048',
    name: 'California Gold Nutrition Dark Chocolate 907 g',
    manufacturerEvidenceId:
      'evidence:e4f9acf641ab54f79d7dbffe55d61b4c873b7b616b732cd2efb4526172610c89',
    blockers: [
      'The supplied brand-domain product URL redirects to a generic iHerb California Gold Nutrition category. The captured response supplies no exact Dark Chocolate 907 g manufacturer label.',
      'Full exact-package nutrition and ingredient evidence is missing; a retailer category or another flavour cannot supply it.',
      'No current selected-SKU price and destination-specific bulk shipping quote.',
    ],
    extractionProblems: [],
  },
];

async function checkBlob(source) {
  const bytes = await store.blob(source.sha256);
  if (!bytes) {
    throw new Error(`Missing cached source ${source.sha256}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== source.sha256) {
    throw new Error(`Source digest mismatch ${digest}`);
  }
  return bytes;
}

const offers = await store.list('offer');
const candidates = [];
await mkdir(output, { recursive: true });
for (const definition of definitions) {
  const product = await store.get('product', definition.productId);
  if (product?.sku !== definition.sku) {
    throw new Error(`Selected identity changed for ${definition.name}`);
  }
  const evidence = await store.get(
    'evidence',
    definition.manufacturerEvidenceId
  );
  if (!evidence?.html?.sha256) {
    throw new Error('Missing official source HTML');
  }
  await checkBlob(evidence.html);
  if (definition.officialLabel) {
    const bytes = await checkBlob(definition.officialLabel);
    if (definition.officialLabel.original) {
      await writeFile(`${output}/${definition.officialLabel.original}`, bytes);
    }
  }
  if (definition.listingImage) {
    await checkBlob(definition.listingImage);
  }
  const selectedOffers = offers
    .filter(
      (offer) =>
        offer.productId === product.id &&
        offer.sku === product.sku &&
        !offer.supersededBy
    )
    .map((offer) => ({
      price: offer.price,
      currency: offer.currency,
      available: offer.available,
      observedAt: offer.observedAt,
      evidenceId: offer.evidenceId,
    }));
  candidates.push({
    ...definition,
    url: product.url,
    selectedVariant: product.selectedVariant,
    capturedOffers: selectedOffers,
    manufacturerSource: {
      url: evidence.url,
      finalUrl: evidence.extracted?.url,
      html: evidence.html,
      observedAt: evidence.observedAt,
    },
    purchaseReady: false,
    eligibleForVerifiedProteinCostRanking: false,
  });
}
const report = {
  checkedAt: new Date().toISOString(),
  scope: 'Natural / unflavoured or exact chocolate whey powder only',
  validation: {
    readOnly: true,
    networkRequests: 0,
    sourceDigestsChecked: true,
    manufacturerReviewsApplied: 0,
  },
  candidates,
};
await writeFile(
  `${output}/additional-candidate-gaps.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report.validation));
