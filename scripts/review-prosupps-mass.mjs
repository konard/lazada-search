import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LazadaSearch } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
assert.ok(options.offline && !options.account, 'Use offline public evidence');
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
try {
  const review = JSON.parse(
    await readFile(
      'docs/acceptance/top10-check/whey-source-review.json',
      'utf8'
    )
  );
  const row = review.rows.find((r) => r.sku === '1553990700_VNAMZ-6552645102');
  assert.equal(row.recommendedMassG, 907);
  const image = await readFile(
    'docs/acceptance/top10-check/prosupps-chocolate-front-original.webp'
  );
  assert.equal(sha256(image), review.prosuppsPrintedMassEvidence.sha256);
  const comparison = (await app.compare({ allowStale: true })).comparisons.find(
    (r) => r.offer.sku === row.sku
  );
  assert.ok(comparison);
  const evidence = await app.store.get('evidence', comparison.offer.evidenceId);
  assert.equal(
    sha256(await app.store.blob(evidence.html.sha256)),
    row.sourceHtmlSha256
  );
  if (
    comparison.product.netMassG !== 907 ||
    !comparison.product.reviewedFields?.includes('netMassG')
  ) {
    await app.review(comparison.product.id, 'netMassG', 907, evidence.id);
  }
  console.log(
    JSON.stringify({
      sku: row.sku,
      massG: 907,
      pricePreserved: comparison.offer.price,
      downloads: 0,
      manufacturerVerified: comparison.manufacturerVerified,
    })
  );
} finally {
  await app.close();
}
