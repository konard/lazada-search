import { randomUUID } from 'node:crypto';
import { sha256, positive } from './util.js';
import { COLLECTION_STOP_ID } from './page-challenge.js';
import { parseHTML } from 'linkedom';
import {
  TRANSLATION_QUALITY_FINGERPRINT,
  translationEntities,
  translationReviewAccepted,
} from './translation-quality.js';
import { workflowSourceInvalidated } from './source-invalidation.js';

const schemaVersion = 2;
const kinds = [
  'product',
  'offer',
  'discovery',
  'sku-inventory',
  'cache',
  'evidence',
  'ocr',
];
const textFields = new Set([
  'title',
  'name',
  'label',
  'text',
  'rawText',
  'bodyText',
  'description',
  'ingredients',
  'brand',
  'flavour',
  'flavor',
  'sellerName',
  'seller',
  'sellerText',
  'priceText',
  'originalPriceText',
  'promotionText',
  'shippingText',
  'deliveryText',
  'voucherText',
  'conditions',
  'condition',
  'specs',
  'highlights',
  'alt',
]);
const blockedFields = new Set([
  'words',
  'html',
  'rawTsv',
  'cookies',
  'session',
  'headers',
  'credentials',
  'token',
  'password',
  'phone',
  'email',
  'shippingDestination',
  'address',
]);
const digest = (text) => sha256(Buffer.from(text, 'utf8'));
const now = () => new Date().toISOString();

function chunks(text, maxBytes) {
  const result = [];
  let textPart = '',
    bytes = 0,
    offset = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) {
      result.push({ text: textPart, offset });
      offset += textPart.length;
      textPart = '';
      bytes = 0;
    }
    textPart += character;
    bytes += size;
  }
  if (textPart) {
    result.push({ text: textPart, offset });
  }
  return result;
}

function humanText(value, path = [], selected = false, output = []) {
  if (typeof value === 'string') {
    if (selected && value.trim() && /\p{L}/u.test(value)) {
      output.push({ path, text: value });
    }
    return output;
  }
  if (!value || typeof value !== 'object') {
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      blockedFields.has(key) ||
      /^access.?token|secret|authorization$/iu.test(key)
    ) {
      continue;
    }
    humanText(
      child,
      [...path, key],
      Array.isArray(value) ? selected : textFields.has(key),
      output
    );
  }
  return output;
}

function scopeOptions(options) {
  if (options.productIds !== undefined && !Array.isArray(options.productIds)) {
    throw new Error('Translation product IDs must be an array');
  }
  for (const field of ['cacheOnly', 'includeSources', 'refresh']) {
    if (options[field] !== undefined && typeof options[field] !== 'boolean') {
      throw new Error(`Translation ${field} must be boolean`);
    }
  }
  const productIds = [...new Set(options.productIds || [])].sort();
  if (productIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('Translation product IDs must be nonempty strings');
  }
  const maxChunkBytes = options.maxChunkBytes ?? 8192;
  positive(maxChunkBytes, 'maxChunkBytes', { integer: true });
  if (maxChunkBytes < 4 || maxChunkBytes > 1048576) {
    throw new Error('Translation chunk size must be 4..1048576 bytes');
  }
  return {
    productIds,
    includeSources: options.includeSources !== false,
    maxChunkBytes,
    sourceLanguage: options.sourceLanguage || 'vi',
    targetLanguage: options.targetLanguage || 'en',
  };
}

function recordItems(kind, record, scope) {
  const sourceEvidenceHash = record.html?.sha256 || record.imageHash;
  return humanText(record).flatMap(({ path, text }) => {
    if (
      record.visibility === 'private' &&
      ['rawText', 'bodyText'].includes(path.at(-1))
    ) {
      return [];
    }
    const originalSourceSha256 = digest(text);
    const pieces = chunks(text, scope.maxChunkBytes);
    const chunkPartitionSha256 = digest(
      JSON.stringify(pieces.map((piece) => [piece.offset, digest(piece.text)]))
    );
    return pieces.map(({ text: originalText, offset }, index) => ({
      id: `translation-catalog-source:${digest(JSON.stringify([kind, record.id, path, originalSourceSha256, chunkPartitionSha256, index]))}`,
      sourceKind: kind,
      sourceRecordId: record.id,
      path,
      chunkIndex: index,
      chunkCount: pieces.length,
      chunkPartitionSha256,
      offset,
      originalText,
      sourceSha256: digest(originalText),
      originalSourceSha256,
      ...(sourceEvidenceHash ? { sourceEvidenceHash } : {}),
      evidenceIds:
        kind === 'evidence' ? [record.id] : [...(record.evidenceIds || [])],
      presentationOnly: true,
      authoritative: false,
      protectedEntities: translationEntities(
        originalText,
        record.brand ? [record.brand] : []
      ),
    }));
  });
}

function belongs(record, scope, productIds, evidenceIds, urls, imageHashes) {
  if (!scope.productIds.length) {
    return true;
  }
  return (
    productIds.has(record.id) ||
    productIds.has(record.productId) ||
    evidenceIds.has(record.id) ||
    urls.has(record.url) ||
    imageHashes.has(record.imageHash)
  );
}

function collectHashes(value, hashes) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (/^[a-f\d]{64}$/u.test(value.sha256 || '')) {
    hashes.add(value.sha256);
  }
  for (const child of Object.values(value)) {
    collectHashes(child, hashes);
  }
}

function htmlSources(records) {
  const sources = new Map();
  for (const record of records) {
    if (record.visibility !== 'private' && record.html?.sha256) {
      const hash = record.html.sha256;
      const evidenceIds = sources.get(hash) || new Set();
      if (record.id && record.role) {
        evidenceIds.add(record.id);
      }
      for (const id of record.evidenceIds || []) {
        evidenceIds.add(id);
      }
      sources.set(hash, evidenceIds);
    }
  }
  return sources;
}

function htmlItems(hash, bytes, evidenceIds, scope) {
  const { document } = parseHTML(bytes.toString('utf8'));
  for (const element of document.querySelectorAll(
    'script,style,noscript,form,input,textarea,[hidden],[aria-hidden="true"],#myAccountTrigger,[data-private]'
  )) {
    element.remove();
  }
  const root = document.body?.textContent
    ? document.body
    : document.documentElement;
  const text = root?.innerText || root?.textContent || '';
  return recordItems(
    'html-text',
    {
      id: `html:${hash}`,
      text,
      html: { sha256: hash },
      evidenceIds: [...evidenceIds],
    },
    scope
  );
}

async function sourceTextItems(application, records, gaps, scope) {
  const [caches, invalidations] = await Promise.all([
    application.store.list('cache'),
    application.store.list('invalidation'),
  ]);
  for (const record of records) {
    if (
      workflowSourceInvalidated(
        { ...record, url: record.url || record.sourceUrl },
        caches,
        invalidations
      )
    ) {
      gaps.push({ reason: 'source-invalidated', evidenceId: record.id });
    }
  }
  const hashes = new Set(
    records
      .flatMap((record) => [
        record.html?.sha256,
        record.image?.sha256,
        record.blob?.sha256,
        record.screenshot?.sha256,
        record.imageHash,
      ])
      .filter(Boolean)
  );
  const sources = htmlSources(records);
  const items = [];
  const lengths = new Map();
  for (const record of records) {
    for (const descriptor of [
      record.html,
      record.image,
      record.blob,
      record.screenshot,
    ].filter(Boolean)) {
      const expected = lengths.get(descriptor.sha256) || new Set();
      expected.add(descriptor.bytes);
      lengths.set(descriptor.sha256, expected);
    }
  }
  for (const hash of hashes) {
    const bytes = await application.store.blob(hash);
    if (
      !bytes ||
      digest(bytes) !== hash ||
      [...(lengths.get(hash) || [])].some(
        (length) => !Number.isSafeInteger(length) || bytes.length !== length
      )
    ) {
      gaps.push({
        reason: 'source-bytes-not-cached-or-invalid',
        sourceEvidenceHash: hash,
      });
    } else if (sources.has(hash)) {
      items.push(...htmlItems(hash, bytes, sources.get(hash), scope));
    }
  }
  return items;
}

/** Plan cached human text only. Does not fetch, translate or mutate the catalog. */
export async function planCatalogTranslation(application, options = {}) {
  const scope = scopeOptions(options);
  const products = await application.store.list('product');
  const selected = scope.productIds.length
    ? products.filter((item) => scope.productIds.includes(item.id))
    : products;
  const productIds = new Set(selected.map((item) => item.id));
  const evidenceIds = new Set(
    selected.flatMap((item) => item.evidenceIds || [])
  );
  const urls = new Set(selected.map((item) => item.url).filter(Boolean));
  const imageHashes = new Set();
  selected.forEach((record) => collectHashes(record, imageHashes));
  const gaps = scope.productIds
    .filter((id) => !productIds.has(id))
    .map((id) => ({ reason: 'product-not-cached', productId: id }));
  const items = [],
    records = {},
    sourceRecords = [];
  for (const kind of scope.includeSources ? kinds : ['product']) {
    const sources =
      kind === 'product' ? selected : await application.store.list(kind);
    const matching = sources.filter((record) =>
      belongs(record, scope, productIds, evidenceIds, urls, imageHashes)
    );
    records[kind] = matching.length;
    for (const record of matching) {
      collectHashes(record, imageHashes);
      sourceRecords.push(record);
      items.push(...recordItems(kind, record, scope));
    }
  }
  if (scope.includeSources) {
    items.push(
      ...(await sourceTextItems(application, sourceRecords, gaps, scope))
    );
    const available = new Set(
      (await application.store.list('evidence')).map((record) => record.id)
    );
    for (const id of evidenceIds) {
      if (!available.has(id)) {
        gaps.push({ reason: 'source-evidence-not-cached', evidenceId: id });
      }
    }
  }
  items.sort((left, right) => left.id.localeCompare(right.id));
  const fingerprint = digest(
    JSON.stringify([
      schemaVersion,
      TRANSLATION_QUALITY_FINGERPRINT,
      scope,
      items.map((item) => [item.id, item.protectedEntities]),
      gaps,
    ])
  );
  return {
    schemaVersion,
    fingerprint,
    scope,
    products: selected.length,
    records,
    items,
    gaps,
    uniqueTexts: new Set(items.map((item) => item.sourceSha256)).size,
    catalogInventoryComplete: false,
  };
}

async function putRecords(store, kind, records) {
  if (!records.length) {
    return;
  }
  if (typeof store.putMany === 'function') {
    await store.putMany(kind, records);
  } else {
    for (const record of records) {
      await store.put(kind, record);
    }
  }
}

function jobIdentity(application, plan, options) {
  const identity = [
    plan.fingerprint,
    plan.scope.sourceLanguage,
    plan.scope.targetLanguage,
    application.translator.providerId,
    application.translator.providerVersion,
  ];
  if (
    options.jobId !== undefined &&
    (typeof options.jobId !== 'string' ||
      !/^[a-zA-Z0-9._:-]{1,160}$/u.test(options.jobId))
  ) {
    throw new Error(
      'Translation job ID must contain only letters, numbers, dots, underscores, colons or hyphens'
    );
  }
  return (
    options.jobId || `translation-catalog:${digest(JSON.stringify(identity))}`
  );
}

function summary(job, states, plan, run) {
  const translated = states.filter(
    (item) => item.status === 'translated'
  ).length;
  const pending = states.filter((item) => item.status === 'pending').length;
  const remaining = states.length - translated - pending;
  const reviewed = states.filter(
    (item) => item.status === 'translated' && item.reviewAccepted
  ).length;
  const complete =
    states.length > 0 && translated === states.length && !plan.gaps.length;
  const reasons = {};
  for (const item of states.filter((item) => item.reason)) {
    reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  }
  return {
    ...job,
    updatedAt: now(),
    status: run.stopped
      ? 'stopped'
      : complete
        ? 'complete'
        : translated || pending
          ? 'partial'
          : 'pending',
    complete,
    reviewedComplete: complete && reviewed === states.length,
    counts: {
      total: states.length,
      uniqueTexts: plan.uniqueTexts,
      translated,
      pending,
      remaining,
      reviewed,
      reviewPending: translated - reviewed,
    },
    lastRun: {
      processed: run.processed,
      cacheHits: run.cacheHits,
      providerResults: run.providerResults,
      stopped: run.stopped,
    },
    pendingReasons: reasons,
    sourceGaps: plan.gaps,
    catalogInventoryComplete: false,
    acceptance: complete
      ? 'enumerated-cached-text-translated'
      : 'complete-catalog-English-pending',
  };
}

async function existingState(application, job, item, compatible) {
  const id = `translation-catalog-item:${digest(JSON.stringify([job.id, item.id]))}`;
  const previous = compatible
    ? await application.store.get('translation-catalog-item', id)
    : undefined;
  const cached = await application.translator.cached(item.originalText, {
    ...job,
    protectedEntities: item.protectedEntities,
  });
  const fresh =
    cached &&
    (!job.refreshStartedAt ||
      Date.parse(cached.translatedAt) >= Date.parse(job.refreshStartedAt));
  return {
    ...previous,
    id,
    jobId: job.id,
    sourceId: item.id,
    reviewAccepted: false,
    status: fresh
      ? 'translated'
      : previous?.status === 'pending'
        ? 'pending'
        : 'unprocessed',
    ...(fresh ? { reason: undefined } : {}),
    ...(fresh
      ? {
          translationId: cached.id,
          translatedSha256: cached.translatedSha256,
          reviewAccepted: translationReviewAccepted(cached),
        }
      : {}),
  };
}

function refreshState(previous, compatible, options) {
  if (compatible && !previous.complete && previous.refreshStartedAt) {
    return {
      refreshStartedAt: previous.refreshStartedAt,
      refreshId: previous.refreshId,
    };
  }
  return options.refresh
    ? { refreshStartedAt: now(), refreshId: randomUUID() }
    : {};
}

function createJob(application, plan, id, previous, compatible, options) {
  return {
    id,
    schemaVersion,
    fingerprint: plan.fingerprint,
    scope: plan.scope,
    sourceLanguage: plan.scope.sourceLanguage,
    targetLanguage: plan.scope.targetLanguage,
    providerId: application.translator.providerId,
    providerVersion: application.translator.providerVersion,
    presentationOnly: true,
    authoritative: false,
    createdAt: compatible ? previous.createdAt : now(),
    cacheOnly: options.cacheOnly !== false || application.translator.offline,
    ...refreshState(previous, compatible, options),
    plan: { products: plan.products, records: plan.records },
  };
}

async function processItem(application, job, item, state, run) {
  run.processed += 1;
  state.attempts = (state.attempts || 0) + 1;
  state.lastAttemptAt = now();
  delete state.reason;
  if (job.cacheOnly) {
    state.status = 'pending';
    state.reason = job.refreshStartedAt
      ? 'refresh-needs-provider'
      : 'cache-only-miss';
    return;
  }
  const fresh = await application.translator.cached(item.originalText, {
    ...job,
    protectedEntities: item.protectedEntities,
  });
  const result = await application.translate(item.originalText, {
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    protectedEntities: item.protectedEntities,
    refresh: Boolean(
      job.refreshStartedAt &&
      (!fresh ||
        Date.parse(fresh.translatedAt) < Date.parse(job.refreshStartedAt))
    ),
    ...(item.sourceEvidenceHash
      ? { sourceEvidenceHash: item.sourceEvidenceHash }
      : {}),
  });
  state.status = result.status;
  state.translationId = result.id;
  if (result.status === 'translated') {
    state.translatedSha256 = result.translatedSha256;
    state.reviewAccepted = translationReviewAccepted(result);
    run.cacheHits += Number(result.cacheHit);
    run.providerResults += Number(!result.cacheHit);
  } else {
    delete state.translatedSha256;
    delete state.reviewAccepted;
    state.reason = result.reason;
    run.stopped = result.reason === 'collection-stopped';
  }
}

function compatibleJob(previous, plan, translator) {
  return (
    previous?.fingerprint === plan.fingerprint &&
    previous.providerId === translator.providerId &&
    previous.providerVersion === translator.providerVersion
  );
}

/** Bounded resume. Correct cached results replay even while collection is stopped. */
export async function translateCatalog(application, options = {}) {
  const limit = options.limit ?? 100;
  positive(limit, 'translation limit', { integer: true });
  const plan = await planCatalogTranslation(application, options);
  const id = jobIdentity(application, plan, options);
  const previous = await application.store.get('translation-job', id);
  const compatible = compatibleJob(previous, plan, application.translator);
  const job = createJob(application, plan, id, previous, compatible, options);
  const states = [];
  for (const item of plan.items) {
    states.push(await existingState(application, job, item, compatible));
  }
  const run = {
    processed: 0,
    cacheHits: states.filter((item) => item.status === 'translated').length,
    providerResults: 0,
    stopped: false,
  };
  await application.store.put(
    'translation-job',
    summary(job, states, plan, run)
  );
  const order = plan.items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rank = (state) =>
        state.status === 'unprocessed' ? 0 : state.status === 'pending' ? 1 : 2;
      return (
        rank(states[left.index]) - rank(states[right.index]) ||
        (states[left.index].attempts || 0) -
          (states[right.index].attempts || 0) ||
        left.index - right.index
      );
    });
  for (const { index, item } of order) {
    const state = states[index];
    if (state.status === 'translated' || run.processed >= limit) {
      continue;
    }
    const stop = await application.store.get(
      'collection-stop',
      COLLECTION_STOP_ID
    );
    if (!job.cacheOnly && stop?.active) {
      state.status = 'pending';
      state.reason = 'collection-stopped';
      run.stopped = true;
      break;
    }
    await processItem(application, job, item, state, run);
    if (run.processed % 25 === 0 || run.stopped) {
      await putRecords(
        application.store,
        'translation-catalog-item',
        states.slice(Math.max(0, index - 24), index + 1)
      );
      await application.store.put(
        'translation-job',
        summary(job, states, plan, run)
      );
    }
    if (run.stopped) {
      break;
    }
  }
  for (let offset = 0; offset < plan.items.length; offset += 100) {
    await putRecords(
      application.store,
      'translation-catalog-source',
      plan.items.slice(offset, offset + 100)
    );
    await putRecords(
      application.store,
      'translation-catalog-item',
      states.slice(offset, offset + 100)
    );
  }
  return application.store.put(
    'translation-job',
    summary(job, states, plan, run)
  );
}

async function currentCatalogAcceptance(application, jobs) {
  const plan = await planCatalogTranslation(application);
  const job = jobs
    .filter((candidate) =>
      compatibleJob(candidate, plan, application.translator)
    )
    .sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0];
  let translated = 0,
    reviewed = 0;
  if (job) {
    for (let offset = 0; offset < plan.items.length; offset += 100) {
      const states = await Promise.all(
        plan.items
          .slice(offset, offset + 100)
          .map((item) => existingState(application, job, item, true))
      );
      translated += states.filter(
        (item) => item.status === 'translated'
      ).length;
      reviewed += states.filter((item) => item.reviewAccepted).length;
    }
  }
  const accepted = Boolean(
    job &&
    application.translator.providerId !== 'unconfigured' &&
    plan.products > 0 &&
    plan.items.length > 0 &&
    plan.gaps.length === 0 &&
    translated === plan.items.length &&
    reviewed === plan.items.length
  );
  return {
    fingerprint: plan.fingerprint,
    jobId: job?.id || null,
    products: plan.products,
    total: plan.items.length,
    translated,
    reviewed,
    sourceGaps: plan.gaps,
    completeCachedCatalogEnglishAccepted: accepted,
    acceptanceScope: 'current-cached-catalog-and-originals',
  };
}

export async function translationStatus(
  application,
  { jobId, verifyCurrentCatalog = false } = {}
) {
  if (jobId) {
    return (
      (await application.store.get('translation-job', jobId)) || {
        id: jobId,
        status: 'not-found',
        complete: false,
      }
    );
  }
  const jobs = await application.store.list('translation-job');
  return {
    jobs: jobs.sort((left, right) => left.id.localeCompare(right.id)),
    ...(verifyCurrentCatalog
      ? await currentCatalogAcceptance(application, jobs)
      : { completeCachedCatalogEnglishAccepted: false }),
    completeCatalogEnglishAccepted: false,
    prerequisite:
      'Configure an exact provider identity/version and translate/review all current cached text and missing product sources.',
  };
}
