import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { LazadaSearch, extractPage, parseProduct } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
assert.ok(options.offline && !options.account, 'Use an offline public store');
const store = configuredStore(options);
const application = new LazadaSearch({ store, offline: true, ocr: false });
const audit = JSON.parse(
  await readFile(
    'docs/acceptance/urgent-whey-reviews/low-price-identity-audit.json',
    'utf8'
  )
);
const definitions = [
  {
    sku: '13430219487_VNAMZ-117214356196',
    netMassG: 907,
    reason:
      'The selected Double Rich Chocolate front explicitly prints NET WT 2 LB (907 G). The printed gram declaration determines the selling mass. Manufacturer identity remains unresolved.',
  },
  {
    sku: '3145660834_VNAMZ-15003612515',
    netMassG: 1000,
    reason:
      'The original seller front prints 1 KG and NET WT 1000G; the captured description agrees. This is a seller-declared mass, without factory or batch verification.',
  },
];
const reviewed = [];
try {
  for (const definition of definitions) {
    const source = audit.candidates.find(
      (candidate) => candidate.sku === definition.sku
    );
    assert.ok(source);
    const before = await store.get('product', source.productId);
    const evidence = await store.get(
      'evidence',
      source.capturedOffer.evidenceId
    );
    const html = await store.blob(evidence.html.sha256);
    assert.equal(sha256(html), source.capturedOffer.html.sha256);
    const image = source.imageSources[0];
    assert.equal(
      sha256(await store.blob(image.blob.sha256)),
      image.blob.sha256
    );
    const extracted = parseProduct(
      extractPage({
        document: parseHTML(html.toString()).document,
        url: evidence.sourceUrl || evidence.url,
      })
    );
    assert.equal(extracted.product.sku, definition.sku);
    assert.equal(before.sku, definition.sku);
    const after =
      before.netMassG === definition.netMassG &&
      before.reviewedFields?.includes('netMassG')
        ? before
        : await application.review(
            before.id,
            'netMassG',
            definition.netMassG,
            evidence.id
          );
    assert.equal(after.netMassG, definition.netMassG);
    assert.equal(
      after.manufacturerVerification?.identityMatched,
      before.manufacturerVerification?.identityMatched
    );
    reviewed.push({
      ...definition,
      productId: before.id,
      listingEvidenceId: evidence.id,
      sourceHtml: evidence.html,
      sourceImage: image,
      previousMassG: before.netMassG ?? null,
      authority: 'seller package artwork',
      manufacturerVerified: false,
      observedAt: before.observedAt,
      pricePreserved: source.capturedOffer.price,
    });
  }
  const receipt = {
    reviewedAt: new Date().toISOString(),
    downloads: 0,
    reviewed,
  };
  await writeFile(
    'docs/acceptance/urgent-whey-reviews/seller-mass-review.json',
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  console.log(JSON.stringify({ reviewed: reviewed.length, downloads: 0 }));
} finally {
  await application.close();
}
