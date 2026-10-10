import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractPromotionBlocks } from '../src/promotions.js';
import {
  campaignLinks,
  codesFromHtml,
  pageStatus,
  splitArguments,
  summarize,
  targetKey,
} from '../scripts/collect-promotions.mjs';
import { renderPromotionReport } from '../scripts/promotion-report.mjs';

const ROUTER =
  'https://pages.lazada.vn/wow/gcp/route/lazada/vn/upr_1000345_lazada/channel/vn/upr-router/vn?hybrid=1&wh_pid=';

function inPage(html, url, action) {
  const { document } = parseHTML(html);
  const saved = {
    document: globalThis.document,
    location: globalThis.location,
  };
  Object.assign(globalThis, { document, location: { href: url } });
  try {
    return action();
  } finally {
    Object.assign(globalThis, saved);
  }
}

test('voucher cards keep the smallest card holding the collect button', () => {
  const page = inPage(
    `<html><head><title>Sale</title></head><body>
      <section>
        <div class="card"><p>Giảm 12% tối đa 100K Đơn tối thiểu 400K</p><button>Thu thập</button></div>
        <div class="card"><p>Miễn phí vận chuyển giảm 30K</p><button>Lưu</button></div>
      </section>
      <a href="${ROUTER}/lazada/megascenario/vn/sale-10-10-2026/lazmall&spm=1">LazMall</a>
    </body></html>`,
    'https://pages.lazada.vn/',
    extractPromotionBlocks
  );
  const cards = page.blocks.filter((block) => block.hasAction);
  assert.equal(cards.length, 2);
  assert.match(cards[0].text, /Giảm 12%.*Thu thập/su);
  assert.equal(page.links.length, 1);
});

test('own flags are separated from the shared strict parser', () => {
  const { own, rest } = splitArguments([
    '--campaign=sale-11-11-2026',
    '--skip-codes',
    '--code-source',
    'https://a.example/',
    '--account',
    'default',
    'https://www.lazada.vn/products/x.html',
  ]);
  assert.equal(own.campaign, 'sale-11-11-2026');
  assert.equal(own.skipCodes, true);
  assert.deepEqual(own.codeSources, ['https://a.example/']);
  assert.deepEqual(rest, [
    '--account',
    'default',
    'https://www.lazada.vn/products/x.html',
  ]);
});

test('expired campaigns and homepage redirects are not empty successes', () => {
  const requested = `${ROUTER}/lazada/channel/vn/voucher/claimvoucher`;
  assert.equal(
    pageStatus(
      { url: requested, title: 'Page Not Found', observedText: 'We’re Sorry…' },
      requested
    ),
    'not-found'
  );
  assert.equal(
    pageStatus(
      { url: 'https://pages.lazada.vn/#?', title: 'Lazada', observedText: '' },
      requested
    ),
    'redirected-home'
  );
});

test('campaign links are deduplicated by page identity', () => {
  const links = campaignLinks(
    [
      {
        href: `${ROUTER}/lazada/megascenario/vn/sale-10-10-2026/lazmall&spm=a`,
        text: 'A',
      },
      {
        href: `${ROUTER}/lazada/megascenario/vn/sale-10-10-2026/lazmall&spm=b`,
        text: 'B',
      },
      { href: 'https://www.lazada.vn/products/pdp-i1.html', text: 'C' },
    ],
    'sale-10-10-2026'
  );
  assert.equal(links.length, 1);
  assert.equal(targetKey(`${ROUTER}/x&spm=1`), targetKey(`${ROUTER}/x&spm=2`));
});

test('coupon-site codes are unverified and rendered with their source date', () => {
  const source = 'https://coupons.example/lazada';
  const result = codesFromHtml(
    `<html><head><meta property="article:modified_time" content="2026-10-08T00:00:00Z"></head><body>
      <li><span data-code="LZDDQ25K">Lấy mã</span> Voucher Lazada 25K đơn hàng từ 99K</li>
      <p>Mã tiền điện tử có dạng LAZ13 khi hoàn tiền đơn COD</p>
    </body></html>`,
    source,
    '2026-10-10T00:00:00Z',
    parseHTML
  );
  assert.equal(result.published, '2026-10-08T00:00:00Z');
  const code = result.codes.find((item) => item.code === 'LZDDQ25K');
  assert.equal(code.verified, false);
  assert.equal(code.discountAmount, 25000);
  const report = renderPromotionReport(
    summarize({
      campaign: 'sale-10-10-2026',
      session: null,
      pages: [],
      codeSources: [{ ...result, status: 200 }],
      generatedAt: '2026-10-10T00:00:00Z',
    })
  );
  assert.match(report, /`LZDDQ25K` \| ₫25,000/u);
  assert.doesNotMatch(report, /`LAZ13`/u);
});

test('product tiles never count as vouchers and escaped links resolve', async () => {
  const { pageVouchers } = await import('../scripts/collect-promotions.mjs');
  const vouchers = pageVouchers(
    [
      {
        text: '[Voucher 12%] Ariel 2 bottles',
        href: 'https://www.lazada.vn/products/pdp-i1.html',
        hasAction: false,
      },
      { text: 'Giảm 50K Đơn tối thiểu 300K', href: null, hasAction: true },
    ],
    'https://pages.lazada.vn/',
    '2026-10-10T00:00:00Z'
  );
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].discountAmount, 50000);
  const [link] = campaignLinks(
    [
      {
        href: `${ROUTER.replace(/&/gu, '&amp;')}/lazada/megascenario/vn/sale-10-10-2026/lazmall`,
        text: 'LazMall',
      },
    ],
    'sale-10-10-2026'
  );
  assert.match(link.url, /&wh_pid=\/lazada\/megascenario/u);
});
