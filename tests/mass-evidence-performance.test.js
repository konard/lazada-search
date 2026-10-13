import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { massEvidence, massGrams } from '../src/nutrition.js';

test('mass extraction bounds adversarial numeric runs without dropping a later literal package weight', async () => {
  const moduleUrl = new URL('../src/nutrition.js', import.meta.url).href;
  const source = `import { massEvidence } from ${JSON.stringify(moduleUrl)};
    for (const run of ['0'.repeat(200000), '0,0'.repeat(100000), '0,'.repeat(150000)]) {
      const result = massEvidence(run + ' unsupported; NET WEIGHT 2 LBS (907 g)');
      if (result.candidates.length !== 2 || result.selected?.value !== 907) {
        throw Error('Literal package declarations changed');
      }
    }
    console.log('bounded-package-mass');`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    process.versions.deno
      ? ['eval', '--no-check', source]
      : ['--input-type=module', '-e', source],
    { timeout: 5000 }
  );
  assert.match(stdout, /bounded-package-mass/u);
});

test('mass evidence preserves literal decimal/grouped metric and imperial values, excerpts and positions', () => {
  const text =
    'Chocolate bag: 2,3 kg; net weight 2 lbs (907 g); 2.270 gam; NET WT.5.64LB(90OZ)(2.56KG); Whey,500g; NET WT.500g';
  const evidence = massEvidence(text);
  assert.deepEqual(
    evidence.candidates.map(({ value, excerpt, index }) => ({
      value,
      excerpt,
      index,
    })),
    [
      { value: 2300, excerpt: '2,3 kg', index: text.indexOf('2,3') },
      { value: 2 * 453.59237, excerpt: '2 lbs', index: text.indexOf('2 lbs') },
      { value: 907, excerpt: '907 g', index: text.indexOf('907') },
      { value: 2270, excerpt: '2.270 gam', index: text.indexOf('2.270') },
      {
        value: 5.64 * 453.59237,
        excerpt: '5.64LB',
        index: text.indexOf('5.64LB'),
      },
      {
        value: 90 * 28.349523125,
        excerpt: '90OZ',
        index: text.indexOf('90OZ'),
      },
      { value: 2560, excerpt: '2.56KG', index: text.indexOf('2.56KG') },
      { value: 500, excerpt: '500g', index: text.indexOf('500g') },
      { value: 500, excerpt: '500g', index: text.lastIndexOf('500g') },
    ]
  );
  assert.equal(evidence.selected.value, 907);
  assert.equal(massGrams('NET WT.500g'), 500);
  assert.equal(massGrams('Whey,500g'), 500);
  assert.equal(massGrams('NET WT.5.64LB(90OZ)(2.56KG)'), 2560);
});

test('an incomplete numeric token cannot authorize the trailing fragment as a package denominator', () => {
  for (const text of ['2..5 g', '2,,5 kg', ',5g', '.5g', '1.,25 g']) {
    assert.equal(massGrams(text), undefined, text);
  }
  assert.equal(massGrams('Malformed 2..5 g; NET WEIGHT 900 g'), 900);
  assert.equal(massGrams('Protein25g; net weight 900g'), 900);
});
