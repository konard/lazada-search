import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssociativeStore } from '../src/index.js';
import { sha256 } from '../src/util.js';

// Export a small, reproducible subset of anonymous captures. Browser profiles,
// scripts, session data and customer reviews are intentionally outside this set.
const source = new AssociativeStore({
  directory: process.argv[2] || '.lazada-search',
});
const target = new AssociativeStore({
  directory: 'tests/fixtures/public-cache/store',
});
const urls = [
  'https://www.lazada.vn/products/pdp-i3261102356.html',
  'https://www.lazada.vn/products/pdp-i3326267977.html',
  'https://www.lazada.vn/products/pdp-i338968082.html',
  'https://www.lazada.vn/products/pdp-i497330157.html',
];
const manifest = {
  market: 'vn',
  deliveryArea: 'Nha Trang',
  captureSubset: true,
  products: [],
  blobs: [],
};
const caches = await source.list('cache');
const products = await source.list('product');
const offers = (await source.list('offer')).filter(
  (offer) => !offer.supersededBy
);
for (const url of urls) {
  const offer = offers.find((entry) => entry.url === url);
  const product = products.find((entry) => entry.id === offer?.productId);
  if (!product) {
    throw new Error(`Missing actual public product: ${url}`);
  }
  const cache = caches.find(
    (entry) => entry.id.startsWith('lazada:') && entry.url === url
  );
  const original = cache.snapshot;
  const labelClaim = product.claims.find(
    (claim) =>
      claim.source === 'manual-review' && claim.field === 'proteinPer100g'
  );
  const labelEvidence =
    labelClaim && (await source.get('evidence', labelClaim.evidenceId));
  const listingEvidence = await source.get('evidence', offer.evidenceId);
  const evidenceIds = [
    listingEvidence.id,
    labelEvidence?.id,
    offer.quoteEvidenceId,
  ].filter(Boolean);
  await target.put('product', {
    ...product,
    claims: product.claims.filter((claim) =>
      evidenceIds.includes(claim.evidenceId)
    ),
    evidenceIds,
    crossChecks: [],
    variants: original.variants,
  });
  await target.put('offer', offer);
  const snapshot = {
    url,
    title: original.title,
    priceText: original.priceText,
    seller: original.seller,
    brand: original.brand,
    sku: original.sku,
    selectedVariant: original.selectedVariant,
    variants: original.variants,
    specs: original.specs,
    description: '',
    rawText: [original.title, ...original.specs].join('\n'),
    jsonLd: original.jsonLd,
    productImages: [],
  };
  await target.put('cache', {
    id: cache.id,
    url,
    snapshot,
    status: cache.status,
    extractorVersion: cache.extractorVersion,
    fetchedAt: cache.fetchedAt,
    checkedAt: cache.checkedAt,
    originalSnapshotSha256: sha256(JSON.stringify(original)),
    captureSubset: true,
  });
  await target.put('evidence', {
    id: listingEvidence.id,
    role: 'listing',
    url,
    observedAt: listingEvidence.observedAt,
    cacheId: cache.id,
    originalSnapshotSha256: sha256(JSON.stringify(original)),
    captureSubset: true,
  });
  if (labelEvidence) {
    const bytes = await source.blob(labelEvidence.image.sha256);
    await target.putBlob(bytes);
    await target.put('evidence', labelEvidence);
    const ocr = await source.get('ocr', labelEvidence.ocrId);
    await target.put('ocr', ocr);
    manifest.blobs.push({
      sha256: labelEvidence.image.sha256,
      bytes: bytes.length,
      url: labelEvidence.url,
    });
  }
  if (offer.quoteEvidenceId) {
    const evidence = await source.get('evidence', offer.quoteEvidenceId);
    await target.put('evidence', {
      id: evidence.id,
      role: evidence.role,
      url: evidence.url,
      observedAt: evidence.observedAt,
      text: evidence.text,
      shippingQuantity: evidence.shippingQuantity,
      shippingDestination: evidence.shippingDestination,
    });
    const quote = caches.find(
      (entry) => entry.evidenceId === offer.quoteEvidenceId
    );
    await target.put('cache', {
      ...quote,
      html: undefined,
      screenshot: undefined,
      snapshot,
      originalSnapshotSha256: sha256(JSON.stringify(quote.snapshot)),
      captureSubset: true,
    });
  }
  manifest.products.push({
    id: product.id,
    offerId: offer.id,
    url,
    observedAt: offer.observedAt,
    cacheId: cache.id,
    evidenceIds,
  });
}
await mkdir('tests/fixtures/public-cache', { recursive: true });
await writeFile(
  join('tests/fixtures/public-cache', 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(
  `Exported ${manifest.products.length} actual products and ${manifest.blobs.length} original label images`
);
