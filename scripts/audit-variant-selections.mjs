import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { configuredStore, parseArguments } from '../src/config.js';
import {
  preferredVariant,
  requestedSku,
  VARIANT_POLICY_VERSION,
} from '../src/variant-policy.js';
import { sha256, canonicalUrl } from '../src/util.js';

const account = configuredStore(
  parseArguments(['--account', 'default', '--offline', '--no-ocr'])
);
const store = account.fallback;
const offers = await account.list('offer');
const captured = new Set(
  offers
    .filter((row) => row.variantConfirmed && row.price > 0 && !row.supersededBy)
    .map((row) => String(row.sku).split('_VNAMZ-').at(-1))
);
const rows = [];
for (const source of await account.list('cache')) {
  if (
    source.status !== 'ok' ||
    !source.snapshot ||
    !/\/products\//u.test(source.url || '') ||
    requestedSku(source.url)
  ) {
    continue;
  }
  const preferred = preferredVariant(
    source.snapshot,
    'chocolate-or-unflavoured'
  );
  if (!preferred) {
    continue;
  }
  const selected = String(source.snapshot.sku || '')
    .split('_VNAMZ-')
    .at(-1);
  if (selected === preferred.sku && !source.variantSelection?.changed) {
    continue;
  }
  const row = {
    id: `variant-selection-review:${sha256(canonicalUrl(source.url))}`,
    policyVersion: VARIANT_POLICY_VERSION,
    url: canonicalUrl(source.url),
    sourceHtmlSha256: source.html?.sha256,
    originalObservedAt: new Date(source.fetchedAt).toISOString(),
    observedSku: source.snapshot.sku,
    preferredSku: preferred.sku,
    preferredOptions: preferred.options,
    status:
      selected === preferred.sku
        ? 'selection-corrected-before-capture'
        : captured.has(preferred.sku)
          ? 'preferred-price-already-captured'
          : 'recollect-after-initial-pass',
    reason:
      'A generic listing must select a complete chocolate/no-shaker SKU before recording its price',
    originalObservationPreserved: true,
  };
  await store.put('variant-selection-review', row);
  rows.push(row);
}
const pending = rows.filter(
  (row) => row.status === 'recollect-after-initial-pass'
);
const auditPath = 'docs/acceptance/saved-extraction-audit.json';
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const existing = new Set(
  audit.recollectionAfterInitialPass.map((row) => canonicalUrl(row.url))
);
for (const row of pending) {
  if (!existing.has(row.url)) {
    audit.recollectionAfterInitialPass.push({
      ...row,
      needsVisualReview: true,
    });
    existing.add(row.url);
  }
}
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
await mkdir('docs/acceptance/preferred-variant', { recursive: true });
const report = {
  auditedAt: new Date().toISOString(),
  policyVersion: VARIANT_POLICY_VERSION,
  downloads: 0,
  reviewed: rows.length,
  pendingRecollection: pending.length,
  recollectionWaitsForInitialPass: true,
  rows,
};
await writeFile(
  'docs/acceptance/preferred-variant/cached-selection-review.json',
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify({ ...report, rows: undefined }));
