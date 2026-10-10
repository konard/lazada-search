// Voucher and campaign parsing shared by the promotion collector, its report
// and tests. Every function is pure, so saved HTML and API responses can be
// re-parsed offline after a pattern fix.

const MULTIPLIERS = {
  k: 1e3,
  n: 1e3,
  nghìn: 1e3,
  ngàn: 1e3,
  tr: 1e6,
  triệu: 1e6,
  m: 1e6,
};

// "50K", "₫50.000", "50,000₫", "1TR", "1,5 triệu" -> VND integers.
export function parseVndAmount(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const match = text
    .replace(/\s+/gu, ' ')
    .match(/(\d+(?:[.,]\d+)*)\s*(k|n|nghìn|ngàn|tr|triệu|m)?(?![a-zà-ỹ])/iu);
  if (!match) {
    return null;
  }
  const unit = match[2]?.toLowerCase();
  let digits = match[1];
  if (unit) {
    // With a unit, a single separator is a decimal mark: "1,5tr".
    digits = /^\d+[.,]\d{1,2}$/u.test(digits)
      ? digits.replace(',', '.')
      : digits.replace(/[.,]/gu, '');
    return Math.round(Number(digits) * MULTIPLIERS[unit]);
  }
  const value = Number(digits.replace(/[.,]/gu, ''));
  return Number.isFinite(value) ? value : null;
}

const AMOUNT = String.raw`(?:₫|đ|vnd)?\s*\d+(?:[.,]\d+)*\s*(?:k|n|nghìn|ngàn|tr|triệu|m)?\s*(?:₫|đ|vnd)?`;
const PATTERNS = {
  percent:
    /(?:giảm|off|discount|voucher)\s*(\d{1,2}(?:[.,]\d+)?)\s*%|(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:off|giảm)/iu,
  fixed: new RegExp(
    String.raw`(?:giảm(?: giá)?|off|discount|voucher(?: lazada)?)\s*(${AMOUNT})(?![\d.,]*\s*%)|(${AMOUNT})\s*off`,
    'iu'
  ),
  cap: new RegExp(
    String.raw`(?:tối đa|giảm tối đa|max(?:imum)?|capped at|cap|up to)\s*:?\s*(${AMOUNT})(?![\d.,]*\s*%)`,
    'iu'
  ),
  minSpend: new RegExp(
    String.raw`(?:đơn(?: hàng)?(?: tối thiểu| từ| trên)?|tối thiểu|min\.?(?:imum)?(?: spend| order)?|cho đơn từ)\s*:?\s*(${AMOUNT})(?![\d.,]*\s*%)`,
    'iu'
  ),
  date: /(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:\s*(\d{1,2}):(\d{2}))?/u,
  validity:
    /(?:hsd|hạn sử dụng|hết hạn|có hiệu lực(?: đến)?|valid(?: until| till)?|expires?|đến ngày|until)\s*:?\s*([^\n]{3,40})/iu,
  range:
    /(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s+\d{1,2}:\d{2})\s*[~–]\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s+\d{1,2}:\d{2})/u,
  usage: /(?:đã dùng|đã sử dụng|used|claimed)\s*:?\s*(\d{1,3})\s*%/iu,
};

const SCOPES = [
  [
    'freeship',
    /freeship|free ?ship|miễn phí vận chuyển|phí vận chuyển|free shipping/iu,
  ],
  ['lazmall', /lazmall/iu],
  ['lazglobal', /lazglobal|quốc tế/iu],
  [
    'payment',
    /thẻ|ngân hàng|bank|momo|zalopay|vnpay|shopeepay|lazcard|vib|uob|tpbank|vpbank|visa|mastercard|trả góp|thanh toán/iu,
  ],
  ['new-user', /khách hàng mới|người dùng mới|new user|bạn mới|lần đầu/iu],
  [
    'shop',
    /voucher của shop|shop voucher|mã của shop|cửa hàng|store voucher/iu,
  ],
  ['coins', /lazcoin|xu\b|coins?\b/iu],
  ['app-only', /chỉ trên app|app only|trên ứng dụng|trên app/iu],
  ['platform', /toàn sàn|platform|lazada voucher|mã lazada/iu],
];

export function voucherScopes(text) {
  return SCOPES.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name
  );
}

function amountAt(match) {
  const text = match?.slice(1).find(Boolean);
  return text ? parseVndAmount(text) : null;
}

// Year-less dates take the observation year; a resulting date more than
// half a year in the past belongs to the next year.
export function parseVoucherDate(text, observedAt = new Date()) {
  const match = typeof text === 'string' && text.match(PATTERNS.date);
  if (!match) {
    return null;
  }
  const [, day, month, rawYear, hour = '23', minute = '59'] = match;
  const base = new Date(observedAt);
  let year = rawYear
    ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
    : base.getUTCFullYear();
  const make = () =>
    // Lazada Vietnam publishes local (UTC+7) times.
    new Date(
      Date.UTC(
        year,
        Number(month) - 1,
        Number(day),
        Number(hour) - 7,
        Number(minute)
      )
    );
  let date = make();
  if (!rawYear && date.getTime() < base.getTime() - 182 * 864e5) {
    year += 1;
    date = make();
  }
  if (Number(month) > 12 || Number(day) > 31 || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

// "01/10 00:00 ~ 31/10 23:59" ranges, or a single "HSD: 12.10" expiry.
function voucherValidity(clean, observedAt) {
  const range = clean.match(PATTERNS.range);
  if (range) {
    return {
      validFrom: parseVoucherDate(range[1], observedAt),
      validUntil: parseVoucherDate(range[2], observedAt),
      validityText: range[0],
    };
  }
  const validity = clean.match(PATTERNS.validity);
  return {
    validFrom: null,
    validUntil: validity ? parseVoucherDate(validity[1], observedAt) : null,
    validityText: validity ? validity[1].trim() : null,
  };
}

export function parseVoucherText(text, { observedAt } = {}) {
  const clean = String(text || '')
    .replace(/[\u00a0\u202f]/gu, ' ')
    .replace(/[ \t]+/gu, ' ')
    .trim();
  const percent = clean.match(PATTERNS.percent);
  const usage = clean.match(PATTERNS.usage);
  const voucher = {
    text: clean,
    discountPercent: percent
      ? Number((percent[1] || percent[2]).replace(',', '.'))
      : null,
    discountAmount: percent ? null : amountAt(clean.match(PATTERNS.fixed)),
    maxDiscount: amountAt(clean.match(PATTERNS.cap)),
    minSpend: amountAt(clean.match(PATTERNS.minSpend)),
    ...voucherValidity(clean, observedAt),
    usedPercent: usage ? Number(usage[1]) : null,
    scopes: voucherScopes(clean),
    codes: extractCodeCandidates(clean),
  };
  voucher.isVoucher = Boolean(
    voucher.discountPercent ||
    voucher.discountAmount ||
    (voucher.scopes.includes('freeship') && voucher.minSpend !== null)
  );
  return voucher;
}

// Typed checkout codes look like "LAZ50K" or "VUI12": upper-case letters
// with at least one digit or a "code/mã" label. Common words and currency
// markers are excluded.
const NOT_CODES = new Set([
  'VND',
  'LAZADA',
  'LAZMALL',
  'LAZGLOBAL',
  'FREESHIP',
  'HSD',
  'COD',
  'APP',
  'VIB',
  'UOB',
  'VISA',
  'MOMO',
  'SALE',
  'HOT',
  'NEW',
  'MAX',
  'OFF',
  'TPBANK',
  'VPBANK',
  'ZALOPAY',
  'VNPAY',
  'MASTERCARD',
  'JCB',
  'NAPAS',
  'XEM',
  'MUA',
  'TMALL',
  'VOUCHER',
  'CODE',
]);

export function extractCodeCandidates(text) {
  const found = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(
    /(?:mã(?: giảm giá)?|code|coupon|nhập mã|voucher code)\s*[:：]?\s*["“']?([A-Z0-9]{4,20})\b/gu
  )) {
    found.add(match[1]);
  }
  for (const match of source.matchAll(/\b([A-Z]{2,}[0-9]{1,6}[A-Z0-9]*)\b/gu)) {
    found.add(match[1]);
  }
  return [...found].filter(
    (code) =>
      !NOT_CODES.has(code) &&
      !/^\d+$/u.test(code) &&
      !/^\d+(K|TR|M|GB|ML|G|KG)$/u.test(code) &&
      !/^(?:IPHONE|GALAXY|SR|PDP)\d/u.test(code)
  );
}

const VOUCHER_ID_KEY = /^(?:voucherId|voucherCode|promotionId|couponId)$/u;
const AMOUNT_KEY =
  /discount|value|amount|money|percent|minspend|minorder|threshold|reduce/iu;

// A voucher definition carries its own identifier and an amount; product
// tiles, paging fields and UI translations never qualify.
function looksLikeVoucher(scalars) {
  return (
    scalars.some(
      ([key, item]) => VOUCHER_ID_KEY.test(key) && item !== null && item !== ''
    ) &&
    scalars.some(
      ([key, item]) => AMOUNT_KEY.test(key) && item !== '' && item !== null
    )
  );
}

const iso = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? new Date(Number(value)).toISOString()
    : null;
const number = (value) =>
  value === null || value === undefined || value === '' ? null : Number(value);

function apiDiscount(fields) {
  const percent = /%/u.test(
    `${fields.discountValueFormat ?? ''}${fields.discountTextRight ?? ''}${fields.rightDiscountText ?? ''}`
  );
  const value = number(fields.discountValue);
  return {
    discountPercent: percent ? value : null,
    discountAmount: percent
      ? null
      : (parseVndAmount(String(fields.discountValueFormat ?? '')) ?? value),
    maxDiscount: number(fields.maxDiscountAmount),
    minSpend: number(fields.minOrderAmount),
  };
}

function apiWindow(fields) {
  return {
    validFrom: iso(fields.startTimestamp),
    validUntil: iso(fields.endTimestamp),
    collectFrom: iso(fields.collectStartTimestamp),
    collectUntil: iso(fields.collectEndTimestamp),
  };
}

// Lazada's VoucherWrapper (campaign, store and LazMall voucher modules).
export function normalizeApiVoucher(fields) {
  const label = [fields.mainTitle, fields.newVoucherTag, fields.name]
    .filter(Boolean)
    .join(' · ');
  return {
    voucherId: String(fields.voucherId ?? fields.promotionId ?? ''),
    voucherCode: fields.voucherCode || null,
    title: fields.mainTitle || null,
    tag: fields.newVoucherTag || fields.voucherTagDesc || null,
    name: fields.name || null,
    toolCode: fields.toolCode || null,
    sellerId: fields.sellerId ? String(fields.sellerId) : null,
    ...apiDiscount(fields),
    ...apiWindow(fields),
    usageLimitPerCustomer: number(fields.usageLimitPerCustomer),
    leftBudget: number(fields.leftBudget),
    totalBudget: number(fields.totalBudget),
    status: fields.voucherStatus || null,
    collected: Boolean(fields.collected || fields.hasCollected),
    scopes: voucherScopes(`${label} ${fields.toolCode ?? ''}`),
    terms: fields.termInfo ? String(fields.termInfo).slice(0, 600) : null,
  };
}

// Lazada nests module JSON as strings.
function nestedJson(item) {
  if (typeof item !== 'string' || !/^[[{]/u.test(item.trim())) {
    return null;
  }
  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
}

// Walks API JSON and returns objects that look like voucher definitions,
// keeping only scalar fields so private account wrappers are dropped.
export function findVoucherObjects(value, path = '$', out = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 40) {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findVoucherObjects(item, `${path}[${index}]`, out, depth + 1)
    );
    return out;
  }
  const scalars = Object.entries(value).filter(
    ([, item]) => item === null || typeof item !== 'object'
  );
  if (looksLikeVoucher(scalars)) {
    out.push({ path, fields: Object.fromEntries(scalars) });
  }
  for (const [key, item] of Object.entries(value)) {
    const child = item && typeof item === 'object' ? item : nestedJson(item);
    if (child) {
      findVoucherObjects(child, `${path}.${key}`, out, depth + 1);
    }
  }
  return out;
}

export function voucherKey(voucher) {
  return [
    voucher.discountPercent ?? '',
    voucher.discountAmount ?? '',
    voucher.maxDiscount ?? '',
    voucher.minSpend ?? '',
    voucher.validUntil ?? '',
    [...(voucher.scopes || [])].sort().join('+'),
    [...(voucher.codes || [])].sort().join('+'),
  ].join('|');
}

export function dedupeVouchers(vouchers) {
  const merged = new Map();
  for (const voucher of vouchers) {
    const key = voucherKey(voucher);
    const known = merged.get(key);
    if (known) {
      known.sources = [...new Set([...known.sources, ...voucher.sources])];
    } else {
      merged.set(key, { ...voucher, sources: [...voucher.sources] });
    }
  }
  return [...merged.values()];
}

// Potential face-value saving only. This helper does not establish current
// validity, buyer/product/payment eligibility, stacking or basket application.
// Only a confirmed checkout discount may reduce a delivered buying price.
export function voucherValue(voucher, orderTotal) {
  if (voucher.minSpend && orderTotal < voucher.minSpend) {
    return 0;
  }
  if (voucher.discountAmount) {
    return voucher.discountAmount;
  }
  if (voucher.discountPercent) {
    const raw = Math.floor((orderTotal * voucher.discountPercent) / 100);
    return voucher.maxDiscount ? Math.min(raw, voucher.maxDiscount) : raw;
  }
  return 0;
}

// Runs inside the page through page.evaluate: no imports or outer closures.
// Returns the smallest blocks whose text looks like a voucher card.
export function extractPromotionBlocks() {
  const { document, location } = globalThis;
  const pattern =
    /giảm\s*(?:₫|đ)?\s*\d|\d\s*%\s*(?:off|giảm)|giảm\s*\d{1,2}\s*%|\boff\b|tối thiểu|min\.? spend|freeship|miễn phí vận chuyển|mã giảm giá|voucher/iu;
  const action =
    /thu thập|lưu|nhận|dùng ngay|sử dụng|collect|claim|use now|đã lưu|đã nhận|hết lượt/iu;
  const textOf = (node) => (node.innerText || node.textContent || '').trim();
  // Keep the smallest element holding the voucher text, plus the smallest
  // card that also holds its collect/use button.
  const isCard = (element) => {
    const raw = element.textContent || '';
    if (
      raw.length < 6 ||
      !pattern.test(raw) ||
      element.children.length > 25 ||
      element.closest('script,style,noscript,template,svg')
    ) {
      return null;
    }
    const text = textOf(element);
    if (text.length < 6 || text.length > 400 || !pattern.test(text)) {
      return null;
    }
    const children = [...element.children]
      .map(textOf)
      .filter((item) => pattern.test(item));
    const nested =
      children.length &&
      (!action.test(text) || children.some((item) => action.test(item)));
    return nested ? null : text;
  };
  const blocks = [];
  const seen = new Set();
  for (const element of document.querySelectorAll('body *')) {
    const text = isCard(element);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    const rect = element.getBoundingClientRect?.();
    blocks.push({
      text,
      hasAction: action.test(text),
      tag: element.tagName.toLowerCase(),
      className: String(element.className || '').slice(0, 120),
      href: element.closest('a[href]')?.href || null,
      visible: Boolean(rect?.width && rect?.height),
    });
  }
  const links = [...document.querySelectorAll('a[href]')]
    .map((anchor) => ({
      text: textOf(anchor).slice(0, 160) || anchor.title || '',
      href: anchor.href,
    }))
    .filter((link) =>
      /wow\/|megascenario|voucher|khuyen-mai|promo|campaign|flash|lazmall|thanh-toan|partnership/iu.test(
        link.href
      )
    );
  return {
    url: location.href,
    title: document.title,
    observedText: document.body?.innerText?.slice(0, 20000) || '',
    blocks,
    links,
  };
}
