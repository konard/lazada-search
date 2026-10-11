import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedPackageImage } from '../src/package-image.js';

const original = 'https://img.lazcdn.com/g/package.jpg';
const product = { sku: '123_VNAMZ-456' };
const snapshot = (changes = {}) => ({
  sku: product.sku,
  selectedVariant: [{ sku: '456' }, { sku: product.sku }],
  skuCatalogObserved: true,
  skuCatalog: [{ sku: '456', image: original }],
  ...changes,
});

test('every displayed SKU must agree before a package image can establish mass', () => {
  assert.equal(
    selectedPackageImage(snapshot(), product, original).catalogSku,
    '456'
  );
  for (const changes of [
    { sku: '123_VNAMZ-789' },
    { selectedVariant: [{ sku: '456' }, { sku: '789' }] },
    { selectedVariant: [{ sku: '789' }, { sku: '456' }] },
    { selectedVariant: [{ sku: '999_VNAMZ-456' }] },
    { sku: '999_VNAMZ-456', selectedVariant: [] },
    { selectedVariant: [{ sku: '123_VNAMZ-_VNAMZ-456' }] },
    { skuCatalogObserved: 'true' },
  ]) {
    assert.equal(
      selectedPackageImage(snapshot(changes), product, original),
      undefined,
      JSON.stringify(changes)
    );
  }
});

test('bare SKU numbers can match full IDs but cannot hide conflicting listing prefixes', () => {
  assert.ok(
    selectedPackageImage(
      snapshot({ sku: undefined, selectedVariant: [{ sku: '456' }] }),
      product,
      original
    )
  );
  assert.equal(
    selectedPackageImage(
      snapshot({
        sku: '456',
        selectedVariant: [{ sku: '123_VNAMZ-456' }, { sku: '999_VNAMZ-456' }],
      }),
      { sku: '456' },
      original
    ),
    undefined
  );
  assert.equal(
    selectedPackageImage(
      snapshot({ skuCatalog: [{ sku: '999_VNAMZ-456', image: original }] }),
      product,
      original
    ),
    undefined
  );
});

test('ambiguous duplicate catalog entries cannot select the first convenient package', () => {
  assert.equal(
    selectedPackageImage(
      snapshot({
        skuCatalog: [
          { sku: '456', image: original },
          { sku: '123_VNAMZ-456', image: 'https://img.lazcdn.com/g/other.jpg' },
        ],
      }),
      product,
      original
    ),
    undefined
  );
});

test('only observed terminal CDN rendition suffixes normalize to an original asset', () => {
  for (const extension of ['jpg', 'jpeg', 'png', 'webp']) {
    const asset = `https://img.lazcdn.com/g/package.${extension}`;
    const selected = snapshot({ skuCatalog: [{ sku: '456', image: asset }] });
    for (const rendition of [
      `${asset}_720x720q80.${extension}`,
      `${asset}_2200x2200q80.${extension}_.webp`,
    ]) {
      assert.ok(selectedPackageImage(selected, product, rendition), rendition);
    }
    for (const sibling of [
      `${asset}_720x720q80-other.jpg`,
      `${asset}_720x720q80.${extension}.backup`,
      `${asset}_720x720q80.${extension}/other.jpg`,
      `${asset}_720x720q80original.jpg`,
    ]) {
      assert.equal(
        selectedPackageImage(selected, product, sibling),
        undefined,
        sibling
      );
    }
  }
});

test('asset normalization preserves host, protocol and query identity', () => {
  const selected = snapshot({
    skuCatalog: [{ sku: '456', image: `${original}?version=1` }],
  });
  assert.ok(
    selectedPackageImage(
      selected,
      product,
      `${original}_720x720q80.jpg_.webp?version=1#image`
    )
  );
  for (const sibling of [
    `${original}_720x720q80.jpg_.webp?version=2`,
    `http://img.lazcdn.com/g/package.jpg?version=1`,
    `https://img.slatic.net/g/package.jpg?version=1`,
  ]) {
    assert.equal(selectedPackageImage(selected, product, sibling), undefined);
  }
  const foreign = 'https://img.lazcdn.com.other.example/g/package.jpg';
  assert.equal(
    selectedPackageImage(
      snapshot({ skuCatalog: [{ sku: '456', image: foreign }] }),
      product,
      `${foreign}_720x720q80.jpg_.webp`
    ),
    undefined
  );
});
