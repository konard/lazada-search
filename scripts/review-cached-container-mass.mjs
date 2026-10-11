import { readFile, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { LazadaSearch, extractPage, parseProduct } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const sourceHash =
  '55616c2c7fce2641eb592a39517f29d3371ed5dd48585c1c1a0f7100331ec852';
const sku = '3095127497_VNAMZ-14849213302';
const html = await readFile(
  'docs/acceptance/bonus-hydropure-evidence/3095127497-14849213302-public.html'
);
if (sha256(html) !== sourceHash) {
  throw new Error('Reviewed selected Hydropure original digest mismatch');
}
const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const app = new LazadaSearch({ store, offline: true, ocr: false });
try {
  const product = (await store.list('product')).find((row) => row.sku === sku);
  if (!product || store.visibility !== 'public') {
    throw new Error('Review requires an existing public selected SKU');
  }
  let evidence;
  for (const id of product.evidenceIds) {
    const entry = await store.get('evidence', id);
    if (
      entry?.html?.sha256 === sourceHash &&
      entry.observedAt === product.observedAt
    ) {
      evidence = entry;
    }
  }
  if (!evidence) {
    throw new Error('Review requires same-observation attached original HTML');
  }
  const { document } = parseHTML(html.toString('utf8'));
  const parsed = parseProduct(extractPage({ document, url: product.url }), {
    evidenceId: evidence.id,
    observedAt: evidence.observedAt,
  });
  if (
    parsed.product.sku !== sku ||
    parsed.product.netMassG !== 2040 ||
    parsed.product.massEvidence.conflicting ||
    parsed.product.massEvidence.selected.scope !== 'selling' ||
    parsed.offer.price !== 999997
  ) {
    throw new Error('Review does not reproduce the exact selected declaration');
  }
  const applied = product.netMassG !== parsed.product.netMassG;
  if (applied) {
    await app.review(product.id, 'netMassG', 2040, evidence.id);
  }
  const receipt = {
    reviewedAt: new Date().toISOString(),
    sku,
    productId: product.id,
    evidenceId: evidence.id,
    sourceSha256: sourceHash,
    originalObservedAt: evidence.observedAt,
    sellerNetMassG: 2040,
    applied,
    downloads: 0,
    priceChanged: false,
    factoryIdentityApproved: false,
    nutritionApproved: false,
    reason:
      'Reparse exact historical evidence because the latest listing cache belongs to a different selling SKU',
  };
  await writeFile(
    'docs/acceptance/container-metric-mass/review-replay.json',
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
