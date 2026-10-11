import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeVouchers,
  normalizeApiVoucher,
  parseVoucherText,
} from '../src/promotions.js';
import { summarize } from '../scripts/collect-promotions.mjs';

function apiVoucher(changes = {}) {
  return normalizeApiVoucher({
    voucherId: 'voucher-101',
    voucherCode: 'CHOC30',
    sellerId: 'seller-1',
    mainTitle: 'Voucher của shop',
    discountValue: 30000,
    minOrderAmount: 300000,
    startTimestamp: Date.parse('2026-10-10T00:00:00Z'),
    endTimestamp: Date.parse('2026-10-12T16:59:00Z'),
    voucherStatus: 'AVAILABLE',
    termInfo: 'One redemption per account',
    ...changes,
  });
}

function merged(left, right) {
  return dedupeVouchers([
    { ...left, sources: ['https://pages.lazada.vn/a'] },
    { ...right, sources: ['https://pages.lazada.vn/b'] },
  ]);
}

function summary(pages) {
  return summarize({
    campaign: 'sale-10-10-2026',
    session: null,
    pages,
    codeSources: [],
    generatedAt: '2026-10-11T06:00:00Z',
  });
}

function page(vouchers, observedAt, url = 'https://pages.lazada.vn/a') {
  return {
    url,
    observedAt,
    blocks: [],
    apiResponses: [{ api: 'mtop.lazada.voucher.query', vouchers }],
  };
}

test('equal-value API vouchers keep their exact identifiers, codes and sellers', () => {
  const one = apiVoucher();
  for (const change of [
    { voucherId: 'voucher-102' },
    { voucherCode: 'OTHER30' },
    { sellerId: 'seller-2' },
  ]) {
    assert.equal(merged(one, apiVoucher(change)).length, 2);
  }
  const actual = merged(one, one);
  assert.equal(actual.length, 1);
  assert.deepEqual(actual[0].sources, [
    'https://pages.lazada.vn/a',
    'https://pages.lazada.vn/b',
  ]);
});

test('couponId retains API identity even when voucherId is absent', () => {
  const coupons = ['coupon-1', 'coupon-2'].map((couponId) =>
    normalizeApiVoucher({ couponId, discountValue: 30000 })
  );
  assert.deepEqual(
    dedupeVouchers(coupons).map((voucher) => voucher.voucherId),
    ['coupon-1', 'coupon-2']
  );
});

test('equal discount amounts cannot erase different eligibility or collection windows', () => {
  const one = apiVoucher();
  for (const change of [
    { startTimestamp: Date.parse('2026-10-11T00:00:00Z') },
    { collectEndTimestamp: Date.parse('2026-10-11T00:00:00Z') },
    { usageLimitPerCustomer: 2 },
    { voucherStatus: 'EXHAUSTED' },
    { termInfo: 'Only selected chocolate products' },
    { toolCode: 'BANK_CARD' },
  ]) {
    assert.equal(merged(one, apiVoucher(change)).length, 2);
  }
});

test('different DOM terms survive the actual promotion summary', () => {
  const texts = [
    'Giảm 30K đơn từ 300K chỉ trên app',
    'Giảm 30K đơn từ 300K chỉ trên app. Mỗi tài khoản một lần',
  ];
  const result = summary([
    {
      ...page([], '2026-10-11T06:00:00Z'),
      blocks: texts.map((text) => ({ text, hasAction: true, href: null })),
    },
  ]);
  assert.equal(result.vouchers.length, 2);
  assert.deepEqual(
    result.vouchers.map((voucher) => voucher.text),
    texts
  );
});

test('unidentified equal shop cards on different pages retain separate seller eligibility', () => {
  const card = parseVoucherText('Voucher của shop giảm 30K đơn từ 300K');
  assert.equal(merged(card, card).length, 2);
  assert.equal(
    dedupeVouchers([
      { ...card, sources: ['shop-a'] },
      { ...card, sources: ['shop-a'] },
    ]).length,
    1
  );
});

test('API summary preserves changed states and merges only identical observed definitions', () => {
  const one = apiVoucher();
  const exhausted = apiVoucher({
    voucherStatus: 'EXHAUSTED',
    termInfo: 'Only selected chocolate products',
  });
  const result = summary([
    page([one], '2026-10-10T06:00:00Z'),
    page([one], '2026-10-10T07:00:00Z', 'https://pages.lazada.vn/b'),
    page([exhausted], '2026-10-11T06:00:00Z'),
  ]);
  assert.equal(result.apiVouchers.length, 2);
  const available = result.apiVouchers.find(
    (row) => row.status === 'AVAILABLE'
  );
  assert.equal(available.observations.length, 2);
  assert.deepEqual(
    available.observations.map((observation) => observation.observedAt),
    ['2026-10-10T06:00:00Z', '2026-10-10T07:00:00Z']
  );
  assert.equal(available.sources.length, 2);
  const unavailable = result.apiVouchers.find(
    (row) => row.status === 'EXHAUSTED'
  );
  assert.equal(unavailable.terms, 'Only selected chocolate products');
  assert.equal(unavailable.observations[0].observedAt, '2026-10-11T06:00:00Z');
  assert.equal(one.observations, undefined);
  assert.equal(one.sources, undefined);
});
