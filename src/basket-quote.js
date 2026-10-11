import { parseHTML } from 'linkedom';
import { normalizeText, fold } from './text.js';
import { parsePrice } from './nutrition.js';
import { sha256 } from './util.js';
import { positive } from './values.js';
import {
  assertPageNotChallenged,
  assertCollectionRunning,
  stopForChallenge,
} from './page-challenge.js';
import { resolvePageDialogs } from './page-dialogs.js';
import { waitForPageReady } from './page-readiness.js';
import { deliveryAreaForDestination } from './delivery-context.js';

const observedTime = (value) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now() + 60000) {
    throw new Error('Basket quote requires its original observation time');
  }
  return new Date(time).toISOString();
};

function basketSourceUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/(?:^|\.)lazada\.vn$/u.test(url.hostname) ||
    !/\/(?:cart|checkout)(?:\/|$)/u.test(url.pathname)
  ) {
    throw new Error(
      'A basket quote requires a credential-free HTTPS Lazada Vietnam cart or checkout source'
    );
  }
  return url;
}

export function basketIdentity(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) {
    throw new Error('Basket needs between one and 100 exact selected lines');
  }
  const identities = lines
    .map(({ offerId, sku, quantity }) => {
      if (
        typeof offerId !== 'string' ||
        !offerId ||
        !/^\d+_VNAMZ-\d+$/u.test(sku)
      ) {
        throw new Error(
          'Basket lines require exact offer and selected SKU identities'
        );
      }
      return [offerId, sku, positive(quantity, 'quantity', { integer: true })];
    })
    .sort(([left], [right]) => left.localeCompare(right));
  if (new Set(identities.map(([id]) => id)).size !== identities.length) {
    throw new Error('Repeated basket lines must be combined before quoting');
  }
  return sha256(JSON.stringify(identities));
}

function sourceText(document, selector) {
  if (typeof selector !== 'string' || !selector || selector.length > 1000) {
    throw new Error('Every basket field requires an explicit source selector');
  }
  const nodes = document.querySelectorAll(selector);
  if (nodes.length !== 1) {
    throw new Error('Basket source selector must identify exactly one field');
  }
  const node = nodes[0];
  if (
    node.closest(
      '[hidden], [aria-hidden="true"], script, style, template, noscript'
    )
  ) {
    throw new Error('Hidden controls cannot confirm a basket amount');
  }
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    if (
      /\b(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b/iu.test(
        ancestor.getAttribute('style') || ''
      )
    ) {
      throw new Error('Hidden controls cannot confirm a basket amount');
    }
  }
  return normalizeText(node.textContent);
}

function money(document, selector) {
  const text = sourceText(document, selector);
  if (!/^[\d.,\s]+\s*(?:VND|₫|đ)$/iu.test(text)) {
    throw new Error('Basket money field must contain one explicit VND amount');
  }
  const value = parsePrice(text);
  return positive(value, 'basket amount', { zero: true });
}

function sourceLine(document, line) {
  const sku = sourceText(document, line.selectors.sku);
  const quantityText = sourceText(document, line.selectors.quantity);
  if (
    sku !== line.sku ||
    !/^\d+$/u.test(quantityText) ||
    Number(quantityText) !== line.quantity
  ) {
    throw new Error(
      'Basket selected SKU or quantity does not match its source'
    );
  }
  const unitPrice = money(document, line.selectors.unitPrice);
  const subtotal = money(document, line.selectors.subtotal);
  if (unitPrice * line.quantity !== subtotal) {
    throw new Error(
      'Basket line subtotal disagrees with its selected unit price'
    );
  }
  return {
    offerId: line.offerId,
    sku,
    quantity: line.quantity,
    unitPrice,
    subtotal,
  };
}

function sourceDiscounts(document, input) {
  const appliedDiscounts = (input.appliedDiscounts || []).map((discount) => {
    if (
      !discount.id ||
      !['merchandise', 'shipping'].includes(discount.scope) ||
      !discount.selector
    ) {
      throw new Error('Applied discounts require source identity and scope');
    }
    if (
      discount.identitySelector &&
      sourceText(document, discount.identitySelector) !== discount.id
    ) {
      throw new Error('Applied voucher identity does not match its source');
    }
    return {
      id: discount.id,
      scope: discount.scope,
      amount: money(document, discount.selector),
      eligibility: 'applied-in-captured-basket',
      ...(discount.identitySelector
        ? { identityValidation: 'source-text' }
        : {}),
    };
  });
  if (
    new Set(appliedDiscounts.map(({ id }) => id)).size !==
      appliedDiscounts.length ||
    new Set(
      (input.appliedDiscounts || []).map(({ selector }) =>
        document.querySelector(selector)
      )
    ).size !== appliedDiscounts.length
  ) {
    throw new Error('The same applied voucher cannot reduce a basket twice');
  }
  return appliedDiscounts;
}

function sourceConditions(document, input) {
  if (!input.checkoutConditions) {
    return {};
  }
  const observed = {};
  for (const field of ['paymentMethod', 'voucherState']) {
    const condition = input.checkoutConditions[field];
    if (!condition?.text) {
      throw new Error(
        'Checkout conditions require explicit observed source text'
      );
    }
    const actual = sourceText(document, condition.selector);
    if (actual !== normalizeText(condition.text)) {
      throw new Error('Checkout condition does not match its original source');
    }
    observed[field] = actual;
  }
  return { checkoutConditions: observed };
}

function sourceColdChain(document, input) {
  // Cold-chain service is a separate, explicit reviewed source statement.
  const coldChain = fold(input.coldChainText || '');
  const coldChainConfirmed = Boolean(
    input.coldChainText &&
    input.selectors.coldChain &&
    /cold chain|frozen delivery|giao hang dong lanh|van chuyen dong lanh/u.test(
      coldChain
    ) &&
    /\b(?:supported|confirmed|available|yes|co|ho tro|xac nhan)\b/u.test(
      coldChain
    ) &&
    !/\b(?:no|not|without|never|cannot|unavailable|unsupported|khong|chua)\b|\b(?:can|won|isn|aren|doesn|don|willn|wasn|weren|couldn|wouldn|shouldn)['’]?t\b/u.test(
      coldChain
    ) &&
    sourceText(document, input.selectors.coldChain) ===
      normalizeText(input.coldChainText)
  );
  return coldChainConfirmed;
}

// A reviewed selector mapping identifies actual checkout fields. It is not a
// claim that an arbitrary product-page quantity picker quotes bulk freight.
export function extractBasketQuote(html, input) {
  basketIdentity(input.lines);
  const bytes = Buffer.isBuffer(html) ? html : Buffer.from(html);
  if (sha256(bytes) !== input.sourceSha256) {
    throw new Error('Basket original HTML digest mismatch');
  }
  basketSourceUrl(input.sourceUrl);
  if (
    input.market !== 'vn' ||
    input.currency !== 'VND' ||
    !input.deliveryArea
  ) {
    throw new Error('Basket market, currency and destination must be explicit');
  }
  if (!input.mappingReviewedBy || !input.evidenceId || !input.selectors) {
    throw new Error(
      'Basket source mapping needs a reviewer and original evidence'
    );
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const selectors = input.selectors;
  const destination = sourceText(document, selectors.destination);
  if (destination !== normalizeText(input.destination)) {
    throw new Error(
      'Basket quote destination does not match its original source'
    );
  }
  if (
    fold(deliveryAreaForDestination(destination)) !== fold(input.deliveryArea)
  ) {
    throw new Error(
      'Basket comparison area disagrees with the captured destination'
    );
  }
  const lines = input.lines.map((line) => sourceLine(document, line));
  const identity = basketIdentity(lines);
  const shipping = money(document, selectors.shipping);
  const appliedDiscounts = sourceDiscounts(document, input);
  const merchandiseSubtotal = lines.reduce(
    (sum, line) => sum + line.subtotal,
    0
  );
  const discount = appliedDiscounts.reduce((sum, item) => sum + item.amount, 0);
  for (const [scope, subtotal] of [
    ['merchandise', merchandiseSubtotal],
    ['shipping', shipping],
  ]) {
    if (
      appliedDiscounts
        .filter((item) => item.scope === scope)
        .reduce((sum, item) => sum + item.amount, 0) > subtotal
    ) {
      throw new Error(
        `Applied ${scope} discounts exceed their captured subtotal`
      );
    }
  }
  const total = money(document, selectors.total);
  if (
    discount > merchandiseSubtotal + shipping ||
    total !== merchandiseSubtotal + shipping - discount
  ) {
    throw new Error(
      'Basket checkout total does not reconcile with its captured lines, shipping and applied discounts'
    );
  }
  const coldChainConfirmed = sourceColdChain(document, input);
  const observedAt = observedTime(input.observedAt);
  return {
    id: `basket-quote:${sha256(JSON.stringify([identity, input.sourceSha256, observedAt]))}`,
    basketIdentity: identity,
    market: 'vn',
    currency: 'VND',
    deliveryArea: input.deliveryArea,
    shippingDestination: destination,
    shipping,
    merchandiseSubtotal,
    discount,
    total,
    lines,
    appliedDiscounts,
    coldChainConfirmed,
    observedAt,
    evidenceId: input.evidenceId,
    sourceUrl: input.sourceUrl,
    sourceSha256: input.sourceSha256,
    sourceValidation: 'exact-checkout-fields',
    mappingReviewedBy: input.mappingReviewedBy,
    sourceMapping: input,
    ...sourceConditions(document, input),
  };
}

export async function saveBasketQuote(application, input) {
  const evidence = await application.store.get('evidence', input.evidenceId);
  if (
    !evidence?.html ||
    evidence.invalidatedAt ||
    evidence.html.sha256 !== input.sourceSha256 ||
    (application.store.visibility === 'public' &&
      evidence.visibility === 'private')
  ) {
    throw new Error(
      'Basket quote needs accessible non-invalidated original HTML evidence'
    );
  }
  if (
    evidence.sourceUrl !== input.sourceUrl ||
    evidence.observedAt !== observedTime(input.observedAt)
  ) {
    throw new Error(
      'Basket URL and observation date must match original evidence'
    );
  }
  const invalidation = await application.store.get(
    'invalidation',
    input.sourceUrl
  );
  if (
    invalidation &&
    Date.parse(invalidation.invalidatedAt) >= Date.parse(input.observedAt)
  ) {
    throw new Error(
      'Invalidated basket source needs a new captured observation'
    );
  }
  const quote = extractBasketQuote(
    await application.store.blob(input.sourceSha256),
    input
  );
  for (const line of quote.lines) {
    const offer = await application.store.get('offer', line.offerId);
    if (!offer || offer.sku !== line.sku || offer.currency !== quote.currency) {
      throw new Error(
        'Basket line must identify an existing exact selected offer'
      );
    }
  }
  return application.store.put('basket-quote', quote);
}

async function readCurrentFields(page, input, sourceUrl) {
  for (const selector of [
    ...Object.values(input.selectors || {}),
    ...(input.lines || []).flatMap((line) =>
      Object.values(line.selectors || {})
    ),
    ...(input.appliedDiscounts || []).map((item) => item.selector),
    ...(input.appliedDiscounts || [])
      .map((item) => item.identitySelector)
      .filter(Boolean),
    ...Object.values(input.checkoutConditions || {}).map(
      (condition) => condition.selector
    ),
  ]) {
    if (!(await page.locator(selector).isVisible())) {
      throw new Error(
        'Every quoted checkout field must be visible before capture'
      );
    }
  }
  const html = Buffer.from(await page.content());
  if (page.url() !== sourceUrl) {
    throw new Error('Checkout URL changed during source capture');
  }
  const observedAt = new Date().toISOString();
  const sourceSha256 = sha256(html);
  const evidenceId = `basket-evidence:${sha256(JSON.stringify([sourceSha256, observedAt]))}`;
  const mapping = { ...input, sourceUrl, sourceSha256, observedAt, evidenceId };
  const quote = extractBasketQuote(html, mapping);
  const fingerprint = JSON.stringify([
    quote.shippingDestination,
    quote.lines,
    quote.shipping,
    quote.appliedDiscounts,
    quote.total,
    quote.coldChainConfirmed,
  ]);
  return { html, mapping, fingerprint };
}

// Read only the current, already prepared cart/checkout. No cart mutation,
// navigation, payment or purchase is performed by this capture operation.
async function captureCurrentBasket(application, input) {
  if (application.store.visibility !== 'private') {
    throw new Error(
      'Account checkout capture requires a private account store'
    );
  }
  const collector = application.collector;
  await assertCollectionRunning(application.store);
  await collector.start();
  await collector.runtime?.touch?.();
  const page = collector.runtime.page;
  await resolvePageDialogs(page);
  await assertPageNotChallenged(page);
  await waitForPageReady(page);
  const sourceUrl = page.url();
  basketSourceUrl(sourceUrl);
  if (application.market !== 'vn') {
    throw new Error(
      'Basket capture is only implemented for the Vietnam market'
    );
  }
  const deadline = Date.now() + 30000;
  let previous, stableSince, captured;
  for (let attempt = 0; attempt < 61; attempt++) {
    await assertCollectionRunning(application.store);
    await resolvePageDialogs(page);
    await assertPageNotChallenged(page);
    if (page.url() !== sourceUrl) {
      throw new Error('Checkout URL changed during source capture');
    }
    const current = await readCurrentFields(page, input, sourceUrl);
    if (current.fingerprint === previous && Date.now() - stableSince >= 1000) {
      captured = current;
      break;
    }
    if (current.fingerprint !== previous) {
      stableSince = Date.now();
    }
    previous = current.fingerprint;
    if (Date.now() >= deadline) {
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!captured) {
    throw new Error('Checkout totals did not settle before capture');
  }
  await assertCollectionRunning(application.store);
  await assertPageNotChallenged(page);
  if (page.url() !== sourceUrl) {
    throw new Error('Checkout URL changed during source capture');
  }
  const { html, mapping } = captured;
  const source = await application.store.putBlob(html);
  const { evidenceId } = mapping;
  await application.store.put('evidence', {
    id: evidenceId,
    sourceUrl,
    observedAt: mapping.observedAt,
    html: source,
    role: 'checkout',
    visibility: 'private',
  });
  return saveBasketQuote(application, mapping);
}

export function captureBasketQuote(application, input) {
  const collector = application.collector;
  const action = async () => {
    try {
      return await captureCurrentBasket(application, input);
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
