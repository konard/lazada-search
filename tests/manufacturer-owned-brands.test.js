import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTrustedManufacturer,
  manufacturerCandidates,
} from '../src/manufacturers.js';

const cgn = {
  brand: 'California Gold Nutrition',
  title: 'California Gold Nutrition whey protein isolate 907 g',
  netMassG: 907,
  selectedVariant: [{ text: 'Dark Chocolate', selected: true }],
};
const page =
  'https://www.iherb.com/pr/california-gold-nutrition-sport-whey-protein-isolate-dark-chocolate-2-lb-907-g/82696';

test('CGN uses its brand owner exact dark chocolate 907 g product page', () => {
  const candidates = manufacturerCandidates(cgn);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, page);
  assert.equal(candidates[0].identityStatus, 'candidate-only');
  assert.equal(isTrustedManufacturer(cgn, page), true);
  assert.equal(
    isTrustedManufacturer(cgn, page.replace('www.iherb.com', 'mu.iherb.com')),
    true
  );
});

test('iHerb brand ownership does not trust other brands or brand conflicts', () => {
  const optimum = {
    brand: 'Optimum Nutrition',
    title: 'Optimum Nutrition Gold Standard whey protein',
  };
  assert.equal(isTrustedManufacturer(optimum, page), false);
  assert.equal(
    isTrustedManufacturer({ ...cgn, brand: 'Optimum Nutrition' }, page),
    false
  );
});

test('CGN trust rejects unrelated retailers and deceptive iHerb hosts', () => {
  for (const url of [
    'https://example.com/products/california-gold-nutrition',
    'https://iherb.com.example.com/pr/82696',
    'https://unreviewed.iherb.com/pr/82696',
    'https://cloudinary.images-iherb.com/images/cgn/cgn01202/r/77.jpg',
  ]) {
    assert.equal(isTrustedManufacturer(cgn, url), false);
  }
});

test('manufacturer aliases match complete words and never a similarly named brand', () => {
  for (const title of [
    'SuperProSupps chocolate whey',
    'MusaKingdom natural whey',
    'Rule 10 whey protein',
    'Clean Simple EatsPlus whey',
  ]) {
    assert.deepEqual(manufacturerCandidates({ title }), [], title);
  }
  assert.equal(
    manufacturerCandidates({ title: '[ProSupps] Chocolate whey' })[0].name,
    'ProSupps'
  );
  assert.equal(
    manufacturerCandidates({ title: 'RULE-1 whey protein' })[0].name,
    'Rule One Proteins'
  );
});

test('a trusted hostname does not authorize credentials or unsupported URL schemes', () => {
  for (const url of [
    'ftp://www.iherb.com/pr/82696',
    'https://operator:password@www.iherb.com/pr/82696',
  ]) {
    assert.equal(isTrustedManufacturer(cgn, url), false, url);
  }
});

test('cached factory lead brands provide scoped candidates without approving package or formula', () => {
  for (const [brand, url] of [
    [
      'Nutrabolics',
      'https://nutrabolics.com/products/hydropure-ultra-pure-hydrolyzed-whey-protein',
    ],
    ['Warrior', 'https://teamwarrior.com/products/warrior-whey-protein-2kg'],
    ['Mutant', 'https://mutantnation.com/products/whey-protein-mix'],
    [
      'OstroVit',
      'https://ostrovit.com/en/products/ostrovit-wpc-80-700-g-26507.html',
    ],
  ]) {
    const product = { brand, title: `${brand} chocolate whey` };
    const [candidate] = manufacturerCandidates(product);
    assert.equal(candidate.name, brand);
    assert.equal(candidate.url, url);
    assert.equal(candidate.identityStatus, 'candidate-only');
    assert.equal(isTrustedManufacturer(product, url), true);
    assert.equal(
      isTrustedManufacturer({ ...product, brand: 'ProSupps' }, url),
      false
    );
  }
});
