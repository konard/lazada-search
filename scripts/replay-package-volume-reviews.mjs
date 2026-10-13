import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
  AssociativeStore,
  LazadaSearch,
  reviewPackageQuantities,
  COLLECTION_STOP_ID,
} from '../src/index.js';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/offline-completion-progress';
const app = new LazadaSearch({
  store: new AssociativeStore({
    directory: '.lazada-search/offline-volume-reviews',
    archive: 'data/cases/vietnam-nha-trang',
  }),
  offline: true,
  ocr: false,
});
app.collector.start = () => {
  throw new Error('Offline label replay must not open a browser');
};
app.cache.get = () => {
  throw new Error('Offline label replay must not request a source');
};
try {
  const stop = await app.store.get('collection-stop', COLLECTION_STOP_ID);
  const packets = [];
  for (const sku of [
    '1880785864_VNAMZ-8527716007',
    '1880785864_VNAMZ-8527716006',
  ]) {
    const packet = JSON.parse(
      await readFile(`${directory}/${sku}.review-packet.json`, 'utf8')
    );
    const product = await app.store.get('product', packet.productId);
    assert.equal(product.sku, sku);
    assert.equal(product.observedAt, packet.observedAt);
    assert.deepEqual(product.selectedVariant, packet.selectedVariant);
    assert.equal(
      product.netVolumeMl,
      packet.reviewInput.facts.netVolumeMl.value
    );
    const image = await app.store.blob(packet.originalImageSha256);
    assert.equal(sha256(image), packet.originalImageSha256);
    assert.equal(image.length, packet.evidence.image.bytes);
    assert.equal(
      sha256(await readFile(packet.originalImageArtifact)),
      packet.originalImageSha256
    );
    const original = await app.store.get('evidence', packet.listingEvidenceId);
    assert.equal(original.html.sha256, packet.listingOriginalSha256);
    assert.equal(
      sha256(await app.store.blob(packet.listingOriginalSha256)),
      packet.listingOriginalSha256
    );
    const offers = (await app.store.list('offer')).filter(
      (offer) => offer.productId === product.id
    );
    packets.push({ packet, product, offers });
  }
  const outcomes = [];
  for (const { packet, product, offers } of packets) {
    await app.store.put('evidence', packet.evidence);
    await app.store.put('product', {
      ...product,
      evidenceIds: [
        ...new Set([...(product.evidenceIds || []), packet.evidence.id]),
      ],
    });
    const review = await reviewPackageQuantities(
      app,
      product.id,
      packet.reviewInput
    );
    const repeated = await reviewPackageQuantities(
      app,
      product.id,
      packet.reviewInput
    );
    assert.deepEqual(repeated, review);
    assert.deepEqual(
      (await app.store.list('offer')).filter(
        (offer) => offer.productId === product.id
      ),
      offers
    );
    outcomes.push({
      sku: packet.sku,
      reviewId: review.id,
      reviewSha256: review.reviewSha256,
      netVolumeMl: packet.reviewInput.facts.netVolumeMl.value,
      observedAt: product.observedAt,
      idempotent: true,
    });
  }
  assert.deepEqual(
    await app.store.get('collection-stop', COLLECTION_STOP_ID),
    stop
  );
  const receipt = {
    checkedAt: new Date().toISOString(),
    outcomes,
    sourceDownloads: app.cache.stats.downloads,
    newNumericAmounts: 0,
    manufacturerApprovals: 0,
    nutritionApprovals: 0,
    freightApprovals: 0,
    collectionStopUnchanged: true,
    originalPricesAndObservationDatesUnchanged: true,
  };
  await writeFile(
    `${directory}/volume-replay.json`,
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
