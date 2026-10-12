import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import {
  checkTranslationQuality,
  translationEntities,
} from '../src/translation-quality.js';

const snapshot = (text) => {
  const { document } = parseHTML(`<html><body>${text}</body></html>`);
  return extractPage({
    document,
    url: 'https://www.lazada.vn/catalog/?q=whey',
  });
};
const product = (discountPercentText) =>
  parseProduct({
    url: 'https://www.lazada.vn/products/whey-i101.html',
    title: 'Whey chocolate 500g',
    sku: '101_VNAMZ-201',
    priceText: '390.000 ₫',
    originalPriceText: '480.000 ₫',
    discountPercentText,
  });

test('result counts, sale percentages and protected translation facts remain bounded on hostile source text', async () => {
  const browserUrl = new URL('../src/browser.js', import.meta.url).href;
  const productUrl = new URL('../src/products.js', import.meta.url).href;
  const translationUrl = new URL(
    '../src/translation-quality.js',
    import.meta.url
  ).href;
  const source = `import { parseHTML } from 'linkedom';
    import { extractPage } from ${JSON.stringify(browserUrl)};
    import { parseProduct } from ${JSON.stringify(productUrl)};
    import { checkTranslationQuality, translationEntities } from ${JSON.stringify(translationUrl)};
    const { document } = parseHTML('<html><body>' + ','.repeat(200000) + ' unsupported; Tìm thấy 1.230 sản phẩm</body></html>');
    if (extractPage({document,url:'https://www.lazada.vn/catalog/'}).searchCoverage.reportedTotal !== 1230) {
      throw Error('Later literal result count was lost');
    }
    const offer = parseProduct({url:'https://www.lazada.vn/products/whey-i101.html',title:'Whey 500g',priceText:'390.000 ₫',originalPriceText:'480.000 ₫',discountPercentText:'0'.repeat(200000)+' unsupported; -19,5%'}).offer;
    if (offer.displayedDiscountPercent !== 19.5 || offer.saleSavings !== 90000) throw Error('Literal sale facts changed');
    const url = 'https://manufacturer.example/label/' + ')'.repeat(200000) + 'x';
    if (!translationEntities(url + ');,.').includes(url)) throw Error('Protected URL was shortened');
    const decimal = '0.' + '0'.repeat(200000) + '1';
    const original = 'Protein ' + decimal + ' g per 100 g';
    if (!checkTranslationQuality(original, original, {sourceLanguage:'en'}).passed) throw Error('Exact decimal fact changed');
    console.log('bounded-source-text-parsing');`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    process.versions.deno
      ? ['eval', '--frozen', '--cached-only', '--no-check', source]
      : ['--input-type=module', '-e', source],
    { timeout: 5000 }
  );
  assert.match(stdout, /bounded-source-text-parsing/u);
});

test('result-count extraction preserves bilingual grouped counts and their first visible occurrence', () => {
  for (const [text, count] of [
    ['Tìm thấy 1.230 sản phẩm', 1230],
    ['TÌM THẤY\t1,230\nsản phẩm', 1230],
    ['1,234 products found', 1234],
    ['123 items\tfound', 123],
    ['0 items found', 0],
    ['17 items found; Tìm thấy 99 sản phẩm', 17],
    ['Tìm thấy 23 sản phẩm; 99 products found', 23],
    ['Irrelevant 40 g; Tìm thấy 23 sản phẩm', 23],
  ]) {
    assert.equal(snapshot(text).searchCoverage.reportedTotal, count, text);
  }
  for (const text of [
    ',,,, products found',
    'Tìm thấy ,,,, sản phẩm',
    '1..230 products found',
    '123items found',
    '123 productsfound',
  ]) {
    assert.equal(snapshot(text).searchCoverage.reportedTotal, null, text);
  }
  const parsed = snapshot('<script>999 products found</script>17 items found');
  assert.equal(parsed.searchCoverage.reportedTotal, 17);
  assert.equal(parsed.rawText, '17 items found');
});

test('literal sale percentages preserve decimal forms and never change sale prices or apply a second discount', () => {
  for (const [text, expected] of [
    ['-19%', 19],
    ['-19,5 %', 19.5],
    ['Sale 19.50\t%', 19.5],
    ['0%', 0],
    ['100%', 100],
  ]) {
    const { offer } = product(text);
    assert.equal(offer.displayedDiscountPercent, expected, text);
    assert.equal(offer.price, 390000);
    assert.equal(offer.originalPrice, 480000);
    assert.equal(offer.saleSavings, 90000);
    assert.equal(offer.saleDiscountPercent, 18.75);
    assert.equal(offer.discount, undefined);
  }
  for (const text of ['2..5%', '2,,5%', '.5%', ',5%', '101%', '19,5 off', '']) {
    assert.equal(product(text).offer.displayedDiscountPercent, undefined, text);
  }
});

test('protected URL suffix scanning retains internal punctuation, exact codes and translation review boundaries', () => {
  const url = 'https://manufacturer.example/label(a),b;c.d';
  const text = `${url});,. SKU1561301337_VNAMZ-6599253417 GTIN 0123456789012`;
  assert.deepEqual(translationEntities(text), [
    '0123456789012',
    '1561301337',
    '6599253417',
    'SKU1561301337_VNAMZ-6599253417',
    url,
  ]);
  assert.equal(
    checkTranslationQuality(text, text, { sourceLanguage: 'en' }).passed,
    true
  );
  const changed = checkTranslationQuality(
    text,
    text.replace('b;c.d', 'b;c.x'),
    {
      sourceLanguage: 'en',
    }
  );
  assert.ok(changed.issues.includes('protected-entity-mismatch'));
  assert.equal(changed.semanticAccuracyApproved, false);
});

test('decimal suffix scanning preserves zero normalization, significant fractions and quantity bases', () => {
  for (const [original, translated] of [
    ['Đạm 3,5000 g/100 g', 'Protein 3.5 grams per 100 grams'],
    ['Đạm 0,000100 g/100 g', 'Protein 0.0001 grams per 100 grams'],
    ['Đạm 000,000 g/100 g', 'Protein 0 grams per 100 grams'],
  ]) {
    assert.equal(checkTranslationQuality(original, translated).passed, true);
  }
  assert.ok(
    checkTranslationQuality(
      'Đạm 0,0001 g/100 g',
      'Protein 0.001 g/100 g'
    ).issues.includes('number-mismatch')
  );
  assert.ok(
    checkTranslationQuality(
      'Đạm 0,0001 g/100 g',
      'Protein 0.0001 g/100 ml'
    ).issues.includes('nutrition-basis-mismatch')
  );
});
