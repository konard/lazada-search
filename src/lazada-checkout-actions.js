import { parseHTML } from 'linkedom';
import {
  checkoutScenarioStatus,
  runCheckoutScenarios,
} from './checkout-scenarios.js';
import {
  checkoutCount,
  checkoutField,
  checkoutPointer,
} from './lazada-checkout-fields.js';
import { extractCheckoutLineBinding } from './lazada-checkout-line-bindings.js';
import {
  requirePreparedCheckoutPage,
  waitPreparedCheckoutStable,
  capturePreparedLazadaCheckout,
} from './lazada-checkout-capture.js';
import {
  assertCollectionRunning,
  assertPageNotChallenged,
  stopForChallenge,
} from './page-challenge.js';
import { resolveProductReviews } from './catalog-products.js';
import { matchesFlavourScope } from './flavour-scope.js';
import { shoppingCategory } from './shopping-report.js';
import { animateScroll } from './page-scroll.js';
import { deliveryAreaForDestination } from './delivery-context.js';
import { fold } from './text.js';

function reviewedActions(input) {
  const layout = input.layout;
  if (
    input.allowCartChanges !== true ||
    layout?.reviewed !== true ||
    !layout.reviewedBy?.trim() ||
    !layout.id ||
    !layout.actionBindings
  ) {
    throw new Error(
      'Scenario changes are disabled by default: explicit allowCartChanges:true and reviewed action bindings are required'
    );
  }
  if (
    !Number.isFinite(Date.parse(layout.reviewedAt)) ||
    Date.parse(layout.reviewedAt) > Date.now() + 60000
  ) {
    throw new Error('Scenario action layout needs a real bounded review time');
  }
  return layout;
}

async function selectedScenario(application, input) {
  const status = await checkoutScenarioStatus(application, {
    planId: input.planId,
  });
  const scenario = status.scenarios.find((row) => row.id === input.scenarioId);
  if (!scenario) {
    throw new Error(
      'Scenario action must identify a member of an existing immutable checkout plan'
    );
  }
  return { plan: status.plan, scenario };
}

function actionPlan(layout, scenario) {
  const bindings = layout.actionBindings;
  const quantities = scenario.definition.lines.map((line) => {
    const source = layout.lines?.find(
      (row) => row.offerId === line.offerId && row.sku === line.sku
    );
    const binding = bindings.quantityInputs?.find(
      (row) => row.offerId === line.offerId && row.sku === line.sku
    );
    if (!source?.identityBinding || !binding?.selector) {
      throw new Error(
        'Every planned quantity change needs its exact selected SKU row and reviewed quantity input'
      );
    }
    return { kind: 'quantity', line, source, selector: binding.selector };
  });
  const vouchers = bindings.vouchers || [];
  if (
    !Array.isArray(vouchers) ||
    vouchers.length > 100 ||
    new Set(vouchers.map((voucher) => voucher.id)).size !== vouchers.length
  ) {
    throw new Error(
      'Voucher action bindings require at most 100 unique exact voucher IDs'
    );
  }
  const selectedIds = scenario.definition.vouchers.voucherIds;
  if (
    selectedIds.some(
      (id) => !vouchers.some((voucher) => voucher.id === id && voucher.selector)
    )
  ) {
    throw new Error(
      'The reviewed layout does not expose every exact planned voucher ID'
    );
  }
  const payment = bindings.payments?.filter(
    (choice) => choice.text === scenario.definition.paymentMethod
  );
  if (payment?.length !== 1 || !payment[0].selector) {
    throw new Error(
      'The reviewed layout must uniquely expose the exact planned payment radio'
    );
  }
  return [
    ...quantities,
    ...vouchers.map((voucher) => ({
      kind: 'voucher',
      selector: voucher.selector,
      id: voucher.id,
      identityAttribute: voucher.identityAttribute,
      identityValue: voucher.identityValue,
      selected: selectedIds.includes(voucher.id),
    })),
    {
      kind: 'payment',
      selector: payment[0].selector,
      text: payment[0].text,
      identityAttribute: payment[0].identityAttribute,
      identityValue: payment[0].identityValue,
      selected: true,
    },
  ];
}

async function verifiedControl(page, action) {
  if (
    typeof action.selector !== 'string' ||
    !action.selector ||
    action.selector.length > 1000
  ) {
    throw new Error('Every checkout action needs a bounded explicit selector');
  }
  const control = page.locator(action.selector);
  if (
    (await control.count()) !== 1 ||
    !(await control.isVisible()) ||
    !(await control.isEnabled())
  ) {
    throw new Error(
      'Checkout action requires exactly one visible enabled original control'
    );
  }
  const shape = await control.evaluate((element) => ({
    tag: element.tagName,
    type: element.getAttribute('type'),
    text: element.textContent,
    name: element.getAttribute('name'),
  }));
  const types =
    action.kind === 'quantity'
      ? ['number', 'text']
      : [action.kind === 'voucher' ? 'checkbox' : 'radio'];
  if (
    shape.tag !== 'INPUT' ||
    !types.includes(shape.type) ||
    /submit|place.?order|buy.?now|pay.?now|dat.?hang|mua.?ngay/iu.test(
      `${shape.text || ''} ${shape.name || ''}`
    )
  ) {
    throw new Error(
      'Checkout preparation only changes reviewed quantity inputs, voucher checkboxes or payment radios; submission controls are forbidden'
    );
  }
  if (action.kind === 'quantity') {
    const belongs = await control.evaluate(
      (element, rowSelector) =>
        globalThis.document.querySelector(rowSelector)?.contains(element) ===
        true,
      action.source.identityBinding.rowSelector
    );
    if (!belongs) {
      throw new Error(
        'Quantity action control belongs to a different selected product row'
      );
    }
  } else {
    if (
      !/^(?:value|data-[a-z\d-]+)$/u.test(action.identityAttribute || '') ||
      typeof action.identityValue !== 'string' ||
      !action.identityValue ||
      (await control.getAttribute(action.identityAttribute)) !==
        action.identityValue
    ) {
      throw new Error(
        'Voucher or payment action must match its explicitly reviewed original control identity'
      );
    }
    if (action.kind === 'voucher' && action.identityValue !== action.id) {
      throw new Error(
        'Voucher action original identity must equal its exact planned voucher ID'
      );
    }
  }
  return control;
}

async function verifySelectedRows(application, page, layout, scenario, plan) {
  const { document } = parseHTML(await page.content());
  const destination = checkoutField(
    document,
    layout.selectors?.destination,
    'scenario delivery destination'
  );
  const destinationControl = page.locator(destination.selector);
  if (
    (await destinationControl.count()) !== 1 ||
    !(await destinationControl.isVisible()) ||
    fold(deliveryAreaForDestination(destination.text)) !==
      fold(plan.definition.deliveryArea)
  ) {
    throw new Error(
      'Scenario preparation destination differs from the immutable planned delivery area'
    );
  }
  for (const line of scenario.definition.lines) {
    const offer = await application.store.get('offer', line.offerId);
    const stored =
      offer && (await application.store.get('product', offer.productId));
    if (
      !stored ||
      offer.sku !== line.sku ||
      offer.available === false ||
      offer.priceInvalidated ||
      offer.supersededBy
    ) {
      throw new Error(
        'Scenario preparation requires a current exact available stored selected product'
      );
    }
    const product = await resolveProductReviews(application.store, stored);
    if (
      !matchesFlavourScope(product, 'chocolate-or-unflavoured') ||
      !['whey', 'chocolate-ice-cream'].includes(shoppingCategory(product))
    ) {
      throw new Error(
        'Scenario preparation excludes soy, unrelated foods, other flavours and selected shaker combinations'
      );
    }
    const source = layout.lines.find(
      (row) => row.offerId === line.offerId && row.sku === line.sku
    );
    const identity = extractCheckoutLineBinding(document, source);
    if (identity?.sku !== line.sku) {
      throw new Error(
        'Checkout original selected item/SKU changed before action'
      );
    }
    const stock =
      source.stockBinding?.kind === 'embedded-json'
        ? {
            value: checkoutPointer(identity.value, source.stockBinding.pointer),
          }
        : checkoutCount(document, source.selectors?.stock, 'selected stock');
    if (
      !source.stockBinding &&
      !identity.row.contains(document.querySelector(stock.selector))
    ) {
      throw new Error(
        'Scenario stock proof belongs to a different selected row'
      );
    }
    if (!Number.isSafeInteger(stock.value) || stock.value < line.quantity) {
      throw new Error(
        'Requested scenario quantity exceeds exact original available stock'
      );
    }
    const selection = source.identityBinding.selection;
    if (
      selection.attribute === 'checked' &&
      !(await page.locator(selection.selector).isChecked())
    ) {
      throw new Error(
        'Live selected row contradicts its original checked marker'
      );
    }
  }
}

async function animateControlIntoView(page, selector) {
  const target = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = globalThis.innerHeight;
    if (rect.left < 0 || rect.right > globalThis.innerWidth) {
      throw new Error(
        'Reviewed checkout control is outside the horizontal viewport'
      );
    }
    if (rect.top >= viewport * 0.2 && rect.bottom <= viewport * 0.8) {
      return globalThis.scrollY;
    }
    const maximum = Math.max(
      0,
      globalThis.document.documentElement.scrollHeight - viewport
    );
    return Math.min(
      maximum,
      Math.max(0, globalThis.scrollY + rect.top - viewport * 0.25)
    );
  });
  await page.evaluate(animateScroll, { target, durationMs: 650 });
}

async function paceMutation(application, page, sourceUrl, intervalMs) {
  const last = await application.store.get(
    'checkout-action-clock',
    'lazada-vn'
  );
  const previous = Date.parse(last?.observedAt);
  const deadline =
    (Number.isFinite(previous) ? previous : Date.now()) + intervalMs;
  while (Date.now() < deadline) {
    await assertCollectionRunning(application.store);
    await assertPageNotChallenged(page);
    if (page.url() !== sourceUrl) {
      throw new Error(
        'Prepared checkout navigated during paced action waiting'
      );
    }
    await page.waitForTimeout(Math.min(1000, deadline - Date.now()));
  }
}

async function applyAction(control, action) {
  if (action.kind === 'quantity') {
    if ((await control.inputValue()) === String(action.line.quantity)) {
      return false;
    }
    await control.fill(String(action.line.quantity));
    await control.press('Tab');
    return true;
  }
  if ((await control.isChecked()) === action.selected) {
    return false;
  }
  if (action.selected) {
    await control.check();
  } else {
    await control.uncheck();
  }
  return true;
}

async function prepareCurrentScenario(application, input) {
  const layout = reviewedActions(input);
  const { plan, scenario } = await selectedScenario(application, input);
  const actions = actionPlan(layout, scenario);
  const page = await requirePreparedCheckoutPage(application);
  const sourceUrl = page.url();
  const intervalMs = Math.max(60000, input.intervalMs || 60000);
  if (!Number.isSafeInteger(intervalMs) || intervalMs > 3600000) {
    throw new Error(
      'Checkout mutation pacing must be between 60 seconds and one hour'
    );
  }
  await waitPreparedCheckoutStable(application, page, { sourceUrl });
  await verifySelectedRows(application, page, layout, scenario, plan);
  // Validate every target control before the first change, avoiding partial
  // preparation because a later binding is unknown or points at submission.
  for (const action of actions) {
    await verifiedControl(page, action);
  }
  const completed = [];
  for (const action of actions) {
    await paceMutation(application, page, sourceUrl, intervalMs);
    await waitPreparedCheckoutStable(application, page, { sourceUrl });
    await verifySelectedRows(application, page, layout, scenario, plan);
    await animateControlIntoView(page, action.selector);
    await waitPreparedCheckoutStable(application, page, { sourceUrl });
    await verifySelectedRows(application, page, layout, scenario, plan);
    const changed = await applyAction(
      await verifiedControl(page, action),
      action
    );
    if (changed) {
      await application.store.put('checkout-action-clock', {
        id: 'lazada-vn',
        observedAt: new Date().toISOString(),
        sourceUrl,
        visibility: 'private',
      });
    }
    await waitPreparedCheckoutStable(application, page, { sourceUrl });
    completed.push({ kind: action.kind, selector: action.selector, changed });
  }
  return {
    planId: plan.id,
    scenarioId: scenario.id,
    sourceUrl,
    layoutId: layout.id,
    completed,
    cartMutations: completed.filter((action) => action.changed).length,
    payments: 0,
    navigation: 0,
    purchases: 0,
    purchaseReady: false,
    acceptanceStatus: 'draft-unexecuted-scenario-preparation',
  };
}

/** Explicit opt-in preparer. It never submits payment or places an order. */
export function prepareLazadaCheckoutScenario(application, input) {
  const collector = application.collector;
  if (!collector?.tail) {
    throw new Error(
      'Scenario preparation needs an already-open browser collector'
    );
  }
  const action = async () => {
    try {
      return await prepareCurrentScenario(application, input);
    } catch (error) {
      if (error.challenge) {
        await stopForChallenge(application.store, error.challenge);
      }
      throw error;
    }
  };
  const pending = collector.tail.then(action, action);
  collector.tail = pending.catch(() => {});
  return pending;
}

/** Bounded planned sweep; prepared capture is checked by existing scenario gates. */
export async function runPreparedLazadaCheckoutScenarios(application, input) {
  const status = await checkoutScenarioStatus(application, {
    planId: input.planId,
  });
  const limit = input.maxScenarios ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(
      'Prepared scenario runner needs an explicit bounded limit between one and 100'
    );
  }
  const wanted =
    input.scenarioIds ||
    status.scenarios
      .filter((row) => row.status !== 'validated')
      .slice(0, limit)
      .map((row) => row.id);
  if (
    !Array.isArray(wanted) ||
    wanted.length > limit ||
    new Set(wanted).size !== wanted.length ||
    wanted.some((id) => !status.scenarios.some((row) => row.id === id))
  ) {
    throw new Error(
      'Prepared scenario IDs must uniquely belong to the existing immutable plan and its bounded limit'
    );
  }
  const results = [];
  for (const scenarioId of wanted) {
    const preparation =
      input.allowCartChanges === true
        ? await prepareLazadaCheckoutScenario(application, {
            ...input,
            scenarioId,
          })
        : { cartMutations: 0, readonly: true };
    const observation = await capturePreparedLazadaCheckout(application, {
      layout: input.layout,
      deliveryArea: status.plan.definition.deliveryArea,
    });
    if (!observation.mapping) {
      results.push({
        scenarioId,
        status: 'needs-review',
        observationId: observation.id,
        gaps: observation.gaps,
        preparation,
      });
      break;
    }
    const capture = await runCheckoutScenarios(application, {
      planId: input.planId,
      captures: [{ scenarioId, mapping: observation.mapping }],
    });
    results.push({
      scenarioId,
      observationId: observation.id,
      capture,
      preparation,
    });
    if (capture.results.some((row) => row.status !== 'validated')) {
      break;
    }
  }
  return {
    ...(await checkoutScenarioStatus(application, { planId: input.planId })),
    results,
    payments: 0,
    purchases: 0,
    acceptanceStatus: 'draft-unexecuted-prepared-sweep',
  };
}
