import {
  ManufacturerResearch,
  manufacturerIdentityGaps,
  reviewManufacturerResearch,
  validateManufacturerOriginalFact,
} from './manufacturer-research.js';
import { workflowOriginalForTask } from './manufacturer-workflow.js';
import {
  workflowProductFingerprint,
  workflowSourceInvalidated,
} from './label-worklist.js';
import { resolveProductReviews } from './catalog-products.js';
import { reviewPackageQuantities } from './package-quantity-review.js';
import { reconcileManufacturer } from './verification.js';
import { validateProduct } from './products.js';
import { isTrustedManufacturer } from './manufacturers.js';
import { fold, sha256, listingKey } from './util.js';
import { isDeepStrictEqual } from 'node:util';
import {
  boundWorkflowOcrText,
  extractStructuredWorkflowCandidates,
  workflowSourceText,
} from './manufacturer-workflow-facts.js';

const DAY = 86400000;
const REQUIRED_IDENTITY = [
  'brand',
  'name',
  'flavour',
  'market',
  'packageType',
  'formulaRevision',
];
const same = (a, b) =>
  typeof a === 'string' ? Boolean(fold(a)) && fold(a) === fold(b) : a === b;

function reviewedIdentity(expected, declared, label) {
  if (
    !declared ||
    REQUIRED_IDENTITY.some((field) => !declared[field]?.trim()) ||
    declared.currentFormula !== true ||
    !(declared.gtin || declared.variantCode)
  ) {
    throw new Error(
      `${label} requires explicit exact package identifier, revision and current-formula review`
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    if (
      value !== null &&
      value !== undefined &&
      field !== 'currentFormula' &&
      !same(value, declared[field])
    ) {
      throw new Error(`${label} conflicts with captured ${field}`);
    }
  }
  return declared;
}

function stagingStore(store) {
  const pending = new Map();
  const staged = Object.create(store);
  staged.get = (kind, id) =>
    pending.has(`${kind}:${id}`)
      ? Promise.resolve(
          globalThis.structuredClone(pending.get(`${kind}:${id}`).record)
        )
      : store.get(kind, id);
  staged.list = async (kind) => {
    const records = new Map(
      (await store.list(kind)).map((record) => [record.id, record])
    );
    for (const entry of pending.values()) {
      if (entry.kind === kind) {
        records.set(entry.record.id, entry.record);
      }
    }
    return [...records.values()];
  };
  staged.put = (kind, record) => {
    pending.set(`${kind}:${record.id}`, {
      kind,
      record: globalThis.structuredClone(record),
    });
    return Promise.resolve(globalThis.structuredClone(record));
  };
  staged.blob = (hash) => store.blob(hash);
  return { store: staged, pending };
}

async function reviewContext(application, input) {
  if (application.cache.offline !== true) {
    throw new Error('Workflow source review requires an offline application');
  }
  const plan = await application.store.get(
    'manufacturer-workflow',
    input.workflowId
  );
  const draft = await application.store.get(
    'manufacturer-review-draft',
    input.reviewDraftId
  );
  const item = plan?.items.find(
    (entry) => entry.productId === draft?.productId
  );
  if (
    !plan ||
    !draft ||
    !item ||
    !plan.tasks.some((task) => task.reviewDraftId === draft.id)
  ) {
    throw new Error('Review draft does not belong to this saved workflow');
  }
  const raw = await application.store.get('product', item.productId);
  const product = await resolveProductReviews(application.store, raw);
  if (
    !product ||
    workflowProductFingerprint(product) !== item.productFingerprint ||
    draft.productFingerprint !== item.productFingerprint
  ) {
    throw new Error('Selected product changed; prepare a new workflow review');
  }
  const context = {
    application,
    plan,
    item,
    draft,
    raw,
    product,
    caches: await application.store.list('cache'),
    invalidations: await application.store.list('invalidation'),
    research: new ManufacturerResearch({
      store: application.store,
      offline: true,
      registry: application.manufacturerRegistry.map((entry) => ({
        brand: entry.name,
        domains: entry.domains,
        assetDomains: entry.assetDomains || [],
      })),
      ocr: false,
    }),
  };
  context.candidates = [];
  for (const proposed of draft.candidates) {
    const candidate = await application.store.get(
      'manufacturer-fact-candidate',
      proposed.id
    );
    if (
      !candidate ||
      sha256(JSON.stringify(candidate)) !== sha256(JSON.stringify(proposed)) ||
      candidate.productId !== product.id
    ) {
      throw new Error(
        'Saved fact candidate does not match this exact retained product'
      );
    }
    await workflowOriginalForTask(context, {
      itemIds: [item.id],
      input: {
        sourceId: candidate.sourceId,
        sourceSha256: candidate.sourceSha256,
        sourceRecordKind: candidate.sourceRecordKind,
      },
    });
    context.candidates.push(candidate);
  }
  for (const id of product.evidenceIds || []) {
    const evidence = await application.store.get('evidence', id);
    if (
      evidence?.sourceId &&
      context.candidates.some(
        (candidate) => candidate.sourceId === evidence.sourceId
      ) &&
      workflowSourceInvalidated(evidence, context.caches, context.invalidations)
    ) {
      throw new Error('Attached original source evidence was invalidated');
    }
  }
  return context;
}

async function listingOriginal(context, input) {
  const { application, product } = context;
  const evidence = await application.store.get(
    'evidence',
    input.listingEvidenceId
  );
  const bytes =
    evidence?.html?.sha256 === input.listingSha256
      ? await application.store.blob(input.listingSha256)
      : null;
  if (
    !evidence ||
    !product.evidenceIds.includes(evidence.id) ||
    evidence.role !== 'listing' ||
    !bytes ||
    sha256(bytes) !== input.listingSha256 ||
    bytes.length !== evidence.html.bytes ||
    listingKey(evidence.url) !== listingKey(product.url) ||
    Date.parse(evidence.observedAt) !== Date.parse(product.observedAt) ||
    workflowSourceInvalidated(evidence, context.caches, context.invalidations)
  ) {
    throw new Error(
      'Workflow review requires the unchanged exact selected listing original'
    );
  }
  return evidence;
}

function chosenCandidates(context, input) {
  if (
    !Array.isArray(input.candidateIds) ||
    !input.candidateIds.length ||
    input.candidateIds.length > 100 ||
    new Set(input.candidateIds).size !== input.candidateIds.length
  ) {
    throw new Error('Explicit unique reviewed fact candidate IDs are required');
  }
  const candidates = input.candidateIds.map((id) =>
    context.candidates.find((candidate) => candidate.id === id)
  );
  if (
    candidates.some((candidate) => !candidate) ||
    new Set(candidates.map((candidate) => candidate.field)).size !==
      candidates.length
  ) {
    throw new Error(
      'Candidate IDs must select one supported source per reviewed field'
    );
  }
  for (const candidate of candidates) {
    const quantity = ['netMassG', 'netVolumeMl'].includes(candidate.field);
    if (
      (context.draft.kind === 'quantity') !== quantity ||
      (candidate.value === 0 &&
        !input.confirmedZeroValueCandidateIds?.includes(candidate.id))
    ) {
      throw new Error(
        'Quantity/nutrition review boundaries and zero-placeholder confirmation must remain explicit'
      );
    }
  }
  return candidates;
}

async function primaryQuantityCandidates(context, input) {
  const ids = input.factoryQuantityCandidateIds || [];
  if (
    !Array.isArray(ids) ||
    ids.length > 2 ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error(
      'Factory quantity candidate IDs must explicitly select at most grams and millilitres'
    );
  }
  if (ids.length && context.draft.kind !== 'nutrition') {
    throw new Error(
      'Independent quantity review cannot approve factory nutrition'
    );
  }
  const allowed = new Map();
  for (const task of context.plan.tasks.filter(
    (entry) => entry.reviewDraftId
  )) {
    const draft = await context.application.store.get(
      'manufacturer-review-draft',
      task.reviewDraftId
    );
    if (
      draft?.kind === 'quantity' &&
      draft.productId === context.product.id &&
      draft.productFingerprint === context.item.productFingerprint
    ) {
      for (const candidate of draft.candidates) {
        allowed.set(candidate.id, candidate);
      }
    }
  }
  const result = [];
  for (const id of ids) {
    const saved = await context.application.store.get(
      'manufacturer-fact-candidate',
      id
    );
    const proposed = allowed.get(id);
    if (
      !saved ||
      !proposed ||
      sha256(JSON.stringify(saved)) !== sha256(JSON.stringify(proposed)) ||
      saved.sourceRecordKind !== 'manufacturer-source' ||
      saved.sourceAuthority !== 'manufacturer'
    ) {
      throw new Error(
        'Factory quantity requires an unchanged primary-source candidate from this exact workflow'
      );
    }
    result.push(saved);
  }
  if (
    new Set(result.map((candidate) => candidate.field)).size !== result.length
  ) {
    throw new Error('Choose one original candidate per factory quantity field');
  }
  return result;
}

async function sourceForReview(context, candidate, maxSourceAgeMs) {
  const { source, bytes } = await workflowOriginalForTask(context, {
    itemIds: [context.item.id],
    input: {
      sourceId: candidate.sourceId,
      sourceSha256: candidate.sourceSha256,
      sourceRecordKind: candidate.sourceRecordKind,
    },
  });
  const observed = Date.parse(source.observedAt);
  if (
    !Number.isFinite(observed) ||
    observed > Date.now() + 60000 ||
    Date.now() - observed > maxSourceAgeMs
  ) {
    throw new Error(
      'Source date is absent, future-dated or outside the explicit review freshness window'
    );
  }
  return { source, bytes };
}

function sourceEvidence(product, source) {
  const id = `workflow-source-evidence:${sha256(JSON.stringify([product.id, source.id, source.blob.sha256]))}`;
  const reference =
    source.kind === 'label'
      ? 'image'
      : /html/iu.test(source.contentType || '')
        ? 'html'
        : 'blob';
  return {
    id,
    productId: product.id,
    role: 'manufacturer-supplied-by-operator',
    url: source.finalUrl,
    observedAt: source.observedAt,
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
    sourceAuthority: source.authority,
    [reference]: source.blob,
    ...(source.visibility === 'private' ? { visibility: 'private' } : {}),
    extracted: { evidenceIds: [id], claims: [] },
  };
}

async function preparedSources(context, candidates, input, staged) {
  const maximum = input.maxSourceAgeMs ?? 7 * DAY;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 365 * DAY) {
    throw new Error(
      'Source review freshness must be a positive bounded millisecond interval'
    );
  }
  const sources = new Map();
  const attachments = new Map();
  const anchors = new Map();
  for (const candidate of candidates) {
    const { source, bytes } = await sourceForReview(
      context,
      candidate,
      maximum
    );
    const declaredIdentity = input.sourceIdentities?.[source.id];
    if (candidate.identity) {
      reviewedIdentity(
        candidate.identity,
        declaredIdentity,
        'Original candidate identity'
      );
    }
    if (/json/iu.test(source.contentType || '')) {
      const original = extractStructuredWorkflowCandidates({
        source,
        text: workflowSourceText(source, bytes),
      });
      if (
        (candidate.structuredJsonPointer ||
          candidate.structuredOriginalSha256) &&
        !original.identity
      ) {
        throw new Error('Structured original lost its explicit exact identity');
      }
      if (original.identity) {
        reviewedIdentity(
          original.identity,
          declaredIdentity,
          'Original structured source identity'
        );
      }
    }
    await validateManufacturerOriginalFact(
      context.application.store,
      source,
      candidate,
      {
        identity: {
          listing: input.listingIdentity,
          manufacturer: input.manufacturerIdentity,
          source: input.sourceIdentities?.[source.id],
        },
      }
    );
    sources.set(source.id, source);
    if (candidate.sourceRecordKind === 'evidence') {
      attachments.set(
        source.id,
        await context.application.store.get('evidence', source.id)
      );
    } else {
      const evidence = sourceEvidence(context.product, source);
      await staged.store.put('evidence', evidence);
      attachments.set(source.id, evidence);
    }
    if (source.kind === 'label' && source.sourceRecordKind !== 'evidence') {
      const parent = await context.application.store.get(
        'manufacturer-source',
        source.parentSourceId
      );
      const evidence = sourceEvidence(context.product, parent);
      await staged.store.put('evidence', evidence);
      attachments.set(parent.id, evidence);
      anchors.set(source.id, evidence);
    } else {
      anchors.set(source.id, attachments.get(source.id));
    }
  }
  return { sources, attachments, anchors };
}

export async function prepareManufacturerWorkflowReview(application, input) {
  const context = await reviewContext(application, input);
  const factoryQuantityOptions = [];
  if (context.draft.kind === 'nutrition') {
    for (const task of context.plan.tasks.filter(
      (entry) => entry.reviewDraftId
    )) {
      const draft = await application.store.get(
        'manufacturer-review-draft',
        task.reviewDraftId
      );
      if (
        draft?.kind === 'quantity' &&
        draft.productId === context.product.id
      ) {
        factoryQuantityOptions.push(
          ...draft.candidates.filter(
            (candidate) => candidate.sourceAuthority === 'manufacturer'
          )
        );
      }
    }
  }
  return {
    workflowId: input.workflowId,
    reviewDraftId: input.reviewDraftId,
    productId: context.product.id,
    productFingerprint: context.item.productFingerprint,
    kind: context.draft.kind,
    candidateIds: context.candidates.map((candidate) => candidate.id),
    candidates: context.candidates,
    listingOriginals: context.draft.listingOriginals,
    factoryQuantityCandidateOptions: factoryQuantityOptions,
    expectedListingIdentity: context.item.identity,
    requiredHumanInputs: [
      'reviewedBy',
      'reason',
      'listingEvidenceId',
      'listingSha256',
      'listingIdentity',
      'manufacturerIdentity',
      'sourceIdentities',
      'currentFormula',
      'formulaRevision',
    ],
    maxSourceAgeMs: 7 * DAY,
    automaticApprovalAllowed: false,
    codeValidation: 'draft-untested',
  };
}

async function applyQuantityReview(
  context,
  input,
  candidates,
  staged,
  sources
) {
  const facts = {};
  for (const candidate of candidates) {
    const declared = input.sourceIdentities?.[candidate.sourceId];
    reviewedIdentity(
      input.listingIdentity,
      declared,
      'Quantity source identity'
    );
    const gaps = manufacturerIdentityGaps(input.listingIdentity, declared);
    if (
      gaps.length ||
      candidate.basis !== 'one-inner-food-package' ||
      declared[candidate.field] !== candidate.value
    ) {
      throw new Error(
        `Quantity source package identity remains unresolved: ${gaps.join(', ')}`
      );
    }
    const attached = sources.attachments.get(candidate.sourceId);
    facts[candidate.field] = {
      value: candidate.value,
      unit: candidate.unit,
      basis: candidate.basis,
      excerpt: candidate.excerpt,
      sourceEvidenceId: attached.id,
      sourceSha256: candidate.sourceSha256,
      sourceAuthority: candidate.sourceAuthority,
      identityMatched: true,
    };
  }
  const review = await reviewPackageQuantities(
    { ...context.application, store: staged.store },
    context.product.id,
    {
      reviewedBy: input.reviewedBy,
      reason: input.reason,
      listingEvidenceId: input.listingEvidenceId,
      listingSha256: input.listingSha256,
      facts,
    }
  );
  return { quantityReviewId: review.id, appliedFields: Object.keys(facts) };
}

async function applyNutritionReview(
  context,
  input,
  candidates,
  staged,
  sources
) {
  const gaps = manufacturerIdentityGaps(
    input.listingIdentity,
    input.manufacturerIdentity
  );
  if (gaps.length) {
    throw new Error(
      `Exact manufacturer identity is incomplete: ${gaps.join(', ')}`
    );
  }
  const facts = {};
  for (const candidate of candidates) {
    const source = sources.sources.get(candidate.sourceId);
    const anchor = sources.anchors.get(source.id);
    if (
      candidate.sourceRecordKind !== 'manufacturer-source' ||
      source.authority !== 'manufacturer' ||
      !isTrustedManufacturer(
        context.product,
        anchor.url,
        context.application.manufacturerRegistry
      )
    ) {
      throw new Error(
        'Nutrition requires an exact registered primary manufacturer original'
      );
    }
    reviewedIdentity(
      input.listingIdentity,
      input.sourceIdentities?.[source.id],
      'Manufacturer source identity'
    );
    facts[candidate.field] = {
      ...candidate,
      sourceId: source.id,
      sourceSha256: source.blob.sha256,
    };
  }
  const research = await reviewManufacturerResearch(staged.store, {
    reviewedBy: input.reviewedBy,
    reason: input.reason,
    skus: [context.product.sku],
    identity: {
      listing: input.listingIdentity,
      manufacturer: input.manufacturerIdentity,
    },
    sourceIdentities: input.sourceIdentities,
    facts,
    requiredFields: Object.keys(facts),
  });
  if (!research.identityMatched || research.blockingEvidenceGaps.length) {
    throw new Error('Reviewed source facts remain incomplete');
  }
  const anchor = sources.anchors.get(candidates[0].sourceId);
  const claims = Object.entries(research.facts).map(([field, fact]) => ({
    field,
    value: fact.value,
    excerpt: fact.excerpt,
    source: 'manufacturer',
    requiresReview: false,
    evidenceId: anchor.id,
    sourceEvidenceId: sources.attachments.get(fact.sourceId).id,
    sourceSha256: fact.sourceSha256,
    sourceUrl: fact.sourceUrl,
    reviewId: research.id,
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date().toISOString(),
  }));
  const check = {
    id: research.id,
    evidenceId: anchor.id,
    sourceAuthority: 'manufacturer',
    identityMatched: true,
    identityMethod: 'exact-source-identifiers',
    manufacturerUrl: anchor.url,
    checkedAt: new Date().toISOString(),
    identity: {
      listing: input.listingIdentity,
      manufacturer: input.manufacturerIdentity,
    },
  };
  const product = await staged.store.get('product', context.product.id);
  const updated = reconcileManufacturer(product, { claims }, check);
  updated.manufacturerVerification.identity = input.manufacturerIdentity;
  updated.manufacturerVerification.reviewId = research.id;
  updated.pendingSpecificationReview = (
    updated.pendingSpecificationReview || []
  ).filter((field) => !claims.some((claim) => claim.field === field));
  updated.crossChecks = [...(updated.crossChecks || []), check];
  anchor.extracted = { evidenceIds: product.evidenceIds, claims };
  await staged.store.put('evidence', anchor);
  await staged.store.put('manufacturer-review', {
    ...research,
    productId: product.id,
    evidenceId: anchor.id,
  });
  await staged.store.put('product', validateProduct(updated));
  return {
    manufacturerReviewId: research.id,
    researchReviewId: research.id,
    appliedFields: Object.keys(facts),
  };
}

async function assertCommitCurrent(
  context,
  input,
  candidates,
  includeProjection
) {
  const store = context.application.store;
  context.caches = await store.list('cache');
  context.invalidations = await store.list('invalidation');
  const draft = await store.get('manufacturer-review-draft', context.draft.id);
  if (!isDeepStrictEqual(draft, context.draft)) {
    throw new Error(
      'Review draft changed during validation; approval withdrawn'
    );
  }
  await listingOriginal(context, input);
  for (const candidate of candidates) {
    if (
      !isDeepStrictEqual(
        await store.get('manufacturer-fact-candidate', candidate.id),
        candidate
      )
    ) {
      throw new Error(
        'Fact candidate changed during validation; approval withdrawn'
      );
    }
    const { source } = await sourceForReview(
      context,
      candidate,
      input.maxSourceAgeMs ?? 7 * DAY
    );
    if (candidate.ocrId) {
      await boundWorkflowOcrText(
        store,
        source,
        await store.get('ocr', candidate.ocrId)
      );
    }
    for (const evidence of await store.list('evidence')) {
      if (
        evidence.sourceId === source.id &&
        workflowSourceInvalidated(
          evidence,
          context.caches,
          context.invalidations
        )
      ) {
        throw new Error(
          'Attached source changed or was invalidated during validation'
        );
      }
    }
  }
  // This is deliberately the final read before writes. Source validation has
  // asynchronous reads and must not retain a now-obsolete product snapshot.
  const current = await store.get('product', context.product.id);
  if (
    !isDeepStrictEqual(current, context.raw) ||
    workflowProductFingerprint(current) !==
      workflowProductFingerprint(context.raw)
  ) {
    throw new Error(
      'Collected product changed during review; approval withdrawn'
    );
  }
  if (
    includeProjection &&
    !isDeepStrictEqual(
      await resolveProductReviews(store, current),
      context.product
    )
  ) {
    throw new Error('Current shared product review changed during validation');
  }
}

export async function reviewManufacturerWorkflow(application, input) {
  if (
    !input?.reviewedBy?.trim() ||
    !input.reason?.trim() ||
    input.automaticApproval === true
  ) {
    throw new Error(
      'An explicit human reviewer and matching rationale are required'
    );
  }
  const context = await reviewContext(application, input);
  if (input.productFingerprint !== context.item.productFingerprint) {
    throw new Error(
      'Review packet differs from the unchanged selected product'
    );
  }
  await listingOriginal(context, input);
  reviewedIdentity(
    context.item.identity,
    input.listingIdentity,
    'Listing identity'
  );
  reviewedIdentity(
    input.listingIdentity,
    input.manufacturerIdentity,
    'Manufacturer identity'
  );
  const candidates = [
    ...chosenCandidates(context, input),
    ...(await primaryQuantityCandidates(context, input)),
  ];
  const staged = stagingStore(application.store);
  const sources = await preparedSources(context, candidates, input, staged);
  await staged.store.put('product', {
    ...context.raw,
    evidenceIds: [
      ...new Set([
        ...context.raw.evidenceIds,
        ...[...sources.attachments.values()].map((evidence) => evidence.id),
      ]),
    ],
  });
  const result =
    context.draft.kind === 'quantity'
      ? await applyQuantityReview(context, input, candidates, staged, sources)
      : await applyNutritionReview(context, input, candidates, staged, sources);
  // Validate the entire packet in the staged view first. Product projection is
  // committed last; partial attachment writes cannot approve a rejected fact.
  const writes = [...staged.pending.values()].sort(
    (a, b) => Number(a.kind === 'product') - Number(b.kind === 'product')
  );
  await assertCommitCurrent(context, input, candidates, true);
  for (const entry of writes) {
    if (entry.kind === 'product') {
      await assertCommitCurrent(context, input, candidates, false);
      const saved =
        typeof application.store.putLatest === 'function'
          ? await application.store.putLatest(entry.kind, entry.record)
          : await application.store.put(entry.kind, entry.record);
      if (
        workflowProductFingerprint(saved) !==
        workflowProductFingerprint(entry.record)
      ) {
        throw new Error(
          'A newer product was retained by the chronological writer; approval withdrawn'
        );
      }
    } else {
      await application.store.put(entry.kind, entry.record);
    }
  }
  const receipt = {
    id: `manufacturer-workflow-review:${sha256(JSON.stringify(input))}`,
    workflowId: input.workflowId,
    reviewDraftId: input.reviewDraftId,
    productId: context.product.id,
    reviewedBy: input.reviewedBy,
    reason: input.reason,
    reviewedAt: new Date().toISOString(),
    automaticApproval: false,
    ...result,
  };
  await application.store.put('manufacturer-workflow-review', receipt);
  const projected = await resolveProductReviews(
    application.store,
    await application.store.get('product', context.product.id)
  );
  const fingerprint = workflowProductFingerprint(projected);
  context.item.productFingerprint = fingerprint;
  context.item.originals.push(
    ...[...sources.attachments.values()]
      .filter(
        (evidence) =>
          !context.item.originals.some(
            (original) => original.evidenceId === evidence.id
          )
      )
      .map((evidence) => {
        const [kind, blob] = ['html', 'image', 'blob']
          .map((field) => [field, evidence[field]])
          .find(([, ref]) => ref?.sha256);
        return {
          evidenceId: evidence.id,
          kind,
          role: evidence.role,
          url: evidence.url,
          sha256: blob.sha256,
          bytes: blob.bytes,
          invalidated: false,
        };
      })
  );
  for (const task of context.plan.tasks.filter(
    (entry) => entry.reviewDraftId
  )) {
    const draft = await application.store.get(
      'manufacturer-review-draft',
      task.reviewDraftId
    );
    if (draft?.productId === context.product.id) {
      await application.store.put('manufacturer-review-draft', {
        ...draft,
        productFingerprint: fingerprint,
        approvedAttachmentTransition: receipt.id,
      });
    }
  }
  await application.store.put('manufacturer-workflow', context.plan);
  return receipt;
}
