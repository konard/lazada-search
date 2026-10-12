import { MARKETS } from './application.js';
import { canonicalUrl, sha256 } from './util.js';
import { positive } from './values.js';
import {
  COLLECTION_STOP_ID,
  assertCollectionRunning,
} from './page-challenge.js';
import {
  CASE_WORKFLOW_VERSION,
  CASE_TASK_ORDER,
  refreshCaseWorklist,
} from './case-worklist.js';
import { acquireCaseLease } from './case-workflow-lock.js';
import {
  planManufacturerWorkflow,
  runManufacturerWorkflow,
} from './manufacturer-workflow.js';
import { capturePreparedLazadaCheckout } from './lazada-checkout-capture.js';
import { buildShoppingReport, saveShoppingReport } from './shopping-report.js';
import { createManufacturerSearchProvider } from './manufacturer-workflow-search.js';
import {
  registerHandpickedLinks,
  resolveHandpickedLinks,
} from './handpicked-links.js';
import { caseCoverageStatus } from './case-coverage.js';

function caseDefinition(application, input) {
  if (application.market !== 'vn' || application.currency !== 'VND') {
    throw new Error('This shopping case requires Vietnam and VND');
  }
  for (const field of ['minPrice', 'maxPrice', 'priceMin', 'priceMax']) {
    if (input[field] !== undefined) {
      throw new Error('Case collection cannot apply package-price cutoffs');
    }
  }
  for (const field of ['queries', 'categoryUrls', 'quantities']) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      throw new Error(`${field} requires an array`);
    }
  }
  const queries = [...new Set(input.queries || MARKETS.vn.queries)];
  const categoryUrls = [
    ...new Set(input.categoryUrls || MARKETS.vn.categoryUrls),
  ].map(canonicalUrl);
  if (!queries.length && !categoryUrls.length) {
    throw new Error('At least one inventory source is required');
  }
  if (queries.length + categoryUrls.length > 100) {
    throw new Error('Too many inventory sources');
  }
  queries.forEach((query) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) {
      throw new Error('Invalid search query');
    }
  });
  categoryUrls.forEach((url) => application.assertMarket(url));
  const quantities = [...new Set(input.quantities || [1])];
  quantities.forEach((quantity) =>
    positive(quantity, 'quantity', { integer: true })
  );
  if (
    !quantities.length ||
    quantities.length > 100 ||
    quantities.some((quantity) => quantity > 10000)
  ) {
    throw new Error('Bounded explicit order quantities are required');
  }
  const maxAttempts = positive(input.maxAttempts ?? 3, 'maxAttempts', {
    integer: true,
  });
  const maxPlannedTasks = positive(
    input.maxPlannedTasks ?? 100000,
    'maxPlannedTasks',
    { integer: true }
  );
  if (maxAttempts > 10 || maxPlannedTasks > 1000000) {
    throw new Error('Case retry/task bounds exceeded');
  }
  if (
    input.handpicked !== undefined &&
    (!Array.isArray(input.handpicked) || input.handpicked.length > 1000)
  ) {
    throw new Error('Handpicked links require a bounded array');
  }
  return {
    version: CASE_WORKFLOW_VERSION,
    market: 'vn',
    currency: 'VND',
    deliveryArea: input.deliveryArea || application.deliveryArea,
    flavourScope: 'chocolate-or-unflavoured',
    queries,
    categoryUrls,
    searchSort: 'priceasc',
    quantities,
    maxAttempts,
    maxPlannedTasks,
    recollectAfterInitialPass: input.recollectAfterInitialPass !== false,
    maxPriceAgeMs: positive(input.maxPriceAgeMs ?? 86400000, 'maxPriceAgeMs'),
    handpicked: input.handpicked || [],
  };
}

async function workflow(application, id) {
  const record = await application.store.get('case-workflow', id);
  if (
    !record ||
    record.id !== `case-workflow:${sha256(JSON.stringify(record.definition))}`
  ) {
    throw new Error('Unknown case workflow or changed immutable definition');
  }
  return record;
}

export async function planCaseWorkflow(application, input = {}) {
  const definition = caseDefinition(application, input);
  const id = `case-workflow:${sha256(JSON.stringify(definition))}`;
  const existing = await application.store.get('case-workflow', id);
  const record =
    existing ||
    (await application.store.put('case-workflow', {
      id,
      definition,
      createdAt: new Date().toISOString(),
      codeValidation: 'draft-untested',
      complete: false,
      allMarketProductsCollected: false,
    }));
  await registerHandpickedLinks(application, { links: definition.handpicked });
  await refreshCaseWorklist(application, record);
  return caseWorkflowStatus(application, id);
}

export async function caseWorkflowStatus(application, workflowId) {
  const record = await workflow(application, workflowId);
  const tasks = (await application.store.list('case-task')).filter(
    (task) => task.workflowId === workflowId
  );
  const counts = {};
  for (const task of tasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  return {
    workflow: record,
    tasks,
    counts,
    collectionStop: await application.store.get(
      'collection-stop',
      COLLECTION_STOP_ID
    ),
    allRequirementsDelivered: false,
    allTargetProductsCollected: false,
    productionReady: false,
    purchaseReady: false,
    codeValidation: 'draft-untested',
  };
}

function initialPassPending(tasks) {
  return tasks.some(
    (task) =>
      ['discovery', 'handpicked', 'listing', 'sku', 'inventory'].includes(
        task.stage
      ) && !['succeeded', 'unavailable', 'superseded'].includes(task.status)
  );
}

async function collectTask(application, task) {
  const result = await application.collect(task.input.url, {
    flavourScope: 'chocolate-or-unflavoured',
    refresh: task.stage === 'recollection',
  });
  if (
    task.input.sku &&
    (/^\d+_VNAMZ-\d+$/u.test(String(task.input.sku))
      ? result.offer?.sku !== task.input.sku
      : String(result.offer?.sku).split('_VNAMZ-').at(-1) !==
        String(task.input.sku))
  ) {
    throw new Error('Collected selection differs from requested exact SKU');
  }
  let needsReview = false;
  if (task.stage === 'sku') {
    needsReview =
      !result.offer?.variantConfirmed ||
      !(result.offer.price > 0) ||
      result.offer.priceInvalidated === true;
  }
  if (task.stage === 'inventory') {
    const inventory = await application.store.get(
      'sku-inventory',
      canonicalUrl(task.input.url)
    );
    needsReview = inventory?.inventoryObserved !== true;
  }
  return {
    productId: result.product?.id,
    offerId: result.offer?.id,
    evidenceId: result.offer?.evidenceId,
    needsReview,
    cache: { ...application.cache.stats },
  };
}

async function deliveryTask(application, task, record) {
  const result = await application.delivery(task.input.url, {
    province: 'Khánh Hòa',
    locality: 'Phường Nha Trang',
  });
  const offer = await application.store.get('offer', task.input.offerId);
  const product = await application.store.get('product', task.input.productId);
  const exact =
    offer?.sku === task.input.sku &&
    offer.shippingQuantity === task.input.quantity &&
    offer.deliveryArea === record.definition.deliveryArea &&
    Number.isFinite(offer.shipping) &&
    !offer.shippingInvalidated &&
    offer.deliveryAvailable !== false &&
    (product?.category !== 'chocolate-ice-cream' ||
      offer.coldChainConfirmed === true);
  return { result, needsReview: !exact };
}

function matchesCheckoutTask(row, task, deliveryArea) {
  return (
    row.quote.deliveryArea === deliveryArea &&
    row.quote.market === 'vn' &&
    row.quote.currency === 'VND' &&
    row.metrics !== null &&
    row.quote.lines.some(
      (line) =>
        line.sku === task.input.sku && line.quantity === task.input.quantity
    )
  );
}

async function checkoutTask(application, task, record, options) {
  const context = {
    deliveryArea: record.definition.deliveryArea,
    flavourScope: 'chocolate-or-unflavoured',
  };
  const cached = (await application.compareBaskets(context)).observations
    .filter(
      (row) =>
        matchesCheckoutTask(row, task, context.deliveryArea) &&
        Date.now() - Date.parse(row.quote.observedAt) <=
          record.definition.maxPriceAgeMs
    )
    .sort(
      (a, b) => Date.parse(b.quote.observedAt) - Date.parse(a.quote.observedAt)
    )[0];
  if (cached) {
    return {
      quoteId: cached.quote.id,
      reused: true,
      needsReview: !cached.eligible,
    };
  }
  const input = options.preparedCheckouts?.[task.id];
  if (options.allowNetwork !== true || !input) {
    throw new Error(
      'No current cached exact checkout; allowNetwork:true and a reviewed prepared private checkout are required'
    );
  }
  const result = await capturePreparedLazadaCheckout(application, {
    ...input,
    deliveryArea: context.deliveryArea,
  });
  const quote = result.quoteId
    ? await application.store.get('basket-quote', result.quoteId)
    : null;
  if (
    !quote?.lines?.some(
      (line) =>
        line.sku === task.input.sku && line.quantity === task.input.quantity
    )
  ) {
    throw new Error(
      'Captured checkout does not establish this exact SKU/order quantity'
    );
  }
  const row = (await application.compareBaskets(context)).observations.find(
    (entry) => entry.quote.id === quote.id
  );
  return { ...result, needsReview: !row?.eligible };
}

function handlers(application, record, options) {
  return {
    handpicked: (task) =>
      resolveHandpickedLinks(application, {
        linkIds: [task.input.linkId],
        limit: 1,
        allowNetwork: options.allowNetwork === true,
      }),
    discovery: async () => {
      const result = await application.crawl({
        queries: record.definition.queries,
        categoryUrls: record.definition.categoryUrls,
        searchSort: 'priceasc',
        exhaustive: true,
        discoveryOnly: true,
        maxProducts: 1,
      });
      if (!result.discoveryComplete) {
        throw new Error('Configured lists are not terminal-confirmed');
      }
      return { crawlId: result.id };
    },
    listing: (task) => collectTask(application, task),
    sku: (task) => collectTask(application, task),
    inventory: (task) => collectTask(application, task),
    recollection: (task) => collectTask(application, task),
    manufacturer: async (task) => {
      const planned = await planManufacturerWorkflow(application, {
        productIds: [task.input.productId],
      });
      const id = planned.workflow?.id || planned.plan?.id || planned.id;
      const result = await runManufacturerWorkflow(application, id, {
        allowNetwork: options.allowNetwork === true,
        maxTasks: options.manufacturerBatchSize || 25,
        searchProvider:
          options.searchProvider ||
          application.manufacturerSearchProvider ||
          (options.searchConfiguration
            ? createManufacturerSearchProvider(
                application,
                options.searchConfiguration
              )
            : undefined),
        factExtractor: options.factExtractor,
        signal: options.signal,
        retryBlocked: options.retryBlocked === true,
        recoverInterrupted: options.recoverInterrupted === true,
      });
      const pendingWork =
        result.lastRun?.executedTasks > 0 &&
        result.tasks.some((entry) => entry.status === 'queued');
      return {
        manufacturerWorkflowId: id,
        result,
        pendingWork,
        needsReview: !pendingWork,
      };
    },
    translation: async (task) => {
      const result = await application.translateCatalog({
        productIds: [task.input.productId],
        cacheOnly: options.allowNetwork !== true,
        limit: options.translationBatchSize || 100,
        includeSources: true,
      });
      const pendingWork =
        result.lastRun?.processed > 0 && result.counts?.remaining > 0;
      return {
        result,
        pendingWork,
        needsReview: !result.reviewedComplete && !pendingWork,
      };
    },
    delivery: (task) => deliveryTask(application, task, record),
    checkout: (task) => checkoutTask(application, task, record, options),
    'manual-review': async () => {
      const coverage = await caseCoverageStatus(application, {
        manualReviewId: options.manualReviewId,
      });
      const review = coverage.manualReview;
      if (
        !review ||
        coverage.audit.categoryReview.length ||
        coverage.audit.categoryReviewProducts.length ||
        !review.classificationReviewed ||
        !review.listPaginationReviewed ||
        !review.exactPriceExtractionReviewed ||
        !review.quantityExtractionReviewed
      ) {
        throw new Error(
          'Current source-bound manual review and individually resolved category records are required'
        );
      }
      return {
        manualReviewId: review.id,
        scopeFingerprint: coverage.scopeFingerprint,
        needsReview: false,
      };
    },
    report: async () =>
      saveShoppingReport(
        application,
        await buildShoppingReport(application, {
          quantities: record.definition.quantities,
          handpicked: record.definition.handpicked,
          deliveryArea: record.definition.deliveryArea,
        })
      ),
  };
}

function checkpointTask(application, task, update) {
  return application.store.put('case-task', {
    ...task,
    ...update,
    updatedAt: new Date().toISOString(),
  });
}

function resultNeedsReview(result) {
  return (
    result?.needsReview === true ||
    (result?.pending || 0) > 0 ||
    result?.accepted === false ||
    result?.status === 'blocked' ||
    result?.status === 'needs-review'
  );
}

export async function runCaseWorkflow(application, workflowId, options = {}) {
  const maxTasks = positive(options.maxTasks ?? 25, 'maxTasks', {
    integer: true,
  });
  if (maxTasks > 5000) {
    throw new Error('Case run task bound exceeded');
  }
  if (options.allowNetwork !== true && !application.cache.offline) {
    throw new Error(
      'Cached-only case execution requires an offline application'
    );
  }
  const record = await workflow(application, workflowId);
  const release = await acquireCaseLease(application, workflowId);
  const actions = handlers(application, record, options);
  let executed = 0;
  try {
    const current = await refreshCaseWorklist(application, record);
    const tasks = (await caseWorkflowStatus(application, workflowId)).tasks
      .filter((task) => current.currentTaskIds.includes(task.id))
      .sort(
        (a, b) =>
          CASE_TASK_ORDER.indexOf(a.stage) - CASE_TASK_ORDER.indexOf(b.stage)
      );
    for (const task of tasks) {
      if (executed >= (options.maxTasks ?? 25) || options.signal?.aborted) {
        break;
      }
      if (
        ['succeeded', 'unavailable', 'superseded'].includes(task.status) ||
        (task.status === 'blocked' && options.retryBlocked !== true) ||
        task.attempts >= record.definition.maxAttempts
      ) {
        continue;
      }
      if (task.stage === 'recollection' && initialPassPending(tasks)) {
        continue;
      }
      if (options.allowNetwork === true) {
        await assertCollectionRunning(application.store);
      }
      const running = await checkpointTask(application, task, {
        status: 'running',
        attempts: task.attempts,
        runs: (task.runs || 0) + 1,
        startedAt: new Date().toISOString(),
      });
      try {
        const result = await actions[task.stage](task);
        task.status = result.pendingWork
          ? 'pending'
          : resultNeedsReview(result)
            ? 'blocked'
            : 'succeeded';
        await checkpointTask(application, running, {
          status: task.status,
          result,
          ...(task.status === 'blocked'
            ? {
                reason:
                  'Review, remaining source tasks or live acceptance required',
              }
            : {}),
        });
      } catch (error) {
        const stop = await application.store.get(
          'collection-stop',
          COLLECTION_STOP_ID
        );
        const status =
          error.code === 'PAGE_UNAVAILABLE' ? 'unavailable' : 'blocked';
        task.status = status;
        await checkpointTask(application, running, {
          status,
          attempts: task.attempts + 1,
          reason: stop?.active ? 'Persistent collection stop' : error.message,
          errorCode: error.code || null,
        });
        if (stop?.active || error.code === 'COLLECTION_STOPPED') {
          break;
        }
        if (task.stage === 'discovery') {
          break;
        }
      }
      executed += 1;
    }
    await refreshCaseWorklist(application, record);
    const report = await saveShoppingReport(
      application,
      await buildShoppingReport(application, {
        quantities: record.definition.quantities,
        handpicked: record.definition.handpicked,
        deliveryArea: record.definition.deliveryArea,
      })
    );
    return {
      ...(await caseWorkflowStatus(application, workflowId)),
      executed,
      reportId: report.id,
      cache: { ...application.cache.stats },
    };
  } finally {
    await release();
  }
}
