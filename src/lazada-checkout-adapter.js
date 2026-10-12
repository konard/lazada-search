import { extractBasketQuote, saveBasketQuote } from './basket-quote.js';
import { sha256, clone } from './util.js';
import { fold } from './text.js';
import {
  LAZADA_CHECKOUT_ADAPTER_VERSION,
  assertLazadaCheckoutMetadata,
  checkoutField,
  checkoutCount,
  checkoutMoney,
  discoverCheckoutLabels,
  checkoutStructuredState,
  checkoutDialogs,
  checkoutPointer,
} from './lazada-checkout-fields.js';
import {
  extractCheckoutLineBinding,
  extractCheckoutQuantityBinding,
} from './lazada-checkout-line-bindings.js';

function issue(gaps, field, error) {
  gaps.push({
    field,
    reason: error.message || String(error),
    status: 'unresolved',
  });
}

function readOrGap(gaps, field, operation) {
  try {
    return operation();
  } catch (error) {
    issue(gaps, field, error);
    return undefined;
  }
}

function reviewLayout(layout) {
  if (
    layout?.reviewed !== true ||
    typeof layout.id !== 'string' ||
    !layout.id.trim() ||
    typeof layout.reviewedBy !== 'string' ||
    !layout.reviewedBy.trim() ||
    !Number.isFinite(Date.parse(layout.reviewedAt)) ||
    Date.parse(layout.reviewedAt) > Date.now() + 60000
  ) {
    throw new Error(
      'A candidate needs an explicit reviewed layout ID, reviewer and real review time before quote extraction'
    );
  }
}

function exactOffer(offers, sku, offerId) {
  const matches = offers.filter(
    (offer) => offer.sku === sku && (!offerId || offer.id === offerId)
  );
  if (
    matches.length !== 1 ||
    matches[0].currency !== 'VND' ||
    matches[0].available === false ||
    matches[0].priceInvalidated ||
    matches[0].variantConfirmed !== true
  ) {
    throw new Error(
      'Checkout row needs one existing available non-invalidated exact selected VND offer'
    );
  }
  return matches[0];
}

function observedSku(document, line) {
  const identity = extractCheckoutLineBinding(document, line);
  const sku =
    identity?.sku ||
    checkoutField(document, line.selectors?.sku, 'selected SKU').text;
  if (!/^\d+_VNAMZ-\d+$/u.test(sku)) {
    throw new Error(
      'A checkout row must identify its exact numeric item and selected SKU'
    );
  }
  const quantity =
    extractCheckoutQuantityBinding(document, line, identity) ??
    checkoutCount(document, line.selectors?.quantity, 'selected quantity')
      .value;
  if (!(quantity > 0)) {
    throw new Error('Selected checkout quantity must be positive');
  }
  return { sku, quantity, identity };
}

function stateValue(identity, binding, name) {
  if (binding?.kind !== 'embedded-json' || identity?.kind !== 'embedded-json') {
    throw new Error(
      `${name} state proof must come from the exact original identity-bound selected JSON row`
    );
  }
  return checkoutPointer(identity.value, binding.pointer);
}

function lineAvailability(document, line, quantity, identity) {
  if (
    line.stockBinding ||
    line.availabilityBinding ||
    line.eligibilityBinding
  ) {
    const stock = stateValue(identity, line.stockBinding, 'stock');
    const available = stateValue(
      identity,
      line.availabilityBinding,
      'availability'
    );
    const eligibleQuantity = stateValue(
      identity,
      line.eligibilityBinding,
      'eligible quantity'
    );
    if (
      !Number.isSafeInteger(stock) ||
      stock < quantity ||
      available !== true ||
      eligibleQuantity !== quantity
    ) {
      throw new Error(
        'Original selected JSON row must confirm exact stock, availability and the same allowed order quantity'
      );
    }
    return {
      stock: { value: stock, source: 'identity-bound-original-json' },
      availability: { value: true },
      eligibility: { value: eligibleQuantity },
    };
  }
  const stock = checkoutCount(
    document,
    line.selectors?.stock,
    'original stock count'
  );
  const availability = checkoutField(
    document,
    line.selectors?.availability,
    'original availability'
  );
  const eligibility = checkoutField(
    document,
    line.selectors?.eligibility,
    'original quantity eligibility'
  );
  if (
    !/^(?:in stock|available|con hang|co san)$/u.test(
      fold(availability.text)
    ) ||
    stock.value < quantity
  ) {
    throw new Error(
      'Selected checkout quantity exceeds exact observed available stock or availability is unconfirmed'
    );
  }
  if (
    !/^(?:eligible|order allowed|quantity available|quantity valid|du dieu kien|so luong hop le|so luong co san)$/u.test(
      fold(eligibility.text)
    )
  ) {
    throw new Error(
      'Prepared checkout must explicitly confirm eligibility for its selected order quantity'
    );
  }
  return { stock, availability, eligibility };
}

function selectedLine(document, line, offers, stateRows, gaps, index) {
  const selected = readOrGap(gaps, `lines.${index}.identity`, () =>
    observedSku(document, line)
  );
  if (!selected) {
    return undefined;
  }
  const offer = readOrGap(gaps, `lines.${index}.offer`, () =>
    exactOffer(offers, selected.sku, line.offerId)
  );
  const quantities = readOrGap(gaps, `lines.${index}.availability`, () =>
    lineAvailability(document, line, selected.quantity, selected.identity)
  );
  const unitPrice = readOrGap(gaps, `lines.${index}.unitPrice`, () =>
    checkoutMoney(document, line.selectors?.unitPrice, 'selected unit price')
  );
  const subtotal = readOrGap(gaps, `lines.${index}.subtotal`, () =>
    checkoutMoney(document, line.selectors?.subtotal, 'selected line subtotal')
  );
  if (
    unitPrice &&
    subtotal &&
    unitPrice.value * selected.quantity !== subtotal.value
  ) {
    issue(
      gaps,
      `lines.${index}.subtotal`,
      new Error('Line price, quantity and subtotal do not reconcile')
    );
  }
  compareStateRow(selected, stateRows, gaps, index);
  return {
    ...clone(line),
    sku: selected.sku,
    quantity: selected.quantity,
    offerId: offer?.id || null,
    observations: { quantities, unitPrice, subtotal },
  };
}

function compareStateRow(selected, rows, gaps, index) {
  if (!rows.length) {
    return;
  }
  const matching = rows.filter((row) => row.values.sku === selected.sku);
  if (matching.length !== 1) {
    issue(
      gaps,
      `lines.${index}.state`,
      new Error(
        'Reviewed state mapping does not uniquely identify the same original selected SKU'
      )
    );
    return;
  }
  if (
    matching[0].values.quantity !== selected.quantity ||
    matching[0].values.selected !== true
  ) {
    issue(
      gaps,
      `lines.${index}.state`,
      new Error(
        'Original embedded quantity or selected state contradicts its visible checkout row'
      )
    );
  }
}

function checkoutConditions(document, layout, gaps) {
  const result = {};
  for (const field of ['paymentMethod', 'voucherState']) {
    const observed = readOrGap(gaps, field, () =>
      checkoutField(document, layout.selectors?.[field], field)
    );
    if (observed) {
      result[field] = { selector: observed.selector, text: observed.text };
    }
  }
  if (
    result.paymentMethod &&
    /select|choose|lua chon|chon phuong thuc/u.test(
      fold(result.paymentMethod.text)
    )
  ) {
    issue(
      gaps,
      'paymentMethod',
      new Error('A payment prompt does not identify a selected payment method')
    );
  }
  return result;
}

function candidateMapping(metadata, layout, lines, conditions, document, gaps) {
  const destination = readOrGap(gaps, 'destination', () =>
    checkoutField(
      document,
      layout.selectors?.destination,
      'delivery destination'
    )
  );
  const shipping = readOrGap(gaps, 'shipping', () =>
    checkoutMoney(document, layout.selectors?.shipping, 'original shipping fee')
  );
  const total = readOrGap(gaps, 'total', () =>
    checkoutMoney(document, layout.selectors?.total, 'original payable total')
  );
  if (!metadata.deliveryArea) {
    issue(
      gaps,
      'deliveryArea',
      new Error('Comparison delivery area must be explicit')
    );
  }
  const selectors = {
    destination: destination?.selector,
    shipping: shipping?.selector,
    total: total?.selector,
  };
  let coldChainText;
  if (layout.selectors?.coldChain) {
    const cold = readOrGap(gaps, 'coldChain', () =>
      checkoutField(document, layout.selectors.coldChain, 'cold-chain service')
    );
    if (cold) {
      selectors.coldChain = cold.selector;
      coldChainText = cold.text;
    }
  }
  return {
    ...metadata,
    mappingReviewedBy: layout.reviewedBy,
    destination: destination?.text,
    selectors,
    lines: lines.filter(Boolean).map((line) => {
      const mapped = clone(line);
      delete mapped.observations;
      return mapped;
    }),
    appliedDiscounts: clone(layout.appliedDiscounts || []),
    checkoutConditions: conditions,
    ...(coldChainText ? { coldChainText } : {}),
  };
}

/** Pure draft extraction. Unreviewed discovery never becomes an accepted quote. */
export function discoverLazadaCheckoutSnapshot(
  html,
  metadata,
  { layout = {}, offers = [] } = {}
) {
  const { document, challenge } = assertLazadaCheckoutMetadata(html, metadata);
  const gaps = [];
  if (challenge.detected) {
    issue(
      gaps,
      'challenge',
      new Error(`Source is challenged: ${challenge.signals.join(', ')}`)
    );
  }
  const dialogs = checkoutDialogs(document);
  if (dialogs.length) {
    issue(
      gaps,
      'dialogs',
      new Error('Resolve every original page dialog before source extraction')
    );
  }
  readOrGap(gaps, 'layoutReview', () => reviewLayout(layout));
  const structuredState = readOrGap(gaps, 'structuredState', () =>
    checkoutStructuredState(document, layout.state)
  );
  const rows = layout.lines || [];
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    issue(
      gaps,
      'lines',
      new Error(
        'A reviewed prepared checkout needs between one and 100 exact selected row mappings'
      )
    );
  }
  const lines = (Array.isArray(rows) ? rows.slice(0, 100) : []).map(
    (line, index) =>
      selectedLine(
        document,
        line,
        offers,
        structuredState?.rows || [],
        gaps,
        index
      )
  );
  const conditions = checkoutConditions(document, layout, gaps);
  const mapping = candidateMapping(
    metadata,
    layout,
    lines,
    conditions,
    document,
    gaps
  );
  if (
    mapping.appliedDiscounts.some(
      (discount) => !discount.id || !discount.identitySelector
    )
  ) {
    issue(
      gaps,
      'appliedDiscounts',
      new Error(
        'Every applied checkout discount requires its exact original visible voucher identity as well as amount and scope'
      )
    );
  }
  const quote = gaps.length
    ? undefined
    : readOrGap(gaps, 'basketReconciliation', () =>
        extractBasketQuote(html, mapping)
      );
  return {
    version: LAZADA_CHECKOUT_ADAPTER_VERSION,
    status: quote ? 'mapping-ready' : 'needs-review',
    source: clone(metadata),
    layoutId: layout.id || null,
    labelCandidates: discoverCheckoutLabels(document),
    structuredState: structuredState || null,
    dialogs,
    challenge,
    lines,
    candidateMapping: mapping,
    mapping: quote ? mapping : null,
    quote: quote || null,
    gaps,
    checkoutLayoutLiveVerified: false,
    purchaseReady: false,
    downloads: 0,
    cartMutations: 0,
    payments: 0,
  };
}

async function matchingOriginal(application, input) {
  if (application.store.visibility !== 'private') {
    throw new Error(
      'Account checkout originals and mappings must remain in a private store'
    );
  }
  const { bytes } = assertLazadaCheckoutMetadata(input.html, input.metadata);
  const previous = await application.store.get(
    'evidence',
    input.metadata.evidenceId
  );
  if (
    previous &&
    (previous.sourceUrl !== input.metadata.sourceUrl ||
      previous.observedAt !== input.metadata.observedAt ||
      previous.html?.sha256 !== input.metadata.sourceSha256 ||
      previous.invalidated ||
      previous.invalidatedAt)
  ) {
    throw new Error(
      'A checkout evidence ID cannot replace another original or an invalidated observation'
    );
  }
  if (!previous) {
    const html = await application.store.putBlob(bytes);
    await application.store.put('evidence', {
      id: input.metadata.evidenceId,
      sourceUrl: input.metadata.sourceUrl,
      observedAt: input.metadata.observedAt,
      html,
      role: 'checkout',
      visibility: 'private',
    });
  }
}

/** Save originals and explicit unresolved gaps before any accepted basket mapping. */
export async function importLazadaCheckoutSnapshot(application, input) {
  const offers = await application.store.list('offer');
  const result = discoverLazadaCheckoutSnapshot(input.html, input.metadata, {
    layout: input.layout,
    offers,
  });
  await matchingOriginal(application, input);
  const id = `checkout-adapter:${sha256(JSON.stringify([result.version, input.metadata.sourceSha256, input.metadata.observedAt, input.layout || {}]))}`;
  const observation = await application.store.put('checkout-adapter', {
    id,
    ...result,
    observedAt: input.metadata.observedAt,
    visibility: 'private',
    extractedAt: new Date().toISOString(),
    acceptanceStatus: 'draft-unexecuted-layout-adapter',
  });
  if (!result.mapping) {
    return observation;
  }
  const quote = await saveBasketQuote(application, result.mapping);
  return application.store.put('checkout-adapter', {
    ...observation,
    quoteId: quote.id,
  });
}

export async function lazadaCheckoutAdapterStatus(
  application,
  { observationId } = {}
) {
  const stored = observationId
    ? [await application.store.get('checkout-adapter', observationId)].filter(
        Boolean
      )
    : await application.store.list('checkout-adapter');
  const rows = [];
  const invalidations = await application.store.list('invalidation');
  for (const row of stored) {
    if (!row.mapping) {
      rows.push(row);
      continue;
    }
    const mapping = row.mapping;
    const evidence = await application.store.get(
      'evidence',
      mapping.evidenceId
    );
    const original =
      evidence?.html && (await application.store.blob(evidence.html.sha256));
    const invalidated = invalidations.some(
      (record) =>
        (record.url === mapping.sourceUrl ||
          record.evidenceIds?.includes(mapping.evidenceId)) &&
        (record.invalidated ||
          !Number.isFinite(Date.parse(record.invalidatedAt)) ||
          Date.parse(record.invalidatedAt) >= Date.parse(mapping.observedAt))
    );
    if (
      !original ||
      sha256(original) !== mapping.sourceSha256 ||
      evidence?.html?.sha256 !== mapping.sourceSha256 ||
      evidence.sourceUrl !== mapping.sourceUrl ||
      evidence.observedAt !== mapping.observedAt ||
      evidence.invalidated ||
      evidence.invalidatedAt ||
      invalidated
    ) {
      rows.push({
        ...row,
        status: 'needs-review',
        mapping: null,
        quote: null,
        gaps: [
          ...row.gaps,
          {
            field: 'originalEvidence',
            status: 'unresolved',
            reason:
              'Stored original checkout is missing, changed or invalidated; recollect before reuse',
          },
        ],
      });
      continue;
    }
    try {
      extractBasketQuote(original, mapping);
      rows.push(row);
    } catch (error) {
      rows.push({
        ...row,
        status: 'needs-review',
        mapping: null,
        quote: null,
        gaps: [
          ...row.gaps,
          {
            field: 'mappingReplay',
            status: 'unresolved',
            reason: error.message,
          },
        ],
      });
    }
  }
  return {
    observations: rows,
    counts: {
      observed: rows.length,
      mappingReady: rows.filter((row) => row.status === 'mapping-ready').length,
      unresolved: rows.filter((row) => row.status !== 'mapping-ready').length,
    },
    checkoutLayoutLiveVerified: false,
    allMarketScenariosCollected: false,
    purchaseReady: false,
  };
}
