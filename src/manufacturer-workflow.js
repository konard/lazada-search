import { ManufacturerResearch } from './manufacturer-research.js';
import {
  manufacturerRequest,
  manufacturerSourceId,
} from './manufacturer-source-cache.js';
import {
  COLLECTION_STOP_ID,
  assertCollectionRunning,
} from './page-challenge.js';
import { sha256 } from './util.js';
import { sourceChallenge } from './source-challenge.js';
import {
  buildLabelWorklist,
  workflowProductFingerprint,
  workflowSourceInvalidated,
} from './label-worklist.js';
import { resolveProductReviews } from './catalog-products.js';
import { productFlavour } from './flavour-scope.js';
import {
  readWorkflowOriginal,
  workflowSourceText,
  boundWorkflowOcrText,
  extractStructuredWorkflowCandidates,
  prepareWorkflowFacts,
  workflowReviewDraft,
} from './manufacturer-workflow-facts.js';

const inFlight = new WeakMap();
const TERMINAL = new Set(['completed', 'needs-review', 'superseded']);

function limit(value, name, defaultValue, maximum) {
  value ??= defaultValue;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function now(context) {
  return new Date(context.now()).toISOString();
}

function taskId(kind, key) {
  return `manufacturer-task:${sha256(JSON.stringify([kind, key]))}`;
}

function addTask(plan, kind, key, input, itemIds, dependencies = []) {
  const id = taskId(kind, key);
  const previous = plan.tasks.find((task) => task.id === id);
  if (previous) {
    const added = itemIds.some((id) => !previous.itemIds.includes(id));
    previous.itemIds = [...new Set([...previous.itemIds, ...itemIds])];
    if (
      added &&
      [
        'capture-source',
        'reuse-source',
        'ocr-source',
        'extract-source',
      ].includes(kind) &&
      TERMINAL.has(previous.status)
    ) {
      // Reuse the same original while propagating a newly linked product's
      // exact review work; do not let an earlier completed shared source omit it.
      previous.status = 'queued';
      previous.attempts = 0;
    }
    return previous;
  }
  if (plan.tasks.length >= plan.bounds.maxTotalTasks) {
    plan.blockers.push({ code: 'task-budget-reached', kind, itemIds });
    return null;
  }
  const task = {
    id,
    kind,
    input,
    itemIds,
    dependencies,
    status: 'queued',
    attempts: 0,
  };
  plan.tasks.push(task);
  return task;
}

function officialRequest(application, candidate, request) {
  const registry = application.manufacturerRegistry;
  const entry = registry.find((item) => item.name === candidate.name);
  const normalized = manufacturerRequest({ ...request, brand: candidate.name });
  const host = new URL(normalized.url).hostname
    .toLowerCase()
    .replace(/^www\./u, '');
  const hosts =
    request.kind === 'label'
      ? [...(entry?.domains || []), ...(entry?.assetDomains || [])]
      : entry?.domains || [];
  if (!entry || !hosts.includes(host) || candidate.brandConflict) {
    throw new Error(
      'Discovered source is outside this product’s configured official registry'
    );
  }
  return { ...request, url: normalized.url, brand: candidate.name };
}

function attachCapture(
  plan,
  application,
  candidate,
  request,
  itemIds,
  dependencies = []
) {
  const trusted = officialRequest(application, candidate, request);
  const id = manufacturerSourceId(trusted);
  return addTask(
    plan,
    'capture-source',
    id,
    { request: trusted, sourceId: id },
    itemIds,
    dependencies
  );
}

export async function planManufacturerWorkflow(application, options = {}) {
  if (options.registry !== undefined) {
    throw new Error(
      'Manufacturer workflow cannot override the configured registry'
    );
  }
  const worklist = await buildLabelWorklist(application, options);
  const id =
    options.id ||
    `manufacturer-workflow:${sha256(JSON.stringify(worklist.items.map((item) => item.id)))}`;
  const existing = await application.store.get('manufacturer-workflow', id);
  const invalidationFingerprint = sha256(
    JSON.stringify(await application.store.list('invalidation'))
  );
  if (
    existing &&
    options.retryFailed !== true &&
    existing.invalidationFingerprint === invalidationFingerprint &&
    existing.worklistFingerprint === sha256(JSON.stringify(worklist.items))
  ) {
    return existing;
  }
  const plan = {
    id,
    schemaVersion: 1,
    status: 'draft-unvalidated',
    worklistId: worklist.id,
    worklistFingerprint: sha256(JSON.stringify(worklist.items)),
    invalidationFingerprint,
    items: worklist.items,
    tasks: [],
    blockers: [],
    bounds: {
      maxSourcesPerProduct: limit(
        options.maxSourcesPerProduct,
        'maxSourcesPerProduct',
        8,
        50
      ),
      maxLabelsPerPage: limit(
        options.maxLabelsPerPage,
        'maxLabelsPerPage',
        12,
        100
      ),
      maxTotalTasks: limit(
        options.maxTotalTasks,
        'maxTotalTasks',
        10000,
        50000
      ),
      maxAttempts: limit(options.maxAttempts, 'maxAttempts', 3, 10),
    },
    createdAt: new Date().toISOString(),
    marketCompletenessGuaranteed: false,
    automaticApprovalAllowed: false,
    omittedProducts: worklist.omittedProducts,
    missingRequestedProducts: worklist.missingRequestedProducts,
    singleWorkerRequired: true,
  };
  for (const item of worklist.items.filter(
    (entry) => entry.status !== 'already-reviewed'
  )) {
    addTask(plan, 'discover-sources', item.id, { itemId: item.id }, [item.id]);
    for (const original of item.originals
      .filter((entry) => !entry.invalidated)
      .slice(0, plan.bounds.maxLabelsPerPage)) {
      addTask(
        plan,
        'extract-cached-evidence',
        [original.evidenceId, original.sha256],
        {
          sourceId: original.evidenceId,
          sourceRecordKind: 'evidence',
          sourceSha256: original.sha256,
          originalKind: original.kind,
        },
        [item.id]
      );
    }
  }
  await application.store.put('label-worklist', worklist);
  return application.store.put('manufacturer-workflow', plan);
}

function research(application, options) {
  return new ManufacturerResearch({
    store: application.store,
    registry: application.manufacturerRegistry.map((entry) => ({
      brand: entry.name,
      domains: entry.domains,
      assetDomains: entry.assetDomains || [],
    })),
    cache: application.cache,
    scheduler: application.cache.scheduler,
    offline: !options.allowNetwork || application.cache.offline,
    ocr: false,
  });
}

async function contextFor(application, plan, options) {
  const context = {
    application,
    plan,
    options,
    now: options.now || Date.now,
    research: research(application, options),
    invalidations: await application.store.list('invalidation'),
    caches: await application.store.list('cache'),
    sources: await application.store.list('manufacturer-source'),
    candidates: await application.store.list('manufacturer-fact-candidate'),
  };
  // Cached reads share all actual cache hooks and scheduling, but this workflow
  // has its own explicit network mode so an online application cannot silently
  // download a cache miss during an offline review.
  context.research.sources.cache = Object.create(application.cache);
  context.research.sources.cache.offline =
    !options.allowNetwork || application.cache.offline;
  context.research.sources.cache.pending = new Map();
  context.research.sources.cache.stats = {
    hits: 0,
    misses: 0,
    downloads: 0,
    revalidated: 0,
  };
  context.research.sources.requestCache = Object.create(
    context.research.sources.cache
  );
  context.research.sources.requestCache.scheduler = {
    run: (_url, action) => action(),
  };
  return context;
}

function itemFor(context, id) {
  const item = context.plan.items.find((entry) => entry.id === id);
  if (!item) {
    throw new Error('Workflow task references an unknown product work item');
  }
  return item;
}

function queriesFor(item, candidate, registry) {
  const entry = registry.find((record) => record.name === candidate.name);
  const exact = [
    candidate.name,
    item.identity.name || item.title,
    item.identity.flavour,
    item.identity.gtin,
    item.identity.variantCode,
    item.identity.netMassG ? `${item.identity.netMassG}g` : null,
    item.identity.netVolumeMl ? `${item.identity.netVolumeMl}ml` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (entry?.domains || []).map(
    (domain) =>
      `site:${domain} ${exact.slice(0, 360)} nutrition ingredients label`
  );
}

async function discoverWithProvider(context, candidate, request) {
  const { application, options } = context;
  const origin = options.searchProvider.origin;
  if (!origin || new URL(origin).protocol !== 'https:') {
    throw new Error(
      'Search provider must expose its HTTPS origin for paced requests'
    );
  }
  const identity = sha256(
    JSON.stringify({
      origin,
      providerId: options.searchProvider.id || 'injected-search-provider',
      providerVersion: options.searchProvider.version || '1',
      providerConfigurationSha256:
        options.searchProvider.configurationSha256 || null,
      queries: request.queries,
      domains: request.domains,
      maxResults: request.maxResults,
    })
  );
  const cache = context.research.sources.cache;
  const record = await cache.get(origin, {
    namespace: `manufacturer-search-${identity}`,
    ttlMs: Number.MAX_SAFE_INTEGER,
    load: async () => {
      await assertCollectionRunning(application.store);
      const results = await options.searchProvider.search(request);
      if (!Array.isArray(results) || results.length > 500) {
        throw new Error(
          'Search provider must return at most 500 source candidates'
        );
      }
      const approved = [];
      for (const result of results) {
        try {
          approved.push(
            officialRequest(application, candidate, {
              url: result.url,
              kind: 'page',
            })
          );
        } catch {
          context.plan.blockers.push({
            code: 'untrusted-search-source-withheld',
            itemId: request.productId,
            urlSha256: sha256(String(result?.url || '')),
          });
        }
      }
      return {
        status: 'captured',
        contentType: 'application/json',
        blob: await application.store.putBlob(
          Buffer.from(JSON.stringify(approved))
        ),
        observedAt: now(context),
        providerOrigin: origin,
        querySha256: identity,
      };
    },
  });
  const bytes = await readWorkflowOriginal(application.store, record);
  return JSON.parse(bytes.toString('utf8'));
}

async function discoverSources(context, task) {
  const { application, options, plan } = context;
  const item = itemFor(context, task.input.itemId);
  let attached = 0;
  const requests = new Map();
  for (const candidate of item.candidates) {
    if (candidate.brandConflict) {
      continue;
    }
    requests.set(candidate.url, {
      candidate,
      request: { url: candidate.url, kind: 'page' },
    });
    for (const source of context.sources.filter(
      (entry) => entry.brand === candidate.name
    )) {
      if (
        source.status === 'captured' &&
        !workflowSourceInvalidated(
          source,
          context.caches,
          context.invalidations
        )
      ) {
        if (attached < plan.bounds.maxSourcesPerProduct) {
          addTask(
            plan,
            'reuse-source',
            [source.id, source.blob?.sha256],
            {
              sourceId: source.id,
              sourceSha256: source.blob?.sha256,
            },
            [item.id],
            [task.id]
          );
          attached += 1;
        }
      } else if (
        source.requestMethod === 'GET' &&
        source.finalUrl &&
        source.kind === 'page'
      ) {
        requests.set(source.url || source.finalUrl, {
          candidate,
          request: { url: source.url || source.finalUrl, kind: 'page' },
        });
      }
    }
    if (options.searchProvider) {
      const request = {
        productId: item.productId,
        identity: item.identity,
        queries: queriesFor(item, candidate, application.manufacturerRegistry),
        domains: application.manufacturerRegistry.find(
          (entry) => entry.name === candidate.name
        ).domains,
        maxResults: plan.bounds.maxSourcesPerProduct,
        signal: options.signal,
      };
      try {
        const found = await discoverWithProvider(context, candidate, request);
        for (const result of found) {
          const trusted = officialRequest(application, candidate, result);
          requests.set(trusted.url, { candidate, request: trusted });
        }
      } catch (error) {
        if (error.code === 'COLLECTION_STOPPED') {
          throw error;
        }
        plan.blockers.push({
          code: 'search-provider-source-discovery-unavailable',
          itemId: item.id,
          reason: error.message,
        });
      }
    }
  }
  for (const { candidate, request } of requests.values()) {
    if (attached >= plan.bounds.maxSourcesPerProduct) {
      plan.blockers.push({
        code: 'source-budget-reached',
        itemId: item.id,
        sourceRequestsDeferred: requests.size,
      });
      break;
    }
    attachCapture(plan, application, candidate, request, [item.id], [task.id]);
    attached += 1;
  }
  return {
    status: attached ? 'completed' : 'blocked',
    blockers: attached
      ? []
      : ['registered-exact-manufacturer-source-not-found'],
    sourceCandidates: attached,
    onlineSearchPerformed: Boolean(
      options.searchProvider &&
      options.allowNetwork &&
      !application.cache.offline
    ),
  };
}

function retrySource(context, source) {
  if (!source) {
    return false;
  }
  if (
    workflowSourceInvalidated(source, context.caches, context.invalidations)
  ) {
    return true;
  }
  return (
    source.status === 'failed' &&
    source.retryAfter !== null &&
    context.now() >= Number(source.retryAfter)
  );
}

async function captureSource(context, task) {
  const { application } = context;
  const cached = await application.store.get(
    'manufacturer-source',
    task.input.sourceId
  );
  const refresh = retrySource(context, cached);
  if (refresh && !context.options.allowNetwork) {
    return {
      status: 'blocked',
      blockers: ['invalidated-original-requires-online-recollection'],
    };
  }
  const report = await context.research.run({
    id: `workflow-research:${task.id}`,
    sources: [{ ...task.input.request, ...(refresh ? { refresh: true } : {}) }],
  });
  const source = report.sources[0];
  if (!source || source.status !== 'captured') {
    return {
      status: 'blocked',
      blockers: [report.failures[0]?.error || 'source-unavailable'],
      retryAfter: source?.retryAfter ?? null,
      sourceId: source?.id || task.input.sourceId,
    };
  }
  return attachSourceTasks(context, task, source);
}

async function attachSourceTasks(context, task, source) {
  const { plan, application } = context;
  const bytes = await readWorkflowOriginal(application.store, source);
  const challenge = sourceChallenge(bytes, source.contentType, source.finalUrl);
  if (challenge) {
    throw new Error('Challenged source must be resolved before extraction');
  }
  addTask(
    plan,
    source.kind === 'label' ? 'ocr-source' : 'extract-source',
    [source.id, source.blob.sha256],
    { sourceId: source.id, sourceSha256: source.blob.sha256 },
    task.itemIds,
    [task.id]
  );
  if (source.kind === 'page') {
    const labels = await context.research.sources.images(source.id);
    let count = 0;
    for (const label of labels) {
      if (count >= plan.bounds.maxLabelsPerPage) {
        plan.blockers.push({
          code: 'label-budget-reached',
          sourceId: source.id,
          remaining: labels.length - count,
        });
        break;
      }
      const eligible = task.itemIds.filter((id) => {
        const item = itemFor(context, id);
        const declared = productFlavour({
          category: item.category,
          title: `${label.alt} ${label.title}`,
        });
        return declared === 'unknown' || declared === item.identity.flavour;
      });
      if (!eligible.length) {
        plan.blockers.push({
          code: 'other-flavour-label-withheld',
          sourceId: source.id,
          url: label.url,
        });
        continue;
      }
      try {
        attachCapture(
          plan,
          application,
          { name: source.brand },
          {
            url: label.url,
            kind: 'label',
            parentSourceId: source.id,
          },
          eligible,
          [task.id]
        );
        count += 1;
      } catch {
        plan.blockers.push({
          code: 'unregistered-official-asset-host',
          sourceId: source.id,
          url: label.url,
        });
      }
    }
  }
  return {
    status: 'completed',
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
    cacheHit: source.cacheHit,
  };
}

async function reuseSource(context, task) {
  const { source } = await originalForTask(context, task);
  if (source.authority !== 'manufacturer' || source.status !== 'captured') {
    throw new Error(
      'Reusable source must be captured official manufacturer evidence'
    );
  }
  return attachSourceTasks(context, task, { ...source, cacheHit: true });
}

export async function workflowOriginalForTask(context, task) {
  if (task.input.sourceRecordKind === 'evidence') {
    return cachedEvidenceForTask(context, task);
  }
  const source = await context.application.store.get(
    'manufacturer-source',
    task.input.sourceId
  );
  if (
    !source ||
    source.status !== 'captured' ||
    source.authority !== 'manufacturer' ||
    source.challenge?.detected ||
    source.blob?.sha256 !== task.input.sourceSha256 ||
    workflowSourceInvalidated(source, context.caches, context.invalidations)
  ) {
    throw new Error(
      'Task original changed or was invalidated; replan and recollect that source'
    );
  }
  officialRequest(
    context.application,
    { name: source.brand },
    {
      url: source.finalUrl,
      kind: source.kind,
    }
  );
  if (source.kind === 'label') {
    const parent = await context.application.store.get(
      'manufacturer-source',
      source.parentSourceId
    );
    if (
      !parent ||
      parent.blob?.sha256 !== source.parentSourceSha256 ||
      workflowSourceInvalidated(parent, context.caches, context.invalidations)
    ) {
      throw new Error(
        'Original official label publication changed or was invalidated'
      );
    }
    await context.research.sources.publication(
      source.parentSourceId,
      source.url || source.finalUrl,
      source.brand
    );
  }
  const bytes = await readWorkflowOriginal(context.application.store, source);
  return { source, bytes };
}

const originalForTask = workflowOriginalForTask;

async function cachedEvidenceForTask(context, task) {
  const evidence = await context.application.store.get(
    'evidence',
    task.input.sourceId
  );
  const reference = ['html', 'image', 'blob', 'screenshot']
    .map((field) => evidence?.[field])
    .find((blob) => blob?.sha256 === task.input.sourceSha256);
  if (
    !evidence ||
    !reference ||
    workflowSourceInvalidated(evidence, context.caches, context.invalidations)
  ) {
    throw new Error('Captured product original changed or was invalidated');
  }
  const source = {
    ...evidence,
    evidenceId: evidence.id,
    sourceRecordKind: 'evidence',
    blob: reference,
    finalUrl: evidence.url,
    kind: evidence.html?.sha256 === reference.sha256 ? 'page' : 'label',
    contentType:
      evidence.html?.sha256 === reference.sha256
        ? 'text/html'
        : 'image/original',
    authority: 'marketplace-seller',
  };
  for (const id of task.itemIds || []) {
    if (
      !itemFor(context, id).originals.some(
        (original) =>
          original.evidenceId === evidence.id &&
          original.sha256 === reference.sha256
      )
    ) {
      throw new Error(
        'Cached original is not attached to this exact selected product'
      );
    }
  }
  return {
    source,
    bytes: await readWorkflowOriginal(context.application.store, source),
  };
}

async function extractCachedEvidence(context, task) {
  const { source } = await originalForTask(context, task);
  if (source.kind === 'page') {
    return extractSource(context, task);
  }
  if (!context.application.ocr) {
    return {
      status: 'blocked',
      blockers: ['configured-local-ocr-engine-required'],
    };
  }
  const passes = context.options.ocrPasses || [{ psm: 6 }, { psm: 11 }];
  if (!Array.isArray(passes) || !passes.length || passes.length > 8) {
    throw new Error('Workflow supports one to eight local OCR passes');
  }
  const results = [];
  for (const pass of passes) {
    const ocr = await context.application.ocr.recognize(source.blob, pass);
    await boundWorkflowOcrText(context.application.store, source, ocr);
    addTask(
      context.plan,
      'extract-source',
      [source.id, source.blob.sha256, ocr.id],
      {
        ...task.input,
        ocrId: ocr.id,
      },
      task.itemIds,
      [task.id]
    );
    results.push(ocr.id);
  }
  return {
    status: 'completed',
    originalReused: true,
    ocrIds: results,
    downloads: 0,
  };
}

async function ocrSource(context, task) {
  if (!context.application.ocr) {
    return {
      status: 'blocked',
      blockers: ['configured-local-ocr-engine-required'],
    };
  }
  const { source } = await originalForTask(context, task);
  const passes = context.options.ocrPasses || [{ psm: 6 }, { psm: 11 }];
  if (!Array.isArray(passes) || !passes.length || passes.length > 8) {
    throw new Error('Workflow supports one to eight local OCR passes');
  }
  const results = [];
  for (const pass of passes) {
    const ocr = await context.application.ocr.recognize(source.blob, pass);
    await boundWorkflowOcrText(context.application.store, source, ocr);
    addTask(
      context.plan,
      'extract-source',
      [source.id, source.blob.sha256, ocr.id],
      {
        sourceId: source.id,
        sourceSha256: source.blob.sha256,
        ocrId: ocr.id,
      },
      task.itemIds,
      [task.id]
    );
    results.push({
      ocrId: ocr.id,
      sourceSha256: source.blob.sha256,
      rawTsvSha256: ocr.rawTsv.sha256,
      confidence: ocr.confidence,
    });
  }
  return { status: 'completed', ocr: results };
}

async function extractSource(context, task) {
  const { source, bytes } = await originalForTask(context, task);
  const store = context.application.store;
  const ocr = task.input.ocrId
    ? await store.get('ocr', task.input.ocrId)
    : null;
  const text = ocr
    ? await boundWorkflowOcrText(store, source, ocr)
    : workflowSourceText(source, bytes);
  const extractor =
    context.options.factExtractor || extractStructuredWorkflowCandidates;
  let saved = 0;
  for (const id of task.itemIds) {
    const item = itemFor(context, id);
    const extracted = await extractor({
      text,
      source,
      ocr,
      identity: item.identity,
      productId: item.productId,
    });
    const proposed = prepareWorkflowFacts(item, source, extracted, text, ocr);
    for (const fact of proposed.candidates) {
      await store.put('manufacturer-fact-candidate', fact);
      context.candidates = [
        ...context.candidates.filter((entry) => entry.id !== fact.id),
        fact,
      ];
      saved += 1;
    }
    for (const kind of ['quantity', 'nutrition']) {
      const review = addTask(
        context.plan,
        `${kind}-review`,
        [item.id, source.id, source.blob.sha256, task.input.ocrId || null],
        {
          itemId: item.id,
          candidateIds: proposed.candidates.map((candidate) => candidate.id),
        },
        [id],
        [task.id]
      );
      if (review) {
        review.extractionRejections = proposed.rejected;
      }
    }
  }
  return { status: 'completed', proposedFacts: saved, automaticApprovals: 0 };
}

async function prepareReview(context, task) {
  const kind = task.kind === 'quantity-review' ? 'quantity' : 'nutrition';
  const item = itemFor(context, task.input.itemId);
  const candidates = [];
  for (const candidate of context.candidates.filter((entry) =>
    task.input.candidateIds.includes(entry.id)
  )) {
    await originalForTask(context, {
      input: {
        sourceId: candidate.sourceId,
        sourceSha256: candidate.sourceSha256,
        sourceRecordKind: candidate.sourceRecordKind,
      },
      itemIds: task.itemIds,
    });
    candidates.push(candidate);
  }
  const draft = workflowReviewDraft(item, candidates, kind);
  const id = `manufacturer-review-draft:${task.id}`;
  await context.application.store.put('manufacturer-review-draft', {
    id,
    ...draft,
    preparedAt: now(context),
  });
  return {
    status: 'needs-review',
    reviewDraftId: id,
    blockers: draft.blockingReasons,
  };
}

function dispatch(context, task) {
  const handlers = {
    'discover-sources': discoverSources,
    'capture-source': captureSource,
    'reuse-source': reuseSource,
    'ocr-source': ocrSource,
    'extract-source': extractSource,
    'extract-cached-evidence': extractCachedEvidence,
    'quantity-review': prepareReview,
    'nutrition-review': prepareReview,
  };
  const handler = handlers[task.kind];
  if (!handler) {
    throw new Error(`Unknown manufacturer workflow task: ${task.kind}`);
  }
  return handler(context, task);
}

async function productChanged(context, task) {
  for (const id of task.itemIds) {
    const item = itemFor(context, id);
    const product = await resolveProductReviews(
      context.application.store,
      await context.application.store.get('product', item.productId)
    );
    if (
      !product ||
      workflowProductFingerprint(product) !== item.productFingerprint
    ) {
      return true;
    }
  }
  return false;
}

function runnable(plan, task, options, timestamp) {
  if (task.status === 'blocked' && options.retryBlocked !== true) {
    return false;
  }
  const state = task.status === 'queued' || task.status === 'blocked';
  const retry = task.retryAfter ? timestamp >= Number(task.retryAfter) : true;
  return (
    state &&
    retry &&
    task.attempts < plan.bounds.maxAttempts &&
    task.dependencies.every(
      (id) =>
        plan.tasks.find((entry) => entry.id === id)?.status === 'completed'
    )
  );
}

async function executeWorkflow(application, workflowId, options) {
  const plan = await application.store.get('manufacturer-workflow', workflowId);
  if (!plan) {
    throw new Error('Manufacturer workflow not found; create a plan first');
  }
  const context = await contextFor(application, plan, options);
  const stop = await application.store.get(
    'collection-stop',
    COLLECTION_STOP_ID
  );
  if (options.allowNetwork && stop?.active) {
    plan.status = 'stopped-security-challenge';
    plan.collectionStop = stop;
    return application.store.put('manufacturer-workflow', plan);
  }
  plan.status = 'running-draft-workflow';
  plan.collectionStop = stop?.active ? stop : null;
  if (options.recoverInterrupted === true) {
    for (const task of plan.tasks.filter(
      (entry) => entry.status === 'running'
    )) {
      task.status = 'blocked';
      task.blockers = [
        'previous-single-worker-interrupted-explicit-retry-required',
      ];
    }
  }
  const count = limit(options.maxTasks, 'maxTasks', 25, 5000);
  let executed = 0;
  for (const task of plan.tasks) {
    if (executed >= count || options.signal?.aborted) {
      break;
    }
    if (!runnable(plan, task, options, context.now())) {
      continue;
    }
    if (await productChanged(context, task)) {
      task.status = 'superseded';
      task.blockers = ['captured-selected-sku-changed-replan-required'];
      continue;
    }
    task.status = 'running';
    task.attempts += 1;
    task.startedAt = now(context);
    await application.store.put('manufacturer-workflow', plan);
    try {
      Object.assign(task, await dispatch(context, task));
    } catch (error) {
      task.status = 'blocked';
      task.blockers = [error.message];
      if (error.code === 'COLLECTION_STOPPED') {
        plan.status = 'stopped-security-challenge';
        plan.collectionStop = await application.store.get(
          'collection-stop',
          COLLECTION_STOP_ID
        );
      }
    }
    task.finishedAt = now(context);
    executed += 1;
    await application.store.put('manufacturer-workflow', plan);
    if (plan.status === 'stopped-security-challenge') {
      break;
    }
  }
  if (plan.status !== 'stopped-security-challenge') {
    plan.status = plan.tasks.every((task) => TERMINAL.has(task.status))
      ? 'drafts-prepared-reviews-required'
      : 'partial-resumable-workflow';
  }
  plan.lastRun = {
    executedTasks: executed,
    finishedAt: now(context),
    networkAllowed: options.allowNetwork === true,
    cache: { ...context.research.sources.cache.stats },
    automaticApprovals: 0,
  };
  return application.store.put('manufacturer-workflow', plan);
}

export async function runManufacturerWorkflow(
  application,
  workflowId,
  options = {}
) {
  let active = inFlight.get(application.store);
  if (!active) {
    active = new Set();
    inFlight.set(application.store, active);
  }
  if (active.has(workflowId)) {
    throw new Error('This manufacturer workflow already has an active worker');
  }
  active.add(workflowId);
  try {
    return await executeWorkflow(application, workflowId, {
      ...options,
      allowNetwork: options.allowNetwork === true,
    });
  } finally {
    active.delete(workflowId);
  }
}

export async function manufacturerWorkflowStatus(application, workflowId) {
  const workflows = workflowId
    ? [await application.store.get('manufacturer-workflow', workflowId)].filter(
        Boolean
      )
    : await application.store.list('manufacturer-workflow');
  return {
    workflows,
    collectionStop:
      (await application.store.get('collection-stop', COLLECTION_STOP_ID)) ||
      null,
    taskCounts: workflows
      .flatMap((workflow) => workflow.tasks)
      .reduce((counts, task) => {
        counts[task.status] = (counts[task.status] || 0) + 1;
        return counts;
      }, {}),
    draftCodeValidated: false,
    marketCompletenessGuaranteed: false,
  };
}
