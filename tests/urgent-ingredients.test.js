import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractNutrition,
  ingredientFlags,
  massGrams,
} from '../src/nutrition.js';

test('dietary feature text does not hide an actual Vietnamese ingredient declaration', () => {
  const text = [
    'Đặc điểm thành phần: Không chứa gluten, dành cho người ăn chay',
    'Thông tin về chất gây dị ứng: Sữa và đậu nành',
    'Thành phần: Whey protein isolate, bột ca cao, đường mía, lecithin đậu nành, stevia',
  ].join('\n');
  const result = extractNutrition(text);
  assert.deepEqual(result.fields.ingredients, [
    'Whey protein isolate',
    'bột ca cao',
    'đường mía',
    'lecithin đậu nành',
    'stevia',
  ]);
  assert.ok(result.excerpts.ingredients.startsWith('\nThành phần:'));
  assert.deepEqual(ingredientFlags(result.fields.ingredients), {
    milk: true,
    soy: true,
    addedSugar: true,
    sweeteners: true,
    palmOil: false,
  });
});

test('dietary feature text alone does not become an ingredient list', () => {
  const result = extractNutrition(
    'Đặc điểm thành phần: Không chứa gluten, dành cho người ăn chay\nProtein: 24g'
  );
  assert.equal(result.fields.ingredients, undefined);
});

test('actual ingredient headers retain colon and separate-line forms', () => {
  for (const header of [
    'Ingredients: ',
    '  Ingredients:\n',
    'Thành phần:\n',
    'Thành phần\n',
  ]) {
    const result = extractNutrition(
      `${header}Whey protein isolate, cocoa\nDirections: Mix with water`
    );
    assert.deepEqual(result.fields.ingredients, [
      'Whey protein isolate',
      'cocoa',
    ]);
  }
});

test('SEEQ per-serving whey amount is not package net mass', () => {
  const title =
    'Bột Protein Trong Suốt Hlhua SEEQ 22g Whey Isolate Mỗi Lần Dùng Đường & Không Lactose Dinh Dưỡng Thể Thao Sau Khi Tập Dạng Thỏi Tiện Dụng - Vị Blue Razz Freeze, Strawberry Lemonade, Water';
  assert.equal(massGrams(title), undefined);
  assert.equal(
    massGrams('SEEQ 22g Whey Protein Isolate per serving - 18 sticks'),
    undefined
  );
  assert.equal(massGrams('SEEQ 22g Whey Isolate Mỗi Lần Dùng - túi 500g'), 500);
  assert.equal(massGrams('Whey protein isolate 1kg'), 1000);
  assert.equal(massGrams('22g Whey Isolate sample packet'), 22);
});
