import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { LazadaSearch, extractPage, parseProduct } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { discoverFoodOfferSourceBasis } from '../src/food-offer-source-basis.js';
import { sha256 } from '../src/util.js';

export const MERINO_SELLING_UNIT_REVIEW = Object.freeze({
  productId:
    'product:5d030422dfc190b79c0f39e6473b0306cda80acc421d6f132972c9b1b79e5373',
  sku: '367656830_VNAMZ-116917756014',
  evidenceId:
    'evidence:333fa66a8d49f4522ccaf03b50097289f57c9f3da8df4e35fbb7a266ba2835ad',
  sourceSha256:
    'bf17215a7a9e359df92d81620aeac96e2431f4841e3a7f5313c27afbd6ee123d',
  sourceBytes: 354490,
  observedAt: '2026-10-10T05:42:15.424Z',
  url: 'https://www.lazada.vn/products/pdp-i367656830.html',
  selectedOption: 'COMBO 5 cây',
  netMassG: 40,
  packCount: 5,
  price: 39000,
});
const expected = MERINO_SELLING_UNIT_REVIEW;
const quantities = new Set(['netMassG', 'packCount']);
const proteinFields = [
  'proteinPer100g',
  'proteinPer100ml',
  'proteinPerPackageG',
];

function blockedClaim(claim) {
  return (
    quantities.has(claim.field) &&
    Boolean(
      claim.invalidated ||
      claim.invalidatedAt ||
      claim.consistencyReviewRequired ||
      (claim.source === 'manual-review' && claim.requiresReview !== false)
    )
  );
}

function assertUnheld(record) {
  if (
    record.visibility === 'private' ||
    [
      'invalidated',
      'invalidatedAt',
      'specificationsInvalidated',
      'priceInvalidated',
      'requiresReview',
      'packageCountUnresolved',
    ].some((field) => record[field]) ||
    record.pendingSpecificationReview?.includes('packCount') ||
    record.packageMassConsistency?.requiresReview ||
    record.paidMassBasis?.requiresReview ||
    record.specificationHolds?.some(
      (hold) => quantities.has(hold.field) && hold.active !== false
    ) ||
    record.claims?.some(blockedClaim) ||
    record.crossChecks?.some((check) =>
      check.conflicts?.some((conflict) => quantities.has(conflict.field))
    )
  ) {
    throw new Error(
      'Explicit review, invalidation or quantity conflict prevents seller-source review'
    );
  }
}

function matchingFields(record, values) {
  return Object.entries(values).every(
    ([field, value]) => record[field] === value
  );
}

function selectedOptionsOf(record) {
  return [
    ...new Set(
      (record.selectedVariant || [])
        .filter((entry) => entry.selected !== false)
        .map((entry) => entry.text)
    ),
  ];
}

function exactSelectedOption(record) {
  const selected = selectedOptionsOf(record);
  return selected.length === 1 && selected[0] === expected.selectedOption;
}

function assertIdentity(product, offer, evidence) {
  const identity = {
    sku: expected.sku,
    url: expected.url,
    observedAt: expected.observedAt,
  };
  if (
    !matchingFields(product, {
      ...identity,
      id: expected.productId,
      netMassG: expected.netMassG,
      packCount: expected.packCount,
    }) ||
    !exactSelectedOption(product) ||
    !product.evidenceIds?.includes(expected.evidenceId) ||
    !matchingFields(offer, {
      ...identity,
      productId: expected.productId,
      evidenceId: expected.evidenceId,
      price: expected.price,
      variantConfirmed: true,
    }) ||
    !matchingFields(evidence, {
      id: expected.evidenceId,
      url: expected.url,
      observedAt: expected.observedAt,
    }) ||
    evidence.html?.sha256 !== expected.sourceSha256 ||
    evidence.html?.bytes !== expected.sourceBytes ||
    proteinFields.some(
      (field) => product[field] !== undefined && product[field] !== null
    )
  ) {
    throw new Error(
      'Existing selected product, offer and original evidence do not match the fixed seller-source review'
    );
  }
}

function safePerInner(discovery) {
  const basis = discovery.paidMassBasis;
  return (
    discovery.selectedSkuBound &&
    !discovery.selectionConflict &&
    basis.basis === 'one-inner-food-package' &&
    basis.safeToMultiplyByPackCount &&
    !basis.requiresReview &&
    !basis.holdFields.length
  );
}

function validateOriginal(bytes) {
  if (
    !bytes ||
    bytes.length !== expected.sourceBytes ||
    sha256(bytes) !== expected.sourceSha256
  ) {
    throw new Error('Original Merino source digest or length mismatch');
  }
  const snapshot = extractPage({
    document: parseHTML(bytes.toString('utf8')).document,
    url: expected.url,
  });
  const selectedOptions = selectedOptionsOf(snapshot);
  const excerpt = snapshot.description?.match(
    /Trọng lượng\s*:\s*40g\s*\/\s*cây/u
  )?.[0];
  const parsed = parseProduct(snapshot, {
    evidenceId: expected.evidenceId,
    originalHtmlSha256: expected.sourceSha256,
    observedAt: expected.observedAt,
  });
  const discovery = discoverFoodOfferSourceBasis(snapshot, parsed);
  if (
    snapshot.sku !== expected.sku ||
    !exactSelectedOption(snapshot) ||
    !excerpt ||
    !matchingFields(parsed.product, {
      id: expected.productId,
      netMassG: expected.netMassG,
      packCount: expected.packCount,
    }) ||
    parsed.product.massEvidence?.conflicting ||
    parsed.offer.price !== expected.price ||
    !parsed.offer.variantConfirmed ||
    !safePerInner(discovery)
  ) {
    throw new Error(
      'Original HTML does not prove the exact selected per-stick selling unit'
    );
  }
  return { parsed, selectedOptions, excerpt };
}

async function assertSourceNotInvalidated(store, evidence) {
  const cache = evidence.cacheId
    ? await store.get('cache', evidence.cacheId)
    : undefined;
  if (cache?.invalidated || cache?.invalidatedAt) {
    throw new Error(
      'Original source cache invalidation prevents seller-source review'
    );
  }
  const related = (await store.list('invalidation')).filter(
    (record) =>
      record.url === expected.url ||
      record.evidenceIds?.includes(evidence.id) ||
      record.cacheIds?.includes(evidence.cacheId)
  );
  if (related.some((record) => record.invalidated || record.invalidatedAt)) {
    throw new Error(
      'Stored original source invalidation prevents seller-source review'
    );
  }
}

async function assertStoredQuantityUnheld(store) {
  for (const field of quantities) {
    if (
      (await store.get('specification-hold', `${expected.sku}:${field}`))
        ?.active
    ) {
      throw new Error(
        'Active explicit stored quantity hold prevents seller-source review'
      );
    }
  }
}

export async function reviewCachedIceSellingUnit(
  application,
  { receiptPath } = {}
) {
  const store = application.store;
  if (store.visibility !== 'public' || !application.cache.offline) {
    throw new Error(
      'Seller-source review requires an offline public application'
    );
  }
  const product = await store.get('product', expected.productId);
  const evidence = await store.get('evidence', expected.evidenceId);
  if (!product || !evidence) {
    throw new Error(
      'Seller-source review requires attached stored original evidence'
    );
  }
  const original = await store.blob(evidence.html?.sha256);
  const { parsed, selectedOptions, excerpt } = validateOriginal(original);
  const offer = await store.get('offer', parsed.offer.id);
  if (!offer || offer.supersededBy) {
    throw new Error(
      'Seller-source review requires the current exact source offer'
    );
  }
  assertIdentity(product, offer, evidence);
  for (const record of [product, offer, evidence]) {
    assertUnheld(record);
  }
  await assertSourceNotInvalidated(store, evidence);
  await assertStoredQuantityUnheld(store);
  const applied =
    product.pendingSpecificationReview?.includes('netMassG') === true;
  if (applied) {
    await application.review(
      product.id,
      'netMassG',
      expected.netMassG,
      evidence.id
    );
  }
  const receipt = {
    reviewedAt: new Date().toISOString(),
    method: 'exact-original-seller-per-inner-package-review',
    ...expected,
    selectedOptions,
    excerpt,
    sourceAuthority: 'marketplace-seller',
    totalNetMassG: expected.netMassG * expected.packCount,
    logisticsCartonCountExcluded: true,
    applied,
    downloads: 0,
    originalPriceChanged: false,
    originalObservationChanged: false,
    sellingCountChanged: false,
    factoryIdentityApproved: false,
    nutritionApproved: false,
    reason:
      'Explicit seller-original review resolves a legacy mass-only pending flag with no automatic-origin metadata; the selected five-stick package uses 40 g per stick, excluding the 40-stick logistics carton.',
  };
  if (receiptPath) {
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  return receipt;
}

async function main() {
  const options = parseArguments([
    ...process.argv.slice(2),
    '--offline',
    '--no-ocr',
  ]);
  const app = new LazadaSearch({
    store: configuredStore(options),
    offline: true,
    ocr: false,
  });
  try {
    console.log(
      JSON.stringify(
        await reviewCachedIceSellingUnit(app, {
          receiptPath:
            'docs/acceptance/source-integrity/merino40-selling-unit-review.json',
        })
      )
    );
  } finally {
    await app.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
