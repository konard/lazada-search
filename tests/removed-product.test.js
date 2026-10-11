import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { classifyPage, extractPage } from '../src/browser.js';

const url = 'https://www.lazada.vn/products/pdp-i13439335807.html';

test('the observed Vietnamese removed-page title is terminal even without body instructions', () => {
  const { document } = parseHTML(
    '<html><head><title>Xin lỗi! Sản phẩm này không còn tồn tại</title></head><body></body></html>'
  );
  const snapshot = extractPage({ document, url });
  assert.equal(snapshot.priceText, undefined);
  assert.equal(classifyPage(snapshot), 'unavailable');
});

test('explicit Vietnamese and English deletion notices are not loading placeholders', () => {
  for (const rawText of [
    'Xin lỗi! Sản phẩm này không còn tồn tại',
    'Sản phẩm không tồn tại',
    'Sorry! This product no longer exists',
    'This product does not exist',
  ]) {
    assert.equal(
      classifyPage({ title: 'Lazada', url, rawText }),
      'unavailable'
    );
  }
  assert.equal(classifyPage({ title: 'Lazada', url, rawText: '' }), 'ok');
});

test('a priced product is not removed because its description quotes an old unavailable page', () => {
  assert.equal(
    classifyPage({
      url,
      title: 'Chocolate whey protein 1kg',
      priceText: '500.000 ₫',
      rawText: 'Related product no longer available.',
    }),
    'ok'
  );
});

test('a deletion notice never suppresses CAPTCHA, login or app-only classification', () => {
  const removed = {
    url,
    title: 'Xin lỗi! Sản phẩm này không còn tồn tại',
    rawText: '',
  };
  assert.equal(
    classifyPage({ ...removed, challenge: { detected: true } }),
    'challenge'
  );
  assert.equal(
    classifyPage({ ...removed, url: 'https://www.lazada.vn/member/login' }),
    'login'
  );
  assert.equal(
    classifyPage({
      ...removed,
      url: 'https://pages.lazada.vn/pdp-web-redirect-app',
    }),
    'app-only'
  );
});
