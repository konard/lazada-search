import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf } from '../src/nutrition.js';
import { targetCategoryExclusion } from '../src/target-category.js';
import { scopeAccountAudit } from '../scripts/account-category-scope.mjs';

const frog =
  'WHEY Chuyên Dùng Cho Ếch 500g Hoa Sen - Bổ Sung Đạm Whey Acid Amin Bung Đùi To Thịt Chắc Tăng Trọng Nhanh Tăng Đề Kháng';

test('observed frog feed is excluded from human whey collection and buying categories', () => {
  assert.match(targetCategoryExclusion(frog), /Animal feed/u);
  assert.equal(categoryOf(frog), 'unknown');
  const url = 'https://www.lazada.vn/products/pdp-i13427185482.html';
  const audit = scopeAccountAudit(
    { missingListings: [url], specifications: [] },
    {
      flavourScope: 'chocolate-or-unflavoured',
      discoveries: [{ url, title: frog }],
    }
  );
  assert.deepEqual(audit.missingListings, []);
  assert.equal(audit.excludedCategoryListings.length, 1);
});

test('animal-feed rules preserve human grass-fed whey and uncertain titles', () => {
  for (const title of [
    'Levels Grass Fed Whey Protein chocolate 2.27kg',
    'Chocolate whey isolate 1kg',
    'Bột whey protein bò ăn cỏ 2kg',
    'Whey chocolate from Frog Nutrition',
  ]) {
    assert.equal(targetCategoryExclusion(title), null);
    assert.equal(categoryOf(title), 'whey');
  }
  for (const title of [
    'animal feed whey powder 500g',
    'Thức ăn cho mèo protein 1kg',
    'Whey dành cho ếch 500g',
  ]) {
    assert.ok(targetCategoryExclusion(title));
  }
});

test('observed whey protein bars are not protein powder and frozen chocolate bars remain candidates', () => {
  const title =
    '[Olive trẻ] Rally protein thanh Whey protein cô lập 21g - 58g sô cô la Chunk/ Matcha Latte/injeolmi/Cacao Caramel';
  assert.match(targetCategoryExclusion(title), /Protein bars/u);
  assert.equal(categoryOf(title), 'unknown');
  assert.equal(categoryOf('Whey protein bars chocolate 12 x 58g'), 'unknown');
  assert.equal(
    categoryOf('Chocolate protein ice cream bars 60ml'),
    'chocolate-ice-cream'
  );
});
