import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { LazadaSearch, reviewPackageQuantities } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const label = {
  path: 'docs/acceptance/ice-dual-units/expanded-powercap-abc-front.png',
  sha256: '36b92b0233b8325abaee53fbb563ea92ab4a3383125ce403988f2a8901541819',
  url: 'https://abcf.com.br/wp-content/uploads/2025/11/abc-powercap-chocolate.png',
  observedAt: '2026-10-10T17:30:16.574451+00:00',
};
const expected = [
  ['2978009544_VNAMZ-14350953081', 1, 27000, '2026-10-10T16:15:39.896Z'],
  ['3040048563_VNAMZ-14623760583', 24, 648000, '2026-10-10T17:37:10.328Z'],
];

export async function reviewCachedIceQuantities(application) {
  assert.ok(
    application.cache.offline && application.store.visibility === 'public',
    'Use an offline public store'
  );
  const original = await readFile(label.path);
  assert.equal(
    sha256(original),
    label.sha256,
    'Original reviewed wrapper differs'
  );
  const report = await application.compare({ allowStale: true });
  const plans = [];
  for (const [sku, count, price, observedAt] of expected) {
    const row = report.comparisons.find((entry) => entry.offer.sku === sku);
    assert.ok(row, `Missing exact captured SKU: ${sku}`);
    assert.equal(row.product.category, 'chocolate-ice-cream');
    assert.equal(row.product.netVolumeMl, 130);
    assert.equal(row.product.packCount || 1, count);
    assert.equal(row.offer.price, price);
    assert.equal(row.offer.observedAt, observedAt);
    assert.equal(row.product.observedAt, observedAt);
    assert.equal(row.offer.variantConfirmed, true);
    const listing = await application.store.get(
      'evidence',
      row.offer.evidenceId
    );
    assert.ok(listing?.html && row.product.evidenceIds.includes(listing.id));
    const html = await application.store.blob(listing.html.sha256);
    assert.equal(sha256(html), listing.html.sha256);
    plans.push({ row, listing });
  }
  const source = await application.store.putBlob(original);
  const applied = [];
  for (const { row, listing } of plans) {
    const sourceEvidenceId = `package-quantity-source:${row.product.id}:${label.sha256}`;
    await application.store.put('evidence', {
      id: sourceEvidenceId,
      role: 'package-label-review',
      productId: row.product.id,
      url: label.url,
      observedAt: label.observedAt,
      image: source,
      sourceAuthority: 'manufacturer-label-secondary-host',
      sourceReview:
        'docs/acceptance/ice-dual-units/korean-expanded-review.json',
      exactNutritionApproved: false,
      sellerAuthenticityApproved: false,
    });
    const captured = await application.store.get('product', row.product.id);
    if (!captured.evidenceIds.includes(sourceEvidenceId)) {
      await application.store.put('product', {
        ...captured,
        evidenceIds: [...captured.evidenceIds, sourceEvidenceId],
      });
    }
    const review = await reviewPackageQuantities(application, row.product.id, {
      reviewedBy: 'Cached wrapper review and independent source audit',
      reason:
        'The previously reviewed original factory wrapper prints131g and130ml and matches the selected PowerCap chocolate export family. Apply printed package mass only. The source is hosted by an importer; exact seller lot, GTIN, factory nutrition and formula remain unverified.',
      listingEvidenceId: listing.id,
      listingSha256: listing.html.sha256,
      facts: {
        netMassG: {
          value: 131,
          unit: 'g',
          basis: 'one-inner-food-package',
          sourceEvidenceId,
          sourceSha256: label.sha256,
          sourceAuthority: 'manufacturer-label-secondary-host',
          excerpt: '130mL; 净含量131克',
          identityMatched: true,
        },
      },
    });
    applied.push({
      sku: row.offer.sku,
      productId: row.product.id,
      reviewSha256: review.reviewSha256,
    });
  }
  const recalculated = await application.compare({ allowStale: true });
  for (const [sku, count, price, observedAt] of expected) {
    const row = recalculated.comparisons.find(
      (entry) => entry.offer.sku === sku
    );
    assert.equal(row.metrics.totalMassG, count * 131);
    assert.equal(row.metrics.totalVolumeMl, count * 130);
    assert.equal(row.metrics.costPerGramBeforeDelivery, price / (count * 131));
    assert.equal(row.metrics.costPerMlBeforeDelivery, price / (count * 130));
    assert.equal(row.metrics.totalProteinG, null);
    assert.equal(row.metrics.totalAfterDelivery, null);
    assert.equal(row.manufacturerVerified, false);
    assert.equal(row.offer.observedAt, observedAt);
    const originalOffer = plans.find((plan) => plan.row.offer.sku === sku).row
      .offer;
    assert.deepEqual(
      row.offer,
      originalOffer,
      'Quantity review must preserve offer and freight'
    );
  }
  return {
    reviewedAt: new Date().toISOString(),
    label,
    applied,
    downloads: 0,
    factoryIdentityApproved: false,
    nutritionApproved: false,
    pricesAndObservationDatesPreserved: true,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert.ok(
    options.offline && !options.account,
    'Use --offline with no private account'
  );
  const app = new LazadaSearch({
    store: configuredStore(options),
    offline: true,
    ocr: false,
  });
  try {
    const receipt = await reviewCachedIceQuantities(app);
    await writeFile(
      'docs/acceptance/ice-unit-completeness/shared-quantity-review.json',
      await format(JSON.stringify(receipt), { parser: 'json' })
    );
    console.log(JSON.stringify(receipt));
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
