import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeVouchers,
  extractCodeCandidates,
  findVoucherObjects,
  parseVndAmount,
  parseVoucherDate,
  parseVoucherText,
  voucherValue,
} from '../src/promotions.js';

const observedAt = '2026-10-10T05:00:00Z';

test('Vietnamese amounts use thousand separators and K/TR units', () => {
  assert.equal(parseVndAmount('50K'), 50000);
  assert.equal(parseVndAmount('₫50.000'), 50000);
  assert.equal(parseVndAmount('400,000₫'), 400000);
  assert.equal(parseVndAmount('1TR'), 1000000);
  assert.equal(parseVndAmount('1,5 triệu'), 1500000);
  assert.equal(parseVndAmount('không có'), null);
});

test('percentage voucher keeps cap, minimum spend and local expiry', () => {
  const voucher = parseVoucherText(
    'Giảm 12% Giảm tối đa ₫100K Đơn tối thiểu ₫400K HSD: 12.10 23:59 Thu thập',
    { observedAt }
  );
  assert.equal(voucher.discountPercent, 12);
  assert.equal(voucher.discountAmount, null);
  assert.equal(voucher.maxDiscount, 100000);
  assert.equal(voucher.minSpend, 400000);
  assert.equal(voucher.validUntil, '2026-10-12T16:59:00.000Z');
  assert.equal(voucher.isVoucher, true);
});

test('fixed freeship voucher is classified by scope', () => {
  const voucher = parseVoucherText(
    'Miễn phí vận chuyển Giảm 30K phí vận chuyển Đơn từ 0đ',
    { observedAt }
  );
  assert.equal(voucher.discountAmount, 30000);
  assert.ok(voucher.scopes.includes('freeship'));
});

test('payment and new-user scopes are detected', () => {
  const voucher = parseVoucherText(
    'Giảm 7% cho khách hàng mới khi thanh toán bằng thẻ VIB Lazcard'
  );
  assert.deepEqual(voucher.scopes.sort(), ['new-user', 'payment']);
});

test('typed codes are found while ordinary words and sizes are ignored', () => {
  assert.deepEqual(
    extractCodeCandidates('Nhập mã VUI12 giảm 12%, áp dụng LAZMALL, 50K, VIB'),
    ['VUI12']
  );
  assert.deepEqual(extractCodeCandidates('Code: LAZ1010 FREESHIP'), [
    'LAZ1010',
  ]);
});

test('year-less dates far in the past roll into the next year', () => {
  assert.equal(
    parseVoucherDate('05.01', '2026-10-10T00:00:00Z'),
    '2027-01-05T16:59:00.000Z'
  );
});

test('nested API JSON voucher objects are found, including string modules', () => {
  const response = {
    data: {
      module: JSON.stringify({
        list: [
          {
            voucherId: 1,
            voucherDiscount: '12%',
            minSpend: 400000,
            title: 'x',
          },
        ],
      }),
    },
  };
  const found = findVoucherObjects(response);
  assert.equal(found.length, 1);
  assert.equal(found[0].fields.minSpend, 400000);
});

test('duplicate cards merge their sources and value honours caps', () => {
  const card = parseVoucherText('Giảm 12% tối đa 100K đơn tối thiểu 400K');
  const merged = dedupeVouchers([
    { ...card, sources: ['a'] },
    { ...card, sources: ['b'] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources, ['a', 'b']);
  assert.equal(voucherValue(card, 300000), 0);
  assert.equal(voucherValue(card, 500000), 60000);
  assert.equal(voucherValue(card, 2000000), 100000);
});

test('aggregator phrasing "giảm giá" and "Voucher 25K" yields fixed amounts', () => {
  const text = 'Voucher Lazada giảm giá 100K đơn hàng từ 1 Triệu';
  assert.equal(parseVoucherText(text).discountAmount, 100000);
  assert.equal(parseVoucherText(text).minSpend, 1000000);
  assert.equal(
    parseVoucherText('Voucher Lazada 25K đơn hàng từ 99K').discountAmount,
    25000
  );
});

test('live noise: product titles, bare freeship labels and paging keys', () => {
  const title = parseVoucherText('[Voucher 26%] Box of 30 Packs Vifon 60g');
  assert.equal(title.discountPercent, 26);
  assert.equal(title.discountAmount, null);
  assert.equal(parseVoucherText('MIỄN PHÍ VẬN CHUYỂN').isVoucher, false);
  assert.equal(
    parseVoucherText('₫434,000 -18% Power Bank').discountPercent,
    null
  );
  assert.deepEqual(
    findVoucherObjects({
      traceId: 'x',
      stopScrollThreshold: '0',
      msgCode: '0',
      totalPage: '8',
    }),
    []
  );
});
