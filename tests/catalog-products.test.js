import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  LazadaSearch,
  RepositoryArchive,
  specificationProblems,
} from '../src/index.js';
import { mergeSharedManufacturerReview } from '../src/catalog-products.js';
import { listingKey } from '../src/util.js';

test('corrected ingredients recompute isolate and allergen filters without changing raw observations', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-derived-ingredients-')
  );
  const store = new AssociativeStore({ directory });
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/products.json', import.meta.url), 'utf8')
  );
  const product = {
    ...fixture.products[0],
    proteinType: 'unknown',
    ingredientFlags: { milk: false, soy: true },
  };
  const offer = { ...fixture.offers[0], observedAt: new Date().toISOString() };
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  await app.importRecords({ products: [product], offers: [offer] });
  await store.put('product', product);
  const report = await app.compare({ proteinType: 'isolate' });
  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0].product.proteinType, 'isolate');
  assert.equal(report.comparisons[0].product.ingredientFlags.milk, true);
  assert.equal(report.comparisons[0].product.ingredientFlags.soy, false);
  assert.equal((await store.get('product', product.id)).proteinType, 'unknown');
  assert.equal(app.cache.stats.downloads, 0);
});

const archive = new RepositoryArchive({
  directory: 'data/cases/vietnam-nha-trang',
});
const reviewed = await archive.get(
  'product',
  'product:4cbbbc2f96762acdbda325fecd41f71887b84efd990e8bfeecae84ad43559682'
);
const oldPrivate = () => ({
  ...globalThis.structuredClone(reviewed),
  visibility: 'private',
  ingredients: ['seller ingredient claim'],
  proteinPer100g: 20,
  claims: [
    {
      field: 'proteinPer100g',
      value: 20,
      source: 'dom',
      evidenceId: 'private-listing',
    },
  ],
  evidenceIds: ['private-listing'],
  reviewedFields: [],
  corrections: [],
  crossChecks: [],
  manufacturerVerification: undefined,
});

test('an exact shared review repairs an older private normalization without altering its raw claims or observation', () => {
  const original = oldPrivate();
  const updated = mergeSharedManufacturerReview(original, reviewed);
  assert.equal(updated.proteinPer100g, 70);
  assert.equal(updated.servingMassG, 40);
  assert.ok(updated.ingredients.includes('soy protein isolate (85%)'));
  assert.equal(updated.observedAt, original.observedAt);
  assert.equal(updated.visibility, 'private');
  assert.ok(updated.claims.some((c) => c.source === 'dom' && c.value === 20));
  assert.ok(updated.evidenceIds.includes('private-listing'));
  assert.equal(specificationProblems(updated).length, 0);
  assert.equal(original.proteinPer100g, 20);
  assert.deepEqual(mergeSharedManufacturerReview(updated, reviewed), updated);
});

for (const [name, override] of [
  ['another observation', { observedAt: '2026-10-10T12:30:00.000Z' }],
  ['another SKU', { sku: 'other-flavour' }],
  ['another item', { url: 'https://www.lazada.vn/products/pdp-i999.html' }],
  ['a missing observation timestamp', { observedAt: undefined }],
]) {
  test(`a shared review cannot verify ${name}`, () => {
    const product = { ...oldPrivate(), ...override };
    assert.equal(mergeSharedManufacturerReview(product, reviewed), product);
    assert.ok(specificationProblems(product).length > 0);
  });
}

test('a newer private manufacturer review wins, and untrusted or mismatched claims cannot be promoted', () => {
  const privateReview = {
    ...oldPrivate(),
    manufacturerVerification: {
      ...reviewed.manufacturerVerification,
      checkedAt: '2026-10-10T12:30:00.000Z',
    },
  };
  assert.equal(
    mergeSharedManufacturerReview(privateReview, reviewed),
    privateReview
  );
  for (const source of [
    {
      ...reviewed,
      manufacturerVerification: {
        ...reviewed.manufacturerVerification,
        sourceAuthority: 'seller',
      },
    },
    {
      ...reviewed,
      manufacturerVerification: {
        ...reviewed.manufacturerVerification,
        identityMatched: false,
      },
    },
    {
      ...reviewed,
      claims: reviewed.claims.map((c) => ({
        ...c,
        reviewId: 'unmatched-review',
      })),
    },
  ]) {
    const product = oldPrivate();
    assert.equal(mergeSharedManufacturerReview(product, source), product);
  }
});

test('account audit and comparison reuse public reviews and quarantine policies while retaining private prices', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-resolved-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'shared') });
  const store = new AssociativeStore({
    directory: join(directory, 'account'),
    fallback: shared,
    visibility: 'private',
  });
  const offer = (await archive.list('offer')).find(
    (o) => o.productId === reviewed.id && !o.supersededBy
  );
  await shared.put('product', reviewed);
  await shared.put('offer', offer);
  await store.put('product', oldPrivate());
  await store.put('offer', { ...offer, price: 350000 });
  const cone = {
    ...oldPrivate(),
    id: 'cone-snacks',
    url: 'https://www.lazada.vn/products/pdp-i888.html',
    sku: '888',
    category: 'chocolate-ice-cream',
  };
  await store.put('product', cone);
  await store.put('offer', {
    ...offer,
    id: 'cone-offer',
    productId: cone.id,
    url: cone.url,
    sku: cone.sku,
    price: 10000,
  });
  await shared.put('category-review', {
    id: `category:${listingKey(cone.url)}`,
    category: 'unknown',
    evidenceId: 'category-evidence',
    reviewedAt: '2026-10-10T10:00:00.000Z',
    reason: 'Crispy cone snack; no frozen ice cream established.',
  });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(() => app.close());
  app.collector.start = () => {
    throw new Error('No browser or downloads needed');
  };
  const report = await app.compare({
    category: 'protein-powder',
    allowStale: true,
  });
  assert.equal(report.comparisons.length, 1);
  const row = report.comparisons[0];
  assert.equal(row.manufacturerVerified, true);
  assert.equal(row.offer.price, 350000);
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, 350000 / 700);
  assert.equal(
    (await app.compare({ category: 'chocolate-ice-cream', allowStale: true }))
      .comparisons.length,
    0
  );
  const audit = await app.audit();
  assert.equal(audit.verifiedProducts, 1);
  assert.equal(
    audit.specifications.some((p) => p.productId === cone.id),
    false
  );
  assert.equal((await shared.get('offer', offer.id)).price, offer.price);
  assert.equal(
    (await store.get('product', reviewed.id)).proteinPer100g,
    20,
    'raw capture remains available'
  );
  assert.equal(app.cache.stats.downloads, 0);
});
