import { voucherValue } from '../src/promotions.js';

// Renders promotions.json as a Markdown report. Reference baskets show what
// each voucher is worth before checkout confirms eligibility.

const BASKETS = [250000, 500000, 1000000, 5000000];
const money = (value) =>
  value === null || value === undefined
    ? '—'
    : `₫${Math.round(value).toLocaleString('en-US')}`;
const cell = (value) =>
  String(value ?? '—')
    .replace(/\|/gu, '\\|')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160);

function discount(voucher) {
  if (voucher.discountPercent) {
    return `${voucher.discountPercent}%`;
  }
  return money(voucher.discountAmount);
}

// Lazada Vietnam publishes voucher windows in local time (UTC+7).
export function vnTime(value) {
  if (!value) {
    return '—';
  }
  const local = new Date(new Date(value).getTime() + 7 * 3600000);
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

const validWindow = (voucher) =>
  voucher.validFrom || voucher.validUntil
    ? `${vnTime(voucher.validFrom)} – ${vnTime(voucher.validUntil)}`
    : cell(voucher.validityText);
const values = (voucher) =>
  BASKETS.map((basket) => money(voucherValue(voucher, basket))).join(' / ');
const byValue = (a, b) =>
  voucherValue(b, 1000000) - voucherValue(a, 1000000) ||
  (a.minSpend ?? 0) - (b.minSpend ?? 0);

// Lazada marks unlimited pools with 99,999,999.
const budget = (voucher) =>
  voucher.totalBudget >= 99999999
    ? 'unlimited'
    : `${voucher.leftBudget ?? '—'} / ${voucher.totalBudget ?? '—'}`;

function pageNames(summary, sources) {
  return sources
    .map((url) => summary.pages.find((page) => page.url === url))
    .filter(Boolean)
    .map((page) => cell(page.title))
    .join(', ');
}

function apiRows(summary) {
  return [...summary.apiVouchers]
    .sort(byValue)
    .map(
      (voucher) =>
        `| ${cell(voucher.name || voucher.title)} | ${cell(voucher.tag)} | ${discount(voucher)} | ${money(voucher.maxDiscount)} | ${money(voucher.minSpend)} | ${values(voucher)} | ${validWindow(voucher)} | ${voucher.usageLimitPerCustomer ?? '—'} | ${budget(voucher)} | ${voucher.voucherCode ? `\`${voucher.voucherCode}\`` : '—'} | ${pageNames(summary, voucher.sources)} |`
    );
}

function cardRows(summary) {
  return [...summary.vouchers]
    .sort(byValue)
    .map(
      (voucher) =>
        `| ${discount(voucher)} | ${money(voucher.maxDiscount)} | ${money(voucher.minSpend)} | ${values(voucher)} | ${cell(voucher.scopes.join(', ') || '—')} | ${validWindow(voucher)} | ${voucher.collectable ? 'yes' : 'no'} | ${cell(voucher.text)} | ${pageNames(summary, voucher.sources)} |`
    );
}

export function renderPromotionReport(summary) {
  const lines = [
    `# Lazada promotions: ${summary.campaign}`,
    '',
    `Generated ${summary.generatedAt} by \`scripts/collect-promotions.mjs\`. Browser session: ${summary.session ?? 'not recorded'}. See [the voucher guide](../../VOUCHERS-AND-PROMOTIONS.md) for how to collect, enter and stack them.`,
    '',
    'Every row is a displayed offer or lead, never an applied discount. Checkout must confirm eligibility, remaining quantity and stacking before a saving counts. Times are Vietnam local time (UTC+7).',
    '',
    '## Pages',
    '',
    '| Role | Status | Title | Cards | API vouchers | APIs | Observed |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...summary.pages.map(
      (page) =>
        `| [${cell(page.role)}](${page.url}) | ${cell(page.status)}${page.error ? `: ${cell(page.error)}` : ''} | ${cell(page.title)} | ${page.vouchers} | ${page.apiVouchers ?? 0} | ${cell(page.apis?.join(', ') || '—')} | ${cell(page.observedAt)} |`
    ),
    '',
    `## Vouchers from Lazada's page data (${summary.apiVouchers.length})`,
    '',
    'Parsed from the voucher modules Lazada sends to each page, one row per voucher ID. "Per customer" is the use limit; "Budget" is remaining / total vouchers in the pool.',
    '',
    `| Voucher | Scope | Discount | Cap | Min. spend | Value at ${BASKETS.map(money).join(' / ')} | Valid | Per customer | Budget | Code | Pages |`,
    '| --- | --- | ---: | ---: | ---: | --- | --- | ---: | --- | --- | --- |',
    ...apiRows(summary),
    '',
    `## Voucher cards shown on the pages (${summary.vouchers.length})`,
    '',
    `| Discount | Cap | Min. spend | Value at ${BASKETS.map(money).join(' / ')} | Scope | Valid | Collect button | Text | Pages |`,
    '| ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |',
    ...cardRows(summary),
    '',
    '## Typed codes from public coupon sites (unverified)',
    '',
    '| Code | Discount | Cap | Min. spend | Source | Source date | Context |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |',
    ...summary.codes
      .filter((code) => code.isVoucher || code.fromAttribute)
      .map((code) => {
        const source = summary.codeSources.find(
          (item) => item.source === code.source
        );
        return `| \`${code.code}\` | ${discount(code)} | ${money(code.maxDiscount)} | ${money(code.minSpend)} | ${code.source} | ${cell(source?.published || 'undated')} | ${cell(code.text)} |`;
      }),
    '',
    `Codes without a discount in their context stay in \`promotions.json\` only (${summary.codes.filter((code) => !code.isVoucher && !code.fromAttribute).length}).`,
    '',
    '## Code sources',
    '',
    '| Source | HTTP | Page date | Codes | Fetched |',
    '| --- | --- | --- | ---: | --- |',
    ...summary.codeSources.map(
      (source) =>
        `| ${source.source} | ${source.status ?? cell(source.error)} | ${cell(source.published || 'undated')} | ${source.codes} | ${source.fetchedAt} |`
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
