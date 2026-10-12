import { latestCrawl } from './crawl.js';
import { sha256, listingKey } from './util.js';
import { scopeAccountAudit } from './collection-scope.js';
import { currentUnavailableListings } from './availability.js';
import { catalogProducts } from './catalog-products.js';

function caseScope(application) {
  return `vn:chocolate-or-unflavoured-whey+strict-chocolate-ice-cream:${application.deliveryArea}`;
}

async function scopeFingerprint(application) {
  const groups = await Promise.all([
    catalogProducts(application.store),
    ...['offer', 'discovery', 'sku-inventory', 'crawl', 'invalidation'].map(
      (kind) => application.store.list(kind)
    ),
  ]);
  return sha256(
    JSON.stringify(
      groups.map((records) =>
        records
          .map((record) => [record.id, sha256(JSON.stringify(record))])
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      )
    )
  );
}

function pointer(value, path) {
  if (path === '') {
    return value;
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('Inventory mapping needs a JSON pointer');
  }
  for (const field of path
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (['__proto__', 'constructor', 'prototype'].includes(field)) {
      throw new Error('Unsafe inventory pointer');
    }
    value = value?.[field];
  }
  return value;
}

async function original(application, evidenceId, sourceSha256) {
  const evidence = await application.store.get('evidence', evidenceId);
  const descriptor = [evidence?.blob, evidence?.html].find(
    (entry) => entry?.sha256 === sourceSha256
  );
  const bytes = descriptor
    ? await application.store.blob(sourceSha256)
    : undefined;
  if (
    !bytes ||
    sha256(bytes) !== sourceSha256 ||
    descriptor.bytes !== bytes.length ||
    evidence.invalidated ||
    evidence.invalidatedAt
  ) {
    throw new Error(
      'Inventory/review original is missing, changed or invalidated'
    );
  }
  const invalidations = await application.store.list('invalidation');
  if (
    invalidations.some(
      (entry) =>
        entry.active !== false &&
        !entry.resolvedAt &&
        (entry.url === evidence.url || entry.evidenceIds?.includes(evidenceId))
    )
  ) {
    throw new Error('Inventory/review original requires recollection');
  }
  return { evidence, bytes };
}

function exactManifestRows(application, source, mapping) {
  const rows = pointer(source, mapping.rowsPointer);
  if (!Array.isArray(rows) || rows.length > 1000000) {
    throw new Error('Inventory rows require a bounded original array');
  }
  const result = rows.map((row) => {
    const url = pointer(row, mapping.urlPointer);
    const sku = String(pointer(row, mapping.skuPointer) || '');
    if (!sku || !/^\d+_VNAMZ-\d+$/u.test(sku)) {
      throw new Error('Exact marketplace item/SKU identity required');
    }
    application.assertMarket(url);
    if (!new URL(url).pathname.includes(`-i${sku.split('_VNAMZ-')[0]}`)) {
      throw new Error('Inventory item/SKU and URL disagree');
    }
    return { url, sku };
  });
  const identities = result.map((row) => `${listingKey(row.url)}:${row.sku}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error('Inventory contains duplicate exact item/SKU rows');
  }
  const total = pointer(source, mapping.reportedTotalPointer);
  const terminal = pointer(source, mapping.terminalPointer);
  if (
    !Number.isSafeInteger(total) ||
    total !== result.length ||
    terminal !== mapping.terminalValue ||
    ![null, false, 0, ''].includes(terminal)
  ) {
    throw new Error(
      'Original inventory total/terminal marker does not establish this complete export'
    );
  }
  return result;
}

/** A source-bound declared inventory is distinct from public-search exhaustion. */
export async function importCaseInventoryManifest(application, input) {
  if (!input.reviewedBy?.trim() || !input.scope?.trim() || !input.mapping) {
    throw new Error(
      'Inventory requires explicit source-mapping and scope review'
    );
  }
  const { evidence, bytes } = await original(
    application,
    input.evidenceId,
    input.sourceSha256
  );
  application.assertMarket(evidence.url || evidence.sourceUrl);
  const source = JSON.parse(bytes.toString('utf8'));
  const rows = exactManifestRows(application, source, input.mapping);
  const proof = {
    evidenceId: input.evidenceId,
    sourceSha256: input.sourceSha256,
    mapping: input.mapping,
    scope: input.scope,
    reviewedBy: input.reviewedBy,
    rows,
    observedAt: evidence.observedAt,
    market: application.market,
  };
  const id = `case-inventory:${sha256(JSON.stringify(proof))}`;
  const previous = await application.store.get('case-inventory', id);
  return (
    previous ||
    application.store.put('case-inventory', {
      ...proof,
      id,
      importedAt: new Date().toISOString(),
      sourceCoverage: 'declared-original-export',
      allMarketCoverageProven: false,
      codeValidation: 'draft-untested',
    })
  );
}

export async function recordCaseManualReview(application, input) {
  if (
    !input.reviewedBy?.trim() ||
    !input.reason?.trim() ||
    !Array.isArray(input.evidence) ||
    !input.evidence.length
  ) {
    throw new Error('Manual review requires original evidence and a reviewer');
  }
  if (input.evidence.length > 10000) {
    throw new Error('Manual review evidence bound exceeded');
  }
  if (
    input.scope !== caseScope(application) ||
    input.scopeFingerprint !== (await scopeFingerprint(application))
  ) {
    throw new Error(
      'Manual review must bind the current target scope and exact dataset fingerprint'
    );
  }
  for (const binding of input.evidence) {
    await original(application, binding.evidenceId, binding.sourceSha256);
  }
  const definition = {
    reviewedBy: input.reviewedBy,
    reason: input.reason,
    evidence: input.evidence,
    scope: input.scope,
    scopeFingerprint: input.scopeFingerprint,
    exactPriceExtractionReviewed: input.exactPriceExtractionReviewed === true,
    quantityExtractionReviewed: input.quantityExtractionReviewed === true,
    classificationReviewed: input.classificationReviewed === true,
    listPaginationReviewed: input.listPaginationReviewed === true,
  };
  const id = `case-manual-review:${sha256(JSON.stringify(definition))}`;
  return (
    (await application.store.get('case-manual-review', id)) ||
    application.store.put('case-manual-review', {
      ...definition,
      id,
      reviewedAt: new Date().toISOString(),
      allMarketCoverageProven: false,
    })
  );
}

export async function verifyCaseInventory(application, input = {}) {
  const inventory = await application.store.get(
    'case-inventory',
    input.inventoryId
  );
  if (!inventory) {
    throw new Error('Unknown exact inventory manifest');
  }
  const { bytes } = await original(
    application,
    inventory.evidenceId,
    inventory.sourceSha256
  );
  const rows = exactManifestRows(
    application,
    JSON.parse(bytes.toString('utf8')),
    inventory.mapping
  );
  if (JSON.stringify(rows) !== JSON.stringify(inventory.rows)) {
    throw new Error('Stored inventory differs from its original mapped rows');
  }
  const offers = await application.store.list('offer');
  const removed = currentUnavailableListings(
    await application.store.list('listing-availability'),
    offers,
    await application.store.list('invalidation')
  );
  const missing = rows.filter(
    (row) =>
      !offers.some(
        (offer) =>
          !offer.supersededBy &&
          offer.sku === row.sku &&
          listingKey(offer.url) === listingKey(row.url) &&
          offer.variantConfirmed &&
          offer.price > 0 &&
          !offer.priceInvalidated
      )
  );
  const retainedUnavailable = missing.filter((row) => {
    const notice = removed.get(listingKey(row.url));
    return (
      notice &&
      Date.parse(notice.observedAt) >= Date.parse(inventory.observedAt)
    );
  });
  const pending = missing.filter((row) => !retainedUnavailable.includes(row));
  return {
    inventoryId: inventory.id,
    declaredRows: rows.length,
    missing: pending,
    unavailable: retainedUnavailable,
    scopedPricesComplete: pending.length === 0,
    scope: inventory.scope,
    allMarketCoverageProven: false,
    codeValidation: 'draft-untested',
  };
}

export async function caseCoverageStatus(application, input = {}) {
  const crawl = latestCrawl(await application.store.list('crawl'));
  const audit = scopeAccountAudit(await application.audit(), {
    crawl,
    discoveries: await application.store.list('discovery'),
    flavourScope: 'chocolate-or-unflavoured',
  });
  const manifest = input.inventoryId
    ? await verifyCaseInventory(application, input)
    : null;
  const review = input.manualReviewId
    ? await application.store.get('case-manual-review', input.manualReviewId)
    : null;
  const fingerprint = await scopeFingerprint(application);
  const scope = caseScope(application);
  let reviewValid = Boolean(
    review && review.scope === scope && review.scopeFingerprint === fingerprint
  );
  if (review) {
    try {
      for (const item of review.evidence) {
        await original(application, item.evidenceId, item.sourceSha256);
      }
    } catch {
      reviewValid = false;
    }
  }
  return {
    audit,
    manifest,
    scope,
    scopeFingerprint: fingerprint,
    manualReview: reviewValid ? review : null,
    observedScopeReady:
      audit.scopedDatasetReady &&
      (!manifest ||
        (manifest.scopedPricesComplete && manifest.scope === scope)) &&
      reviewValid &&
      review.exactPriceExtractionReviewed &&
      review.quantityExtractionReviewed &&
      review.classificationReviewed &&
      review.listPaginationReviewed,
    allMarketProductsCollected: false,
    productionReady: false,
    codeValidation: 'draft-untested',
  };
}
