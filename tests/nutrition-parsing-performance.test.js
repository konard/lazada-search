import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  extractNutrition,
  massEvidence,
  volumeMillilitres,
} from '../src/nutrition.js';

test('nutrition and volume extraction bound hostile numeric, whitespace and imperial-prefix inputs without losing later facts', async () => {
  const moduleUrl = new URL('../src/nutrition.js', import.meta.url).href;
  const source = `import { extractNutrition, massEvidence, volumeMillilitres } from ${JSON.stringify(moduleUrl)};
    const spaces = ' '.repeat(200000);
    const tabs = '\\t'.repeat(200000);
    if (volumeMillilitres('0'.repeat(200000) + ' unsupported; net volume 860 ml') !== 860) {
      throw Error('Later literal volume was lost');
    }
    const controls = [
      ['khẩu phần' + spaces + 'X\\nServing size: 2 scoops (30 g)\\nAmount per serving\\nProtein 24 g', 'servingMassG', 30],
      ['net mass' + tabs + 'X\\nNet weight: 2,3 kg', 'netMassG', 2300],
      ['dung tích' + tabs + 'X\\nThể tích thực: 860 ml', 'netVolumeMl', 860],
      ['Protein' + spaces + 'X\\nPer 100 g\\nProtein: 24 g', 'proteinPer100g', 24],
      ['Saturated fat' + tabs + 'X\\nPer 100 g\\nTotal fat: 8 g\\nSaturated fat: 3 g', 'fatPer100g', 8],
      ['Năng lượng' + spaces + 'X\\nTrên 100 g\\nNăng lượng: 240 kcal', 'kcalPer100g', 240],
    ];
    for (const [text, key, expected] of controls) {
      if (extractNutrition(text).fields[key] !== expected) throw Error('Later ' + key + ' was lost');
    }
    const mass = massEvidence('netwt,oz' + '\\t,oz'.repeat(25) + 'X 900 g; NET WEIGHT 907 g');
    if (mass.selected?.value !== 907 || mass.selected.scope !== 'net') throw Error('Net mass scope changed');
    console.log('bounded-nutrition-parsing');`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    process.versions.deno
      ? ['eval', '--no-check', source]
      : ['--input-type=module', '-e', source],
    { timeout: 5000 }
  );
  assert.match(stdout, /bounded-nutrition-parsing/u);
});

test('bounded label readers preserve Vietnamese serving nutrition, printed units and exact excerpts', () => {
  const result = extractNutrition(
    'Khối lượng tịnh:\t2,3 kg\nThể tích thực:\t1,5 l\nKhẩu phần:\t2 scoops (30 g)\nMỗi khẩu phần\nChất đạm:\t24 g\nĐường:\t1,5 g\nChất béo:\t3 g\nBéo bão hòa:\t1,5 g\nNăng lượng:\t120 kcal'
  );
  assert.deepEqual(result.fields, {
    servingMassG: 30,
    proteinPer100g: 80,
    sugarPer100g: 5,
    fatPer100g: 10,
    saturatedFatPer100g: 5,
    kcalPer100g: 400,
    netMassG: 2300,
    netVolumeMl: 1500,
  });
  assert.deepEqual(result.excerpts, {
    servingMassG: 'Khẩu phần:\t2 scoops (30 g',
    proteinPer100g: 'Chất đạm:\t24 g',
    sugarPer100g: 'Đường:\t1,5 g',
    fatPer100g: 'Chất béo:\t3 g',
    saturatedFatPer100g: 'Béo bão hòa:\t1,5 g',
    kcalPer100g: 'Năng lượng:\t120 kcal',
    netMassG: 'Khối lượng tịnh:\t2,3 kg',
    netVolumeMl: 'Thể tích thực:\t1,5 l',
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.basis, 'per-serving');
});

test('bounded readers retain both imperial net scope and all supported litre unit spellings', () => {
  for (const unit of [
    'ml',
    'milliliter',
    'milliliters',
    'millilitre',
    'millilitres',
  ]) {
    assert.equal(volumeMillilitres(`Chocolate ice cream 130 ${unit}`), 130);
  }
  for (const unit of ['l', 'liter', 'liters', 'litre', 'litres']) {
    assert.equal(volumeMillilitres(`Chocolate ice cream 1,5 ${unit}`), 1500);
  }
  const result = massEvidence('NET WT.5.64LB(90OZ)(2.56KG)');
  assert.deepEqual(
    result.candidates.map(({ scope }) => scope),
    ['net', 'net', 'net']
  );
  assert.equal(result.selected.value, 2560);
  assert.equal(
    extractNutrition('Net mass:\t2 lbs').fields.netMassG,
    2 * 453.59237
  );
  assert.equal(
    extractNutrition('Net mass 16 oz').fields.netMassG,
    16 * 28.349523125
  );
});

test('malformed numeric declarations cannot become later fragments or alternate units', () => {
  for (const value of ['2..5 ml', '2,,5 l', '.5 ml', ',5 ml', '1.,25 ml']) {
    assert.equal(volumeMillilitres(value), undefined, value);
  }
  assert.equal(volumeMillilitres('130 mlé'), undefined);
  assert.equal(volumeMillilitres('130 ml𐐀'), undefined);
  assert.equal(volumeMillilitres('2 lần'), undefined);
  const result = extractNutrition(
    'Serving size: 2..5 g\nNet mass: 2..5 g\nDung tích: 2..5 ml\nPer 100 g\nProtein: 2..5 g\nSugar:: 3 g\nFat: 9 milligrams'
  );
  assert.deepEqual(result.fields, {});
  assert.deepEqual(result.excerpts, {});
});

test('label token reading retains total-fat exclusion, repeated-value review and separate mass/volume columns', () => {
  const fat = extractNutrition(
    'Per 100 g\nTotal fat: 8 g\nSaturated\t fat:\t3 g\nSugars 4 g'
  );
  assert.equal(fat.fields.fatPer100g, 8);
  assert.equal(fat.fields.sugarPer100g, 4);
  assert.ok(!fat.warnings.includes('Repeated fatPer100g needs review'));
  const repeated = extractNutrition('Per 100 g\nProtein 20 g\nProtein 25 g');
  assert.equal(repeated.fields.proteinPer100g, undefined);
  assert.ok(repeated.warnings.includes('Repeated proteinPer100g needs review'));
  const mixed = extractNutrition('Per 100 g\nPer 100 ml\nProtein 2 g');
  assert.equal(mixed.fields.proteinPer100g, undefined);
  assert.equal(mixed.fields.proteinPer100ml, undefined);
  assert.ok(mixed.warnings.includes('Multiple nutrition columns need review'));
  const volume = extractNutrition('Per 100 ml\nProtein 2 g');
  assert.equal(volume.fields.proteinPer100ml, 2);
  assert.equal(volume.fields.proteinPer100g, undefined);
});
