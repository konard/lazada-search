import test from 'node:test';
import assert from 'node:assert/strict';
import { parsers } from 'prettier/plugins/markdown';
import { parseHTML } from 'linkedom';
import { renderPromotionReport } from '../scripts/promotion-report.mjs';

function pageRow(title) {
  const report = renderPromotionReport({
    campaign: 'sale',
    generatedAt: '2026-10-13T00:00:00Z',
    pages: [
      {
        role: 'sale',
        url: 'https://pages.lazada.vn/sale',
        status: 200,
        title,
        vouchers: 0,
        observedAt: '2026-10-13T00:00:00Z',
      },
    ],
    apiVouchers: [],
    vouchers: [],
    codes: [],
    codeSources: [],
  });
  return report.split('\n').find((line) => line.startsWith('| [sale]('));
}

function separators(line) {
  let count = 0,
    slashes = 0;
  for (const character of line) {
    if (character === '|' && slashes % 2 === 0) {
      count++;
    }
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  return count;
}

test('promotion cells preserve literal slashes and pipes without creating extra table columns', () => {
  const row = pageRow(String.raw`Path \| sample`);
  assert.ok(row.includes(String.raw`Path \\\| sample`));
  assert.equal(separators(row), 8);
  assert.equal(separators(pageRow(String.raw`C:\Whey\source| coupon`)), 8);
});

test('promotion display truncation cannot leave an unfinished escape at the table boundary', () => {
  for (const last of ['\\', '|']) {
    const row = pageRow(`${'A'.repeat(159)}${last}tail`);
    assert.equal(separators(row), 8, last);
    assert.ok(row.endsWith(' |'));
    assert.ok(!row.includes('tail'));
    assert.ok(
      row.includes(`${'A'.repeat(159)}${last === '\\' ? '\\\\' : '\\|'} |`)
    );
  }
  assert.ok(pageRow('first\nsecond\tthird').includes('first second third'));
});

function completeSummary() {
  const url = 'https://pages.lazada.vn/sale?q=WIN10&sku=17#offers';
  const source = 'https://coupons.example/current';
  const voucher = {
    name: 'Platform voucher',
    tag: 'all shoppers',
    discountAmount: 10000,
    maxDiscount: 10000,
    minSpend: 50000,
    validityText: 'today',
    scopes: ['platform'],
    sources: [url],
    text: 'Save 10K',
    collectable: true,
  };
  return {
    campaign: 'sale',
    generatedAt: '2026-10-13T00:00:00Z',
    pages: [
      {
        role: 'sale',
        url,
        status: 200,
        title: 'Lazada sale',
        vouchers: 1,
        apiVouchers: 1,
        apis: ['voucher'],
        observedAt: '2026-10-13T00:00:00Z',
      },
    ],
    apiVouchers: [
      {
        ...voucher,
        voucherCode: 'WIN10',
        usageLimitPerCustomer: 1,
        leftBudget: 4,
        totalBudget: 10,
      },
    ],
    vouchers: [{ ...voucher }],
    codes: [
      { ...voucher, code: 'PUBLIC10', source, isVoucher: true, text: 'Save' },
    ],
    codeSources: [
      {
        source,
        status: 200,
        published: '12 October',
        codes: 1,
        fetchedAt: '2026-10-13T00:00:00Z',
      },
    ],
  };
}

async function reportTables(summary) {
  const text = renderPromotionReport(summary);
  const ast = await parsers.markdown.parse(text);
  const tables = ast.children.filter((node) => node.type === 'table');
  assert.deepEqual(
    tables.map((table) => table.children.map((row) => row.children.length)),
    [
      [7, 7],
      [11, 11],
      [9, 9],
      [7, 7],
      [5, 5],
    ]
  );
  return { text, rows: tables.map((table) => table.children[1].children) };
}

function literal(node) {
  return node.type === 'html'
    ? ''
    : node.value || node.children?.map(literal).join('') || '';
}

test('all promotion row types escape scalar fields and preserve ordinary links and inline codes', async () => {
  const summary = completeSummary();
  const normal = await reportTables(summary);
  assert.ok(normal.text.includes(`[sale](${summary.pages[0].url})`));
  assert.ok(normal.text.includes('| `WIN10` |'));
  assert.ok(normal.text.includes('| `PUBLIC10` |'));
  assert.equal(normal.rows[0][0].children[0].url, summary.pages[0].url);
  assert.equal(normal.rows[1][9].children[0].type, 'inlineCode');
  assert.equal(normal.rows[3][0].children[0].type, 'inlineCode');

  const value = 'Path \\| `tick` [label] <tag>\nnext';
  Object.assign(summary.pages[0], {
    role: value,
    title: value,
    status: value,
    error: value,
    vouchers: value,
    apiVouchers: value,
    apis: [value],
    observedAt: value,
  });
  for (const voucher of [summary.apiVouchers[0], summary.vouchers[0]]) {
    Object.assign(voucher, {
      name: value,
      tag: value,
      discountPercent: value,
      validityText: value,
      scopes: [value],
      text: value,
    });
  }
  Object.assign(summary.apiVouchers[0], {
    usageLimitPerCustomer: value,
    leftBudget: value,
    totalBudget: value,
  });
  Object.assign(summary.codes[0], {
    source: value,
    text: value,
    discountPercent: value,
  });
  Object.assign(summary.codeSources[0], {
    source: value,
    status: value,
    published: value,
    codes: value,
    fetchedAt: value,
  });
  const { rows } = await reportTables(summary);
  const displayed = value.replace(/\s+/gu, ' ');
  assert.equal(literal(rows[0][0]), displayed);
  assert.equal(literal(rows[0][3]), displayed);
  assert.equal(literal(rows[0][4]), displayed);
  assert.equal(literal(rows[1][7]), displayed);
  assert.equal(literal(rows[1][8]), `${displayed} / ${displayed}`);
  assert.equal(literal(rows[2][4]), displayed);
  assert.equal(literal(rows[3][4]), displayed);
  assert.equal(literal(rows[4][0]), displayed);
  assert.equal(literal(rows[4][1]), displayed);
  assert.equal(literal(rows[4][3]), displayed);
  assert.equal(literal(rows[4][4]), displayed);
});

test('promotion links encode Markdown and control separators without truncating the original destination', async () => {
  const summary = completeSummary();
  const url = `https://pages.lazada.vn/${'a'.repeat(200)}/price(a)\\b|c?quote="x"'\`\nnext`;
  summary.pages[0].url = url;
  const { text, rows } = await reportTables(summary);
  const expected = `https://pages.lazada.vn/${'a'.repeat(200)}/price%28a%29%5Cb%7Cc?quote=%22x%22%27%60%0Anext`;
  assert.ok(text.includes(`](${expected})`));
  assert.equal(rows[0][0].children[0].url, expected);
  assert.ok(expected.length > 160);
});

test('API and typed voucher codes preserve literal delimiters and make whitespace explicit without changing table shape', async () => {
  for (const value of [
    String.raw`WIN\path|10`,
    'WIN`one``two|<tag>&',
    'WIN\n10\r\nNEXT\tCODE',
  ]) {
    const summary = completeSummary();
    summary.apiVouchers[0].voucherCode = value;
    summary.codes[0].code = value;
    const { text, rows } = await reportTables(summary);
    const expected = /\s/u.test(value) ? JSON.stringify(value) : value;
    const suffix = /\s/u.test(value) ? ' (contains whitespace)' : '';
    assert.equal(literal(rows[1][9]), expected + suffix);
    assert.equal(literal(rows[3][0]), expected + suffix);
    const codeMarkup = text.match(/<code>[^<]*<\/code>/u)?.[0];
    assert.ok(codeMarkup);
    const { document } = parseHTML(`<html><body>${codeMarkup}</body></html>`);
    assert.equal(document.querySelector('code').textContent, expected);
    assert.equal(document.querySelectorAll('tag').length, 0);
  }
});
