import { latestCrawl } from './crawl.js';
import { catalogProducts } from './catalog-products.js';
import { scopeAccountAudit, categorySourceKey } from './collection-scope.js';
import { persistScopeDecisions } from './scope-decisions.js';
import { canonicalUrl, sha256, listingKey } from './util.js';
import { positive } from './values.js';
import { specificationProblems } from './verification.js';
import { productFlavour, isShakerBundle } from './flavour-scope.js';
import {
  applyCaseCategoryDecisions,
  caseCoverageStatus,
} from './case-coverage.js';
import { validatedHandpickedLinks } from './handpicked-links.js';
import { shoppingCategory } from './shopping-report.js';

export const CASE_WORKFLOW_VERSION = 'case-workflow-draft-v1';
export const CASE_TASK_ORDER = [
  'discovery',
  'handpicked',
  'listing',
  'sku',
  'inventory',
  'manufacturer',
  'translation',
  'delivery',
  'checkout',
  'manual-review',
  'recollection',
  'report',
];

const time = () => new Date().toISOString();
const digest = (value) => sha256(JSON.stringify(value));
export const caseTaskId = (workflowId, stage, input) =>
  `case-task:${digest([CASE_WORKFLOW_VERSION, workflowId, stage, input])}`;

export async function scopedCaseAudit(application, definition) {
  const crawl = latestCrawl(await application.store.list('crawl'));
  const discoveries = await application.store.list('discovery');
  const audit = await applyCaseCategoryDecisions(
    application,
    scopeAccountAudit(await application.audit(), {
      flavourScope: definition.flavourScope,
      crawl,
      discoveries,
      activeSourcesOnly: false,
    })
  );
  await persistScopeDecisions(application.store, audit, {
    flavourScope: definition.flavourScope,
  });
  const expected = [
    ...definition.queries.map((query) => ({ query })),
    ...definition.categoryUrls.map((url) => ({ url })),
  ];
  const sourceMatches = (source) =>
    (crawl?.scopes || []).some((scope) =>
      source.query
        ? scope.query === source.query
        : categorySourceKey(scope.url || '') === categorySourceKey(source.url)
    );
  return {
    ...audit,
    discoveryComplete:
      audit.sourceListsComplete && expected.every(sourceMatches),
    crawlId: crawl?.id || null,
  };
}

function skuUrl(entry) {
  const url = new URL(entry.url || entry.listingUrl);
  url.searchParams.set('skuId', String(entry.sku).split('_VNAMZ-').at(-1));
  return canonicalUrl(url.href);
}

function sourceFingerprint(product, offer) {
  return digest([
    product.id,
    product.observedAt,
    product.originalHtmlSha256,
    product.pendingSpecificationReview,
    product.evidenceIds,
    offer?.id,
    offer?.observedAt,
    offer?.evidenceId,
  ]);
}

function isTarget(product) {
  if (isShakerBundle(product)) {
    return false;
  }
  if (['soy', 'mixed-protein'].includes(shoppingCategory(product))) {
    return false;
  }
  const flavour = productFlavour(product);
  if (product.category === 'chocolate-ice-cream') {
    return flavour === 'chocolate';
  }
  return (
    ['whey', 'protein-powder'].includes(product.category) &&
    ['chocolate', 'unflavoured'].includes(flavour)
  );
}

function deliveryTask(offer, product, quantity, definition, quotes) {
  const currentCheckout = quotes.some((entry) => {
    const age = Date.now() - Date.parse(entry.quote.observedAt);
    return (
      entry.metrics &&
      entry.quote.lines.length === 1 &&
      entry.quote.deliveryArea === definition.deliveryArea &&
      entry.quote.lines[0].sku === offer.sku &&
      entry.quote.lines[0].quantity === quantity &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= definition.maxPriceAgeMs &&
      (product.category !== 'chocolate-ice-cream' ||
        entry.quote.coldChainConfirmed === true)
    );
  });
  if (currentCheckout) {
    return [];
  }
  const quoteAge = Date.now() - Date.parse(offer.quoteObservedAt);
  const exact =
    Number.isFinite(quoteAge) &&
    quoteAge >= 0 &&
    quoteAge <= definition.maxPriceAgeMs &&
    offer.shippingQuantity === quantity &&
    offer.deliveryArea === definition.deliveryArea &&
    Number.isFinite(offer.shipping) &&
    !offer.shippingInvalidated &&
    offer.deliveryAvailable !== false &&
    (product.category !== 'chocolate-ice-cream' ||
      offer.coldChainConfirmed === true);
  return exact
    ? []
    : [
        {
          stage: quantity === 1 ? 'delivery' : 'checkout',
          input: {
            offerId: offer.id,
            productId: product.id,
            sku: offer.sku,
            url: offer.url,
            quantity,
            sourceFingerprint: sourceFingerprint(product, offer),
          },
          reason:
            quantity === 1
              ? 'Exact destination and cold-chain quote required'
              : 'Prepared quantity-specific checkout, voucher and payment conditions required',
        },
      ];
}

function productTasks(product, offers, definition, quotes) {
  const fingerprint = sourceFingerprint(product);
  const tasks = [
    {
      stage: 'translation',
      input: { productId: product.id, sourceFingerprint: fingerprint },
      reason:
        'Cached English with number, unit, identity and semantic review guards',
    },
  ];
  if (
    specificationProblems(product).length > 0 ||
    !product.manufacturerVerification?.identityMatched ||
    product.pendingSpecificationReview?.length ||
    (product.category === 'chocolate-ice-cream' &&
      (!Number.isFinite(product.netMassG) ||
        !Number.isFinite(product.netVolumeMl)))
  ) {
    tasks.push({
      stage: 'manufacturer',
      input: { productId: product.id, sourceFingerprint: fingerprint },
      reason: 'Exact label, formula and physical quantities required',
    });
  }
  for (const offer of offers.filter(
    (entry) =>
      entry.productId === product.id &&
      entry.sku &&
      entry.price > 0 &&
      !entry.supersededBy &&
      entry.available !== false
  )) {
    for (const quantity of definition.quantities) {
      tasks.push(...deliveryTask(offer, product, quantity, definition, quotes));
    }
  }
  return tasks;
}

function initialTasks(audit) {
  return [
    ...audit.missingListings.map((url) => ({
      stage: 'listing',
      input: { url },
      reason:
        'Collect an unseen in-scope listing before refreshing earlier captures',
    })),
    ...audit.missingSkuPrices.map((entry) => ({
      stage: 'sku',
      input: {
        url: skuUrl(entry),
        sku: entry.sku,
        options: entry.options || [],
      },
      reason:
        'Collect this exact selected selling option; sibling price is unusable',
    })),
    ...audit.unknownSkuInventories.map((url) => ({
      stage: 'inventory',
      input: { url },
      reason: 'Enumerate every selling option from this listing',
    })),
    ...audit.missingPrices.map((entry) => ({
      stage: 'sku',
      input: {
        url: entry.url,
        offerId: entry.offerId,
        sku: entry.sku,
      },
      reason: 'Positive exact-SKU price required',
    })),
  ];
}

function recollectionTasks(products, offers, audit, definition) {
  if (
    !definition.recollectAfterInitialPass ||
    audit.missingListings.length ||
    audit.missingSkuPrices.length ||
    audit.unknownSkuInventories.length ||
    audit.missingPrices.length ||
    audit.categoryReview.length ||
    audit.categoryReviewProducts?.length
  ) {
    return [];
  }
  return products
    .filter(
      (product) =>
        product.pendingSpecificationReview?.length ||
        product.specificationsInvalidated ||
        offers.some(
          (offer) =>
            offer.productId === product.id &&
            !offer.supersededBy &&
            Date.now() - Date.parse(offer.observedAt) > definition.maxPriceAgeMs
        )
    )
    .map((product) => ({
      stage: 'recollection',
      input: {
        productId: product.id,
        url: product.url,
        sourceFingerprint: sourceFingerprint(product),
      },
      reason:
        'Initial collection completed; reload only an explicitly disputed source',
    }));
}

export async function refreshCaseWorklist(application, workflow) {
  const audit = await scopedCaseAudit(application, workflow.definition);
  const excluded = new Set(audit.reviewedExcludedListings || []);
  const products = (await catalogProducts(application.store)).filter(
    (product) => isTarget(product) && !excluded.has(listingKey(product.url))
  );
  const offers = await application.store.list('offer');
  const quotes = (
    await application.compareBaskets({
      deliveryArea: workflow.definition.deliveryArea,
      flavourScope: workflow.definition.flavourScope,
    })
  ).observations;
  const tasks = audit.discoveryComplete
    ? initialTasks(audit)
    : [
        {
          stage: 'discovery',
          input: {
            sources: workflow.definition.queries,
            categories: workflow.definition.categoryUrls,
          },
          reason:
            'Finish all configured relevant lists before opening individual products',
        },
      ];
  if (audit.discoveryComplete) {
    for (const link of await validatedHandpickedLinks(application, {
      offers,
    })) {
      if (
        !workflow.definition.handpicked.some(
          (entry) =>
            (typeof entry === 'string'
              ? entry
              : entry.submittedUrl || entry.url) === link.submittedUrl
        )
      ) {
        continue;
      }
      if (!link.sourceVerified || !link.resolvedUrl) {
        tasks.unshift({
          stage: 'handpicked',
          input: { linkId: link.id },
          reason:
            'Resolve this submitted link from original cached or paced page evidence',
        });
      } else if (link.status !== 'captured') {
        const url = new URL(link.resolvedUrl);
        if (link.sku) {
          url.searchParams.set('skuId', link.sku.split('_VNAMZ-').at(-1));
        }
        tasks.unshift({
          stage: 'sku',
          input: { url: url.href, sku: link.sku },
          reason: 'Handpicked exact selected option is unpriced',
        });
      }
    }
    tasks.push(
      ...products.flatMap((product) =>
        productTasks(product, offers, workflow.definition, quotes)
      )
    );
    tasks.push(
      ...recollectionTasks(products, offers, audit, workflow.definition)
    );
    const coverage = await caseCoverageStatus(application);
    tasks.push({
      stage: 'manual-review',
      input: {
        type: 'classification-and-extraction-review',
        fingerprint: coverage.scopeFingerprint,
      },
      reason:
        'Individually classify uncertain cards, then supply the current source-bound dataset review',
    });
  }
  tasks.push({
    stage: 'report',
    input: {
      fingerprint: digest([
        audit.crawlId,
        products.map((product) => sourceFingerprint(product)),
        offers.map((offer) => [
          offer.id,
          offer.observedAt,
          offer.price,
          offer.shipping,
        ]),
      ]),
    },
    reason: 'Retain every quantity and independently sorted unit-price report',
  });
  return {
    audit,
    currentTaskIds: await persistCaseTasks(application, workflow, tasks),
  };
}

async function persistCaseTasks(application, workflow, tasks) {
  positive(workflow.definition.maxPlannedTasks, 'maxPlannedTasks', {
    integer: true,
  });
  if (tasks.length > workflow.definition.maxPlannedTasks) {
    throw new Error(
      'Case task bound exceeded; expand the explicit plan capacity'
    );
  }
  const prior = new Map(
    (await application.store.list('case-task'))
      .filter((task) => task.workflowId === workflow.id)
      .map((task) => [task.id, task])
  );
  const current = new Set();
  for (const task of tasks) {
    const id = caseTaskId(workflow.id, task.stage, task.input);
    current.add(id);
    const previous = prior.get(id);
    const requiresCurrentSource = [
      'discovery',
      'listing',
      'sku',
      'inventory',
      'delivery',
      'checkout',
    ].includes(task.stage);
    if (
      previous &&
      requiresCurrentSource &&
      ['succeeded', 'unavailable', 'superseded'].includes(previous.status)
    ) {
      await application.store.put('case-task', {
        ...previous,
        ...task,
        status: 'pending',
        attempts: 0,
        updatedAt: time(),
        reason: 'Current source audit requires renewed evidence',
      });
    }
    if (!prior.has(id)) {
      await application.store.put('case-task', {
        ...task,
        id,
        workflowId: workflow.id,
        status: 'pending',
        attempts: 0,
        createdAt: time(),
        codeValidation: 'draft-untested',
      });
    }
  }
  for (const task of prior.values()) {
    if (
      !current.has(task.id) &&
      !['succeeded', 'unavailable', 'superseded'].includes(task.status)
    ) {
      await application.store.put('case-task', {
        ...task,
        status: 'superseded',
        updatedAt: time(),
        reason: 'Current source audit no longer requests this task',
      });
    }
  }
  return [...current];
}
