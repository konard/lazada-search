import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { configuredStore, parseArguments } from '../src/config.js';
import { extractPage } from '../src/browser.js';
import { validateProduct } from '../src/products.js';
import { hasReviewedPackageMass } from '../src/reviewed-package-mass.js';
import { atomicWrite, clone, fold, listingKey, sha256 } from '../src/util.js';

const receiptPath =
  'docs/acceptance/source-integrity/selected-package-corrections.json';
const onSku = '13463872611_VNAMZ-117339168804';
const yingbangSku = '13375928580_VNAMZ-116939205737';
const reviewedOriginals = {
  [onSku]: {
    html: '29beb646bd37f2156290ad2a1c40c93f47204746fda3a88315853edb4ebd1e6a',
    image: 'a3b66d6f849195dd4b515a5c4323ae94e95941ba6529257f041ff7bd1aa345b9',
    unique: true,
  },
  [yingbangSku]: {
    html: '534c2aa4a3729d06dfd01ef5612155ff5c0b2c85082a78a54f0bca8497af3e51',
    image: 'c354d3407797a04dda23a895517f6c94df5c995caa8c6507293e4c5c60c4eeca',
    panel: '1fa6e038600ad6b09ec25aab3630ea8f07259500f38fded43705bf831c64cd6f',
  },
};

function assetId(value) {
  return new URL(value).pathname.match(/\/p\/([a-f\d]{32})\./u)?.[1];
}

function assertReceipt(receipt) {
  assert.equal(receipt.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(receipt.reviewedAt)));
  assert.ok(receipt.reviewer?.trim());
  assert.deepEqual(
    receipt.actions.map((action) => action.sku),
    [onSku, yingbangSku]
  );
  assert.equal(receipt.actions[0].kind, 'selected-package-mass-review');
  assert.equal(receipt.actions[0].reviewedMassG, 864);
  assert.equal(receipt.actions[1].kind, 'specification-hold');
  assert.equal(receipt.actions[1].alternateValueApproved, null);
  for (const action of receipt.actions) {
    assert.equal(action.factoryIdentityApproved, false);
    assert.equal(action.nutritionApproved, false);
    assert.equal(action.source.sha256, reviewedOriginals[action.sku].html);
    assert.equal(action.image.sha256, reviewedOriginals[action.sku].image);
    if (action.sku === onSku) {
      assert.equal(action.requireUniqueSelectedAsset, true);
    } else {
      assert.equal(action.panel.sha256, reviewedOriginals[action.sku].panel);
      assert.equal(action.holdId, `${yingbangSku}:netMassG`);
    }
  }
}

async function originalBlob(store, source, label) {
  const bytes = await store.blob(source.sha256);
  assert.ok(bytes, `${label} original is missing`);
  assert.equal(sha256(bytes), source.sha256, `${label} digest mismatch`);
  assert.equal(bytes.length, source.bytes, `${label} byte length mismatch`);
  return bytes;
}

function assertCapturedRecords(action, product, offer, evidence) {
  assert.ok(product && offer && evidence, 'Captured records are missing');
  assert.equal(product.id, action.productId);
  assert.equal(offer.id, action.offerId);
  assert.equal(offer.productId, product.id);
  assert.equal(product.sku, action.sku);
  assert.equal(offer.sku, action.sku);
  assert.equal(offer.variantConfirmed, true);
  assert.equal(offer.evidenceId, action.source.evidenceId);
  assert.ok(product.evidenceIds.includes(evidence.id));
  assert.equal(evidence.html?.sha256, action.source.sha256);
  assert.equal(listingKey(evidence.url), listingKey(action.source.url));
  for (const record of [product, offer, evidence]) {
    assert.equal(record.observedAt, action.observedAt);
  }
  assert.equal(offer.price, action.expectedPriceVnd);
  assert.ok(!evidence.invalidated && !evidence.invalidatedAt);
}

async function assertCurrentOriginal(store, evidence, action) {
  const cache = evidence.cacheId
    ? await store.get('cache', evidence.cacheId)
    : undefined;
  assert.ok(!cache?.invalidatedAt, 'Listing original was invalidated');
  const invalidations = await store.list('invalidation');
  assert.ok(
    !invalidations.some(
      (entry) =>
        entry.evidenceIds?.includes(evidence.id) ||
        entry.cacheIds?.includes(evidence.cacheId) ||
        entry.url === action.source.url
    ),
    'Listing original has an unresolved invalidation'
  );
}

async function assertImage(store, snapshot, image) {
  await originalBlob(store, image, 'Package image');
  const cache = await store.get('cache', `image:${image.url}`);
  assert.equal(cache?.blob?.sha256, image.sha256, 'Image cache differs');
  assert.ok(!cache.invalidatedAt, 'Package image was invalidated');
  assert.ok(
    snapshot.images.some((url) => assetId(url) === assetId(image.url)),
    'Original HTML does not publish this image asset'
  );
}

function assertSelected(snapshot, action) {
  assert.equal(snapshot.sku, action.sku);
  assert.equal(snapshot.skuCatalogObserved, true);
  const displayed = [
    ...new Set(
      snapshot.selectedVariant
        .filter((entry) => entry.selected !== false)
        .map((entry) => fold(entry.text))
    ),
  ];
  assert.deepEqual(displayed.sort(), action.selectedOptions.map(fold).sort());
  const sku = action.sku.split('_VNAMZ-').at(-1);
  const selected = snapshot.skuCatalog.filter((entry) => entry.sku === sku);
  assert.equal(selected.length, 1, 'Selected catalogue entry is ambiguous');
  assert.deepEqual(
    selected[0].options.map((option) => fold(option.value)).sort(),
    displayed
  );
  assert.equal(assetId(selected[0].image), action.selectedAssetId);
  assert.equal(assetId(action.image.url), action.selectedAssetId);
  if (action.requireUniqueSelectedAsset) {
    assert.equal(
      snapshot.skuCatalog.filter(
        (entry) => assetId(entry.image) === action.selectedAssetId
      ).length,
      1,
      'Reviewed front is shared with another SKU'
    );
  }
}

async function prepareAction(store, action) {
  const [product, offer, evidence] = await Promise.all([
    store.get('product', action.productId),
    store.get('offer', action.offerId),
    store.get('evidence', action.source.evidenceId),
  ]);
  assertCapturedRecords(action, product, offer, evidence);
  await assertCurrentOriginal(store, evidence, action);
  const html = await originalBlob(store, action.source, 'Listing HTML');
  const snapshot = extractPage({
    document: parseHTML(html.toString()).document,
    url: action.source.url,
  });
  assertSelected(snapshot, action);
  await assertImage(store, snapshot, action.image);
  if (action.panel) {
    await assertImage(store, snapshot, action.panel);
  }
  assert.ok(
    !hasReviewedPackageMass(product) ||
      (action.kind === 'selected-package-mass-review' &&
        product.netMassG === action.reviewedMassG),
    'Existing exact mass review must be resolved independently'
  );
  return { action, product, offer, evidence };
}

/** Validate all original bytes and both selected records before any writes. */
export async function prepareSelectedPackageCorrections(store, receipt) {
  assert.equal(store.visibility, 'public', 'Use a public offline store');
  assertReceipt(receipt);
  const plans = [];
  for (const action of receipt.actions) {
    plans.push(await prepareAction(store, action));
  }
  return plans;
}

function reviewedProduct(plan, receipt) {
  const { action, product, evidence } = plan;
  const result = clone(product);
  const reviewId = `selected-package-mass-review:${sha256(JSON.stringify(action))}`;
  if (!result.claims.some((claim) => claim.reviewId === reviewId)) {
    result.corrections = [
      ...(result.corrections || []),
      {
        field: 'netMassG',
        previous: result.netMassG ?? null,
        corrected: action.reviewedMassG,
        evidenceId: evidence.id,
        sourceUrl: action.image.url,
        imageSha256: action.image.sha256,
        correctedAt: receipt.reviewedAt,
        reason: action.reason,
        reviewId,
      },
    ];
    result.claims.push({
      field: 'netMassG',
      value: action.reviewedMassG,
      source: 'selected-package-label-review',
      evidenceId: evidence.id,
      selectedSku: action.sku,
      originalHtmlSha256: action.source.sha256,
      imageSha256: action.image.sha256,
      sourceUrl: action.image.url,
      excerpt: action.labelExcerpt,
      confidence: 1,
      requiresReview: false,
      reviewedBy: receipt.reviewer,
      reviewedAt: receipt.reviewedAt,
      reviewId,
    });
  }
  result.netMassG = action.reviewedMassG;
  result.pendingSpecificationReview = (
    result.pendingSpecificationReview || []
  ).filter((field) => field !== 'netMassG');
  result.reviewedFields = [
    ...new Set([...(result.reviewedFields || []), 'netMassG']),
  ];
  return validateProduct(result);
}

function heldSpecification(plan, receipt) {
  const { action } = plan;
  return {
    id: action.holdId,
    field: 'netMassG',
    sku: action.sku,
    productId: action.productId,
    offerId: action.offerId,
    active: true,
    evidenceId: action.source.evidenceId,
    originalHtmlSha256: action.source.sha256,
    originalObservedAt: action.observedAt,
    imageSha256: action.image.sha256,
    imageUrl: action.image.url,
    panelSha256: action.panel.sha256,
    panelUrl: action.panel.url,
    reviewedAt: receipt.reviewedAt,
    reviewer: receipt.reviewer,
    reason: action.reason,
    alternateValueApproved: null,
    reviewReceipt: receiptPath,
  };
}

/** Applies mass only; never writes offers or manufacturer/nutrition approvals. */
export async function applySelectedPackageCorrections(store, receipt) {
  const plans = await prepareSelectedPackageCorrections(store, receipt);
  const applied = [];
  for (const plan of plans) {
    if (plan.action.kind === 'selected-package-mass-review') {
      await store.put('product', reviewedProduct(plan, receipt));
    } else {
      await store.put('specification-hold', heldSpecification(plan, receipt));
    }
    const offer = await store.get('offer', plan.offer.id);
    assert.deepEqual(offer, plan.offer, 'Offer must remain unchanged');
    applied.push({
      sku: plan.action.sku,
      kind: plan.action.kind,
      pricePreserved: offer.price,
      originalObservedAt: offer.observedAt,
      factoryIdentityApproved: false,
      nutritionApproved: false,
    });
  }
  return { ...receipt, status: 'applied', applied, downloads: 0 };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert.ok(options.offline && !options.account, 'Use --offline, no account');
  const receipt = JSON.parse(await readFile(receiptPath));
  const result = await applySelectedPackageCorrections(
    configuredStore(options),
    receipt
  );
  await atomicWrite(receiptPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
