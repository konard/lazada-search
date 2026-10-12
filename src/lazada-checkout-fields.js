import { parseHTML } from 'linkedom';
import { fold, normalizeText } from './text.js';
import { parsePrice } from './nutrition.js';
import { sha256 } from './util.js';
import { inspectPageChallenge } from './page-challenge.js';

export const LAZADA_CHECKOUT_ADAPTER_VERSION = 'lazada-prepared-checkout-v1';

const labels = {
  destination:
    /^(?:dia chi giao hang|dia chi nhan hang|giao den|delivery address|shipping address|deliver to)$/u,
  shipping:
    /^(?:phi van chuyen|phi giao hang|shipping fee|shipping|delivery fee)$/u,
  total:
    /^(?:tong cong|tong thanh toan|tong tien thanh toan|order total|grand total|total payable)$/u,
  merchandiseSubtotal:
    /^(?:tam tinh|tong tien hang|subtotal|merchandise subtotal)$/u,
  paymentMethod:
    /^(?:phuong thuc thanh toan|hinh thuc thanh toan|payment method|payment)$/u,
  voucherState:
    /^(?:ma giam gia|ma uu dai|voucher|voucher state|applied vouchers)$/u,
  coldChain:
    /^(?:van chuyen dong lanh|giao hang dong lanh|cold chain|frozen delivery)$/u,
};

export function assertLazadaCheckoutMetadata(html, metadata) {
  const bytes = Buffer.isBuffer(html) ? html : Buffer.from(html);
  const url = new URL(metadata.sourceUrl);
  const observed = Date.parse(metadata.observedAt);
  if (
    bytes.length > 20 * 1024 * 1024 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/(?:^|\.)lazada\.vn$/u.test(url.hostname) ||
    !/\/(?:cart|checkout)(?:\/|$)/u.test(url.pathname) ||
    !Number.isFinite(observed) ||
    observed > Date.now() + 60000 ||
    metadata.market !== 'vn' ||
    metadata.currency !== 'VND' ||
    typeof metadata.evidenceId !== 'string' ||
    !metadata.evidenceId ||
    !/^[a-f\d]{64}$/u.test(metadata.sourceSha256 || '') ||
    sha256(bytes) !== metadata.sourceSha256
  ) {
    throw new Error(
      'Checkout adapter needs bounded original Lazada Vietnam HTML, exact digest, evidence ID and real observation time'
    );
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const challenge = inspectPageChallenge({ document, url: url.href });
  return { bytes, document, challenge };
}

export function checkoutNodeVisible(node) {
  for (let current = node; current; current = current.parentElement) {
    if (
      current.hidden ||
      current.getAttribute('aria-hidden') === 'true' ||
      ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(current.tagName) ||
      /\b(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\b/iu.test(
        current.getAttribute('style') || ''
      )
    ) {
      return false;
    }
  }
  return true;
}

export function checkoutField(document, selector, name) {
  if (typeof selector !== 'string' || !selector || selector.length > 1000) {
    throw new Error(`${name} needs an explicit bounded selector`);
  }
  const nodes = document.querySelectorAll(selector);
  if (nodes.length !== 1 || !checkoutNodeVisible(nodes[0])) {
    throw new Error(`${name} must identify exactly one visible original field`);
  }
  const text = normalizeText(nodes[0].textContent);
  if (!text) {
    throw new Error(`${name} original field is empty`);
  }
  return { selector, text };
}

export function checkoutMoney(document, selector, name) {
  const field = checkoutField(document, selector, name);
  if (!/^[\d.,\s]+\s*(?:VND|₫|đ)$/iu.test(field.text)) {
    throw new Error(`${name} needs one explicit unsigned VND amount`);
  }
  const value = parsePrice(field.text);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} amount must be exact non-negative whole VND`);
  }
  return { ...field, value };
}

export function checkoutCount(document, selector, name) {
  const field = checkoutField(document, selector, name);
  if (!/^\d+$/u.test(field.text)) {
    throw new Error(`${name} needs one explicit integer count`);
  }
  const value = Number(field.text);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} count must be exact and non-negative`);
  }
  return { ...field, value };
}

function nodeSelector(node) {
  const path = [];
  for (
    let current = node;
    current?.parentElement;
    current = current.parentElement
  ) {
    const siblings = [...current.parentElement.children];
    path.unshift(
      `${current.tagName.toLowerCase()}:nth-child(${siblings.indexOf(current) + 1})`
    );
  }
  return `html > ${path.join(' > ')}`;
}

// These are observations for layout review. A matching label never grants review.
export function discoverCheckoutLabels(document) {
  const result = Object.fromEntries(
    Object.keys(labels).map((name) => [name, []])
  );
  const nodes = [...document.querySelectorAll('label, dt, span, div, th, td')];
  for (const node of nodes.slice(0, 30000)) {
    if (!checkoutNodeVisible(node) || node.children.length) {
      continue;
    }
    const text = normalizeText(node.textContent);
    const folded = fold(text).replace(/[:：]\s*$/u, '');
    for (const [name, pattern] of Object.entries(labels)) {
      if (!pattern.test(folded)) {
        continue;
      }
      const value = node.nextElementSibling;
      result[name].push({
        label: text,
        labelSelector: nodeSelector(node),
        ...(value && checkoutNodeVisible(value)
          ? {
              value: normalizeText(value.textContent),
              valueSelector: nodeSelector(value),
            }
          : {}),
        requiresLayoutReview: true,
      });
    }
  }
  return result;
}

export function checkoutPointer(value, pointer) {
  if (pointer === '') {
    return value;
  }
  if (
    typeof pointer !== 'string' ||
    !pointer.startsWith('/') ||
    pointer.length > 1000
  ) {
    throw new Error('Embedded-state fields need bounded RFC 6901 pointers');
  }
  return pointer
    .slice(1)
    .split('/')
    .reduce((current, token) => {
      const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~');
      return current && Object.hasOwn(current, key) ? current[key] : undefined;
    }, value);
}

export function checkoutStructuredState(document, binding) {
  if (!binding) {
    return { status: 'not-mapped', rows: [], requiresLayoutReview: true };
  }
  const script = document.querySelectorAll(binding.scriptSelector);
  if (
    script.length !== 1 ||
    script[0].tagName !== 'SCRIPT' ||
    !['application/json', 'application/ld+json'].includes(
      script[0].getAttribute('type')
    ) ||
    script[0].textContent.length > 2 * 1024 * 1024
  ) {
    throw new Error(
      'Embedded checkout state needs one bounded original JSON script'
    );
  }
  const value = JSON.parse(script[0].textContent);
  const rows = checkoutPointer(value, binding.rowsPointer);
  if (!Array.isArray(rows) || rows.length > 100) {
    throw new Error(
      'Embedded state row pointer must identify at most 100 exact rows'
    );
  }
  const fields = binding.fields || {};
  return {
    status: 'mapped-original-json',
    scriptSelector: binding.scriptSelector,
    scriptSha256: sha256(script[0].textContent),
    rows: rows.map((row, index) => ({
      index,
      values: Object.fromEntries(
        Object.entries(fields).map(([key, pointer]) => [
          key,
          checkoutPointer(row, pointer),
        ])
      ),
    })),
    originalValidated: false,
    requiresVisibleFieldAgreement: true,
  };
}

export function checkoutDialogs(document) {
  return [
    ...document.querySelectorAll(
      'dialog[open], [role="dialog"], [aria-modal="true"], .next-dialog, .ant-modal, .medical-disclaimer-modal'
    ),
  ]
    .filter(checkoutNodeVisible)
    .map((node) => ({
      text: normalizeText(node.textContent).slice(0, 1000),
      requiresResolution: true,
    }));
}
