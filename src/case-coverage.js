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
    ...[
      'offer',
      'discovery',
      'sku-inventory',
      'crawl',
      'invalidation',
      'case-category-review',
      'case-inventory',
      'listing-availability',
    ].map((kind) => application.store.list(kind)),
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
  const evidence =
    (await application.store.get('evidence', evidenceId)) ||
    (await application.store.get('cache', evidenceId));
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
        (entry.url === (evidence.url || evidence.sourceUrl) ||
          entry.evidenceIds?.includes(evidenceId) ||
          entry.cacheIds?.includes(evidenceId)) &&
        (entry.invalidated === true ||
          !Number.isFinite(Date.parse(entry.invalidatedAt)) ||
          Date.parse(entry.invalidatedAt) >=
            (typeof evidence.fetchedAt === 'number'
              ? evidence.fetchedAt
              : Date.parse(evidence.observedAt)))
    )
  ) {
    throw new Error('Inventory/review original requires recollection');
  }
  return { evidence, bytes };
}

const categoryDefinition = (record) =>
  Object.fromEntries(
    [
      'scope',
      'recordId',
      'recordFingerprint',
      'decision',
      'category',
      'reason',
      'evidence',
      'reviewedBy',
    ].map((field) => [field, record[field]])
  );

const manualDefinition = (record) =>
  Object.fromEntries(
    [
      'reviewedBy',
      'reason',
      'evidence',
      'scope',
      'scopeFingerprint',
      'exactPriceExtractionReviewed',
      'quantityExtractionReviewed',
      'classificationReviewed',
      'listPaginationReviewed',
      'categoryReviewIds',
    ].map((field) => [field, record[field]])
  );

async function categoryOriginals(application, record, discovery) {
  if (
    !Array.isArray(record.evidence) ||
    !record.evidence.length ||
    record.evidence.length > 100
  ) {
    throw new Error(
      'Each category decision needs bounded attached original evidence'
    );
  }
  for (const binding of record.evidence) {
    const { evidence } = await original(
      application,
      binding.evidenceId,
      binding.sourceSha256
    );
    const sameCardPage = discovery.cacheId === binding.evidenceId;
    const sourceUrl = evidence.url || evidence.sourceUrl;
    const sameItem =
      evidence.role === 'listing' &&
      listingKey(sourceUrl) === listingKey(discovery.url);
    if (!sameCardPage && !sameItem) {
      throw new Error(
        'Category decision original does not belong to this search card or exact listing'
      );
    }
  }
}

async function prepareCategoryDecision(application, decision, reviewedBy) {
  const discovery = await application.store.get('discovery', decision.recordId);
  if (
    !discovery ||
    decision.recordFingerprint !== sha256(JSON.stringify(discovery)) ||
    !['included', 'excluded'].includes(decision.decision) ||
    !decision.reason?.trim() ||
    (decision.decision === 'included' &&
      !['whey', 'protein-powder', 'chocolate-ice-cream'].includes(
        decision.category
      ))
  ) {
    throw new Error(
      'Category decision must bind this exact current card, explicit inclusion/exclusion and reviewed target category'
    );
  }
  const definition = {
    scope: caseScope(application),
    recordId: discovery.id,
    recordFingerprint: decision.recordFingerprint,
    decision: decision.decision,
    category: decision.decision === 'included' ? decision.category : 'unknown',
    reason: decision.reason.trim(),
    evidence: decision.evidence,
    reviewedBy: reviewedBy.trim(),
  };
  await categoryOriginals(application, definition, discovery);
  return {
    ...definition,
    id: `case-category-review:${sha256(JSON.stringify(categoryDefinition(definition)))}`,
  };
}

async function detailedCategoryReviewed(application, product) {
  const review = product.categoryReview;
  if (
    !review ||
    product.category === 'unknown' ||
    review.category !== product.category ||
    !review.reviewedBy?.trim() ||
    !review.reason?.trim() ||
    !Number.isFinite(Date.parse(review.reviewedAt)) ||
    Date.parse(review.reviewedAt) < Date.parse(product.observedAt) ||
    !product.evidenceIds?.includes(review.evidenceId)
  ) {
    return false;
  }
  const evidence = await application.store.get('evidence', review.evidenceId);
  const sourceSha256 = evidence?.html?.sha256;
  if (
    !sourceSha256 ||
    evidence.role !== 'listing' ||
    listingKey(evidence.url || evidence.sourceUrl) !== listingKey(product.url)
  ) {
    return false;
  }
  try {
    await original(application, review.evidenceId, sourceSha256);
    return true;
  } catch {
    return false;
  }
}

async function detailedCategoryGaps(application, reviewed, products) {
  const pending = new Map();
  const byListing = new Map();
  for (const product of products) {
    const key = listingKey(product.url);
    byListing.set(key, [...(byListing.get(key) || []), product]);
  }
  for (const inclusion of reviewed.filter(
    (record) => record.decision === 'included'
  )) {
    for (const product of byListing.get(listingKey(inclusion.url)) || []) {
      const powder = ['whey', 'protein-powder'];
      const compatible =
        product.category !== 'unknown' &&
        (product.category === inclusion.category ||
          (powder.includes(inclusion.category) &&
            powder.includes(product.category)));
      if (
        compatible ||
        (await detailedCategoryReviewed(application, product))
      ) {
        continue;
      }
      pending.set(product.id, {
        productId: product.id,
        url: product.url,
        preliminaryCategory: inclusion.category,
        detailedCategory: product.category || 'unknown',
        evidenceIds: product.evidenceIds || [],
        sourceFingerprint: sha256(JSON.stringify(product)),
        reason:
          'Collected category remains unknown or contradicts preliminary inclusion; exact listing-source review-category is required',
      });
    }
  }
  return [...pending.values()];
}

/** Per-card source decisions remain reusable while unrelated case facts change. */
export async function applyCaseCategoryDecisions(application, audit) {
  const records = await application.store.list('case-category-review');
  const discovered = await application.store.list('discovery');
  const reviewed = [],
    unresolved = [];
  for (const discovery of audit.categoryReview || []) {
    const candidates = records
      .filter(
        (record) =>
          record.scope === caseScope(application) &&
          record.recordId === discovery.id &&
          record.recordFingerprint === sha256(JSON.stringify(discovery)) &&
          record.id ===
            `case-category-review:${sha256(JSON.stringify(categoryDefinition(record)))}` &&
          !record.invalidated &&
          !record.invalidatedAt &&
          Number.isFinite(Date.parse(record.reviewedAt))
      )
      .sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt));
    let active;
    const candidate = candidates[0];
    const tiedConflict =
      candidate &&
      candidates.some(
        (entry) =>
          entry.reviewedAt === candidate.reviewedAt &&
          (entry.decision !== candidate.decision ||
            entry.category !== candidate.category)
      );
    if (candidate && !tiedConflict) {
      try {
        await categoryOriginals(application, candidate, discovery);
        active = candidate;
      } catch {
        /* A failed latest review cannot silently restore an older opposite decision. */
      }
    }
    if (active) {
      reviewed.push({ ...active, url: discovery.url });
    } else {
      unresolved.push(discovery);
    }
  }
  const excludedKeys = new Set(
    reviewed
      .filter((record) => record.decision === 'excluded')
      .map((record) => listingKey(record.url))
  );
  for (const key of [...excludedKeys]) {
    if (
      discovered.some(
        (record) =>
          listingKey(record.url) === key &&
          !reviewed.some(
            (review) =>
              review.recordId === record.id && review.decision === 'excluded'
          )
      )
    ) {
      excludedKeys.delete(key);
    }
  }
  const products = await application.store.list('product');
  const categoryReviewProducts = await detailedCategoryGaps(
    application,
    reviewed,
    products
  );
  const includedMissing = reviewed
    .filter(
      (record) =>
        record.decision === 'included' &&
        !products.some(
          (product) => listingKey(product.url) === listingKey(record.url)
        )
    )
    .map((record) => record.url);
  const result = {
    ...audit,
    categoryReview: unresolved,
    categoryReviewProducts,
    retainedCategoryDecisions: reviewed,
    reviewedExcludedListings: [...excludedKeys],
    unknownListingBacklog: unresolved.map((record) => ({
      id: record.id,
      url: record.url,
      cacheId: record.cacheId,
    })),
    missingListings: [
      ...new Set([...(audit.missingListings || []), ...includedMissing]),
    ].filter((url) => !excludedKeys.has(listingKey(url))),
  };
  for (const field of [
    'missingSkuPrices',
    'missingPrices',
    'unknownSkuInventories',
    'specifications',
  ]) {
    result[field] = (audit[field] || []).filter(
      (record) =>
        !excludedKeys.has(
          listingKey(
            typeof record === 'string'
              ? record
              : record.listingUrl || record.url
          )
        )
    );
  }
  result.visibleSearchComplete =
    result.sourceListsComplete &&
    categoryReviewProducts.length === 0 &&
    [
      'missingListings',
      'missingSkuPrices',
      'missingPrices',
      'unknownSkuInventories',
      'categoryReview',
    ].every((field) => result[field].length === 0);
  result.scopedDatasetReady =
    result.visibleSearchComplete &&
    result.specifications.every((record) => record.problems.length === 0);
  return result;
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
    const parsedUrl = new URL(url);
    const identity = parsedUrl.pathname.match(/-i(\d+)(?:-s(\d+))?\.html$/u);
    const [itemId, skuId] = sku.split('_VNAMZ-');
    if (
      !identity ||
      identity[1] !== itemId ||
      (identity[2] && identity[2] !== skuId) ||
      (parsedUrl.searchParams.has('skuId') &&
        parsedUrl.searchParams.get('skuId') !== skuId)
    ) {
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
  const decisions = input.categoryDecisions || [];
  if (
    !Array.isArray(decisions) ||
    decisions.length > 10000 ||
    new Set(decisions.map((decision) => decision.recordId)).size !==
      decisions.length
  ) {
    throw new Error(
      'Manual category decisions require unique bounded current records'
    );
  }
  const prepared = [];
  for (const decision of decisions) {
    prepared.push(
      await prepareCategoryDecision(application, decision, input.reviewedBy)
    );
  }
  for (const decision of prepared) {
    if (!(await application.store.get('case-category-review', decision.id))) {
      await application.store.put('case-category-review', {
        ...decision,
        reviewedAt: new Date().toISOString(),
      });
    }
  }
  const categoryAudit = await applyCaseCategoryDecisions(
    application,
    scopeAccountAudit(await application.audit(), {
      crawl: latestCrawl(await application.store.list('crawl')),
      discoveries: await application.store.list('discovery'),
      flavourScope: 'chocolate-or-unflavoured',
    })
  );
  if (
    input.classificationReviewed === true &&
    (categoryAudit.categoryReview.length ||
      categoryAudit.categoryReviewProducts.length)
  ) {
    throw new Error(
      'Resolve each unknown search record and pending detailed product category with source-bound decisions before accepting classification'
    );
  }
  const definition = {
    reviewedBy: input.reviewedBy,
    reason: input.reason,
    evidence: input.evidence,
    scope: input.scope,
    scopeFingerprint: await scopeFingerprint(application),
    exactPriceExtractionReviewed: input.exactPriceExtractionReviewed === true,
    quantityExtractionReviewed: input.quantityExtractionReviewed === true,
    classificationReviewed: input.classificationReviewed === true,
    listPaginationReviewed: input.listPaginationReviewed === true,
    categoryReviewIds: prepared.map((record) => record.id),
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
  const audit = await applyCaseCategoryDecisions(
    application,
    scopeAccountAudit(await application.audit(), {
      crawl,
      discoveries: await application.store.list('discovery'),
      flavourScope: 'chocolate-or-unflavoured',
    })
  );
  const manifest = input.inventoryId
    ? await verifyCaseInventory(application, input)
    : null;
  const review = input.manualReviewId
    ? await application.store.get('case-manual-review', input.manualReviewId)
    : null;
  const fingerprint = await scopeFingerprint(application);
  const scope = caseScope(application);
  let reviewValid = Boolean(
    review &&
    !review.invalidated &&
    !review.invalidatedAt &&
    review.scope === scope &&
    review.scopeFingerprint === fingerprint &&
    review.id ===
      `case-manual-review:${sha256(JSON.stringify(manualDefinition(review)))}` &&
    Number.isFinite(Date.parse(review.reviewedAt)) &&
    Date.parse(review.reviewedAt) <= Date.now() + 60000
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
