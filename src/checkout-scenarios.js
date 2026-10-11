import { readFile } from 'node:fs/promises';
import {
  basketIdentity,
  extractBasketQuote,
  saveBasketQuote,
} from './basket-quote.js';
import { normalizeText } from './text.js';
import { sha256, clone } from './util.js';
import { positive } from './values.js';

const VERSION = 'checkout-scenarios-v1';
const MAX_SCENARIOS = 512;
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'visibility')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)])
        )
      : value;
const digest = (value) => sha256(JSON.stringify(canonical(value)));

function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`${name} requires bounded explicit text`);
  }
  return normalizeText(value);
}

function unique(values, name) {
  if (!Array.isArray(values) || !values.length || values.length > 100) {
    throw new Error(`${name} requires between one and 100 choices`);
  }
  if (new Set(values.map(digest)).size !== values.length) {
    throw new Error(`${name} contains repeated choices`);
  }
  return values;
}

function planDefinition(input) {
  if (input.market !== 'vn' || input.currency !== 'VND') {
    throw new Error('Checkout scenarios require Vietnam and VND');
  }
  const lines = unique(input.lines, 'Scenario lines').map((line) => {
    const quantities = unique(line.quantities, 'Quantity sweep').map(
      (quantity) => positive(quantity, 'quantity', { integer: true })
    );
    if (quantities.some((quantity) => quantity > 10000)) {
      throw new Error('Scenario quantities must not exceed 10000');
    }
    basketIdentity([{ ...line, quantity: quantities[0] }]);
    return { offerId: line.offerId, sku: line.sku, quantities };
  });
  basketIdentity(lines.map((line) => ({ ...line, quantity: 1 })));
  const vouchers = unique(
    unique(input.voucherSelections, 'Voucher sweep').map((choice) => {
      if (!Array.isArray(choice.voucherIds) || choice.voucherIds.length > 100) {
        throw new Error(
          'Voucher choices need explicit voucher IDs, including an empty list for none'
        );
      }
      const voucherIds = choice.voucherIds
        .map((id) => text(id, 'Voucher ID'))
        .sort();
      if (new Set(voucherIds).size !== voucherIds.length) {
        throw new Error('A scenario cannot apply one voucher twice');
      }
      return { text: text(choice.text, 'Voucher state'), voucherIds };
    }),
    'Normalized voucher sweep'
  );
  const payments = unique(
    unique(input.paymentMethods, 'Payment sweep').map((method) =>
      text(method, 'Payment method')
    ),
    'Normalized payment sweep'
  );
  const total =
    lines.reduce((size, line) => size * line.quantities.length, 1) *
    vouchers.length *
    payments.length;
  if (total > MAX_SCENARIOS) {
    throw new Error(`Checkout scenario sweep exceeds ${MAX_SCENARIOS}`);
  }
  return {
    version: VERSION,
    market: input.market,
    currency: input.currency,
    deliveryArea: text(input.deliveryArea, 'Delivery area'),
    lines,
    voucherSelections: vouchers,
    paymentMethods: payments,
  };
}

function scenarios(plan) {
  let selections = [[]];
  for (const line of plan.definition.lines) {
    selections = selections.flatMap((previous) =>
      line.quantities.map((quantity) => [
        ...previous,
        { offerId: line.offerId, sku: line.sku, quantity },
      ])
    );
  }
  return selections.flatMap((lines) =>
    plan.definition.voucherSelections.flatMap((vouchers) =>
      plan.definition.paymentMethods.map((paymentMethod) => {
        const definition = { lines, vouchers, paymentMethod };
        return {
          id: `checkout-scenario:${digest([plan.id, definition])}`,
          planId: plan.id,
          definition,
        };
      })
    )
  );
}

async function storedPlan(application, id) {
  const plan = await application.store.get('checkout-plan', id);
  if (
    !plan ||
    plan.id !== `checkout-plan:${digest(plan.definition)}` ||
    digest(planDefinition(plan.definition)) !== digest(plan.definition)
  ) {
    throw new Error(
      'Checkout plan is missing or its immutable definition changed'
    );
  }
  return plan;
}

export async function planCheckoutScenarios(application, input) {
  const definition = planDefinition(input);
  const id = `checkout-plan:${digest(definition)}`;
  let plan = await application.store.get('checkout-plan', id);
  if (plan) {
    plan = await storedPlan(application, id);
  } else {
    for (const line of definition.lines) {
      const offer = await application.store.get('offer', line.offerId);
      if (
        !offer ||
        offer.sku !== line.sku ||
        offer.currency !== definition.currency
      ) {
        throw new Error(
          'Scenario planning needs existing exact selected offers'
        );
      }
    }
    plan = await application.store.put('checkout-plan', {
      id,
      definition,
      createdAt: new Date().toISOString(),
      coverageScope: 'explicit-planned-prepared-checkouts-only',
      allMarketScenariosCollected: false,
    });
  }
  for (const scenario of scenarios(plan)) {
    if (!(await application.store.get('checkout-scenario', scenario.id))) {
      await application.store.putLatest('checkout-scenario', {
        ...scenario,
        status: 'pending',
        reason:
          'Prepared original checkout with observed conditions not supplied',
      });
    }
  }
  return checkoutScenarioStatus(application, { planId: id });
}

let fingerprint;
function extractionFingerprint() {
  fingerprint ||= Promise.all(
    [
      'checkout-scenarios.js',
      'basket-quote.js',
      'nutrition.js',
      'text.js',
      'delivery-context.js',
      'values.js',
      'util.js',
    ].map(async (name) => [
      name,
      sha256(await readFile(new URL(name, import.meta.url))),
    ])
  ).then((sources) => digest([VERSION, sources]));
  return fingerprint;
}

function originalBinding(evidence, mapping, visibility) {
  return Boolean(
    evidence?.html?.sha256 === mapping.sourceSha256 &&
    evidence.sourceUrl === mapping.sourceUrl &&
    evidence.observedAt === mapping.observedAt &&
    !(visibility === 'public' && evidence.visibility === 'private') &&
    !evidence.invalidated &&
    !evidence.invalidatedAt
  );
}

function invalidatedAfter(record, observedAt) {
  return Boolean(
    record.invalidated ||
    (record.invalidatedAt &&
      (!Number.isFinite(Date.parse(record.invalidatedAt)) ||
        Date.parse(record.invalidatedAt) >= Date.parse(observedAt)))
  );
}

async function originalSource(application, mapping) {
  const evidence = await application.store.get('evidence', mapping.evidenceId);
  if (!originalBinding(evidence, mapping, application.store.visibility)) {
    throw new Error(
      'Scenario needs accessible matching original checkout evidence'
    );
  }
  const cache =
    evidence.cacheId &&
    (await application.store.get('cache', evidence.cacheId));
  const invalidations = await application.store.list('invalidation');
  const invalidated = invalidations.some(
    (record) =>
      (record.url === mapping.sourceUrl ||
        record.evidenceIds?.includes(evidence.id) ||
        record.cacheIds?.includes(evidence.cacheId)) &&
      invalidatedAfter(record, mapping.observedAt)
  );
  if (cache?.invalidatedAt || cache?.invalidated || invalidated) {
    throw new Error('Invalidated scenario source requires a fresh observation');
  }
  const bytes = await application.store.blob(mapping.sourceSha256);
  if (
    !bytes ||
    sha256(bytes) !== mapping.sourceSha256 ||
    bytes.length !== evidence.html.bytes
  ) {
    throw new Error('Scenario original checkout bytes are missing or corrupt');
  }
  return { evidence, bytes };
}

function validateConditions(plan, scenario, quote) {
  const definition = scenario.definition;
  const actualVouchers = quote.appliedDiscounts.map((item) => item.id).sort();
  if (
    quote.market !== plan.definition.market ||
    quote.currency !== plan.definition.currency ||
    quote.deliveryArea !== plan.definition.deliveryArea ||
    quote.basketIdentity !== basketIdentity(definition.lines) ||
    quote.checkoutConditions?.paymentMethod !== definition.paymentMethod ||
    quote.checkoutConditions?.voucherState !== definition.vouchers.text ||
    digest(actualVouchers) !== digest(definition.vouchers.voucherIds) ||
    quote.appliedDiscounts.some(
      (item) => item.identityValidation !== 'source-text'
    )
  ) {
    throw new Error(
      'Observed checkout quantities, destination, payment or voucher identities do not match the planned scenario'
    );
  }
}

async function reusableResult(application, plan, scenario, state, mapping) {
  if (
    state?.status !== 'validated' ||
    state.extractionFingerprint !== (await extractionFingerprint()) ||
    state.mappingSha256 !== digest(mapping)
  ) {
    return undefined;
  }
  await originalSource(application, mapping);
  const quote = await application.store.get('basket-quote', state.quoteId);
  if (!quote || digest(quote) !== state.quoteSha256) {
    return undefined;
  }
  validateConditions(plan, scenario, quote);
  return quote;
}

async function prepareCapture(application, plan, scenario, mapping) {
  const store = application.store;
  const state = await store.get('checkout-scenario', scenario.id);
  const sourceTime = Date.parse(mapping.observedAt);
  if (!Number.isFinite(sourceTime)) {
    throw new Error('Scenario capture needs its original observation time');
  }
  if (state?.observedAt && sourceTime < Date.parse(state.observedAt)) {
    throw new Error('Older scenario observation cannot replace a newer result');
  }
  const reused = await reusableResult(
    application,
    plan,
    scenario,
    state,
    mapping
  );
  if (reused) {
    return { ...state, reused: true };
  }
  const { bytes } = await originalSource(application, mapping);
  validateConditions(plan, scenario, extractBasketQuote(bytes, mapping));
  return undefined;
}

async function recordCapture(application, plan, scenario, mapping) {
  // Extraction reads actual DOM identities; expected plan IDs are only checked.
  const quote = await saveBasketQuote(application, mapping);
  validateConditions(plan, scenario, quote);
  const saved = await application.store.putLatest('checkout-scenario', {
    ...scenario,
    status: 'validated',
    observedAt: quote.observedAt,
    sourceSha256: quote.sourceSha256,
    evidenceId: quote.evidenceId,
    mappingSha256: digest(mapping),
    extractionFingerprint: await extractionFingerprint(),
    quoteId: quote.id,
    quoteSha256: digest(quote),
    sourceMapping: clone(mapping),
    validatedAt: new Date().toISOString(),
  });
  return { ...saved, reused: false };
}

async function executeCapture(application, plan, scenario, mapping) {
  const attemptedAt = new Date().toISOString();
  let result,
    prepared = false;
  try {
    result = await prepareCapture(application, plan, scenario, mapping);
    prepared = true;
  } catch (error) {
    result = {
      ...scenario,
      status: 'failed',
      reason: error.message,
      ...(application.store.visibility === 'private'
        ? { sourceMapping: clone(mapping) }
        : {}),
      sourceSha256: mapping.sourceSha256,
      evidenceId: mapping.evidenceId,
      mappingSha256: digest(mapping),
    };
    const previous = await application.store.get(
      'checkout-scenario',
      scenario.id
    );
    if (previous?.status !== 'validated') {
      await application.store.putLatest('checkout-scenario', result);
    }
  }
  if (prepared && !result?.reused) {
    // Persistence failures propagate; they are not presented as source failures.
    result = await recordCapture(application, plan, scenario, mapping);
  }
  if (!result.reused) {
    await application.store.put('checkout-scenario-attempt', {
      id: `checkout-attempt:${digest([scenario.id, mapping, await extractionFingerprint()])}`,
      scenarioId: scenario.id,
      planId: plan.id,
      attemptedAt,
      status: result.status,
      reason: result.reason,
      sourceSha256: mapping.sourceSha256,
      evidenceId: mapping.evidenceId,
      observedAt: mapping.observedAt,
      mappingSha256: digest(mapping),
      quoteId: result.quoteId,
      ...(result.status !== 'failed' ||
      application.store.visibility === 'private'
        ? { sourceMapping: clone(mapping) }
        : {}),
    });
  }
  return result;
}

async function assertCaptureBoundary(application, mapping) {
  const url = new URL(mapping.sourceUrl);
  if (url.username || url.password) {
    throw new Error('Scenario sources cannot contain URL credentials');
  }
  const evidence = await application.store.get('evidence', mapping.evidenceId);
  if (
    application.store.visibility === 'public' &&
    evidence?.visibility === 'private'
  ) {
    throw new Error(
      'Private checkout mappings cannot be persisted into public scenario state'
    );
  }
  if (application.store.visibility === 'public') {
    if (!originalBinding(evidence, mapping, 'public')) {
      throw new Error(
        'Public scenario preflight needs a matching accessible original source'
      );
    }
    const bytes = await application.store.blob(mapping.sourceSha256);
    if (
      !bytes ||
      sha256(bytes) !== mapping.sourceSha256 ||
      bytes.length !== evidence.html.bytes
    ) {
      throw new Error(
        'Public scenario preflight needs verified original source bytes'
      );
    }
  }
}

export async function runCheckoutScenarios(application, input) {
  const plan = await storedPlan(application, input.planId);
  if (!Array.isArray(input.captures) || input.captures.length > 100) {
    throw new Error(
      'Scenario batch needs at most 100 saved prepared-checkout captures'
    );
  }
  const candidates = new Map(
    scenarios(plan).map((scenario) => [scenario.id, scenario])
  );
  const prepared = input.captures.map((capture) => {
    const scenario = candidates.get(capture.scenarioId);
    if (!scenario || !capture.mapping || typeof capture.mapping !== 'object') {
      throw new Error(
        'Capture must identify a scenario in the immutable plan and its source mapping'
      );
    }
    return { scenario, mapping: clone(capture.mapping) };
  });
  const results = [];
  for (const { mapping } of prepared) {
    await assertCaptureBoundary(application, mapping);
  }
  for (const { scenario, mapping } of prepared) {
    results.push(await executeCapture(application, plan, scenario, mapping));
  }
  return {
    ...(await checkoutScenarioStatus(application, { planId: plan.id })),
    results,
    downloads: 0,
    cartMutations: 0,
    payments: 0,
  };
}

export async function checkoutScenarioStatus(application, { planId }) {
  const plan = await storedPlan(application, planId);
  const rows = [];
  for (const scenario of scenarios(plan)) {
    const saved = await application.store.get('checkout-scenario', scenario.id);
    let row = saved || { ...scenario, status: 'pending' };
    if (row.status === 'validated') {
      try {
        if (
          !(await reusableResult(
            application,
            plan,
            scenario,
            row,
            row.sourceMapping
          ))
        ) {
          row = {
            ...scenario,
            status: 'pending',
            reason: 'Cached scenario output or extraction version changed',
          };
        }
      } catch (error) {
        row = { ...scenario, status: 'pending', reason: error.message };
      }
    }
    rows.push(row);
  }
  const counts = Object.fromEntries(
    ['pending', 'failed', 'validated'].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ])
  );
  return {
    plan,
    scenarios: rows,
    counts,
    coverage: {
      planned: rows.length,
      allPlannedScenariosObserved: counts.validated === rows.length,
      allMarketScenariosCollected: false,
      checkoutLayoutLiveVerified: false,
      purchaseReady: false,
    },
  };
}
