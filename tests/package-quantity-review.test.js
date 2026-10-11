import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AssociativeStore, LazadaSearch } from '../src/index.js';
import {
  catalogProducts,
  resolveProductReviews,
} from '../src/catalog-products.js';
import { reviewPackageQuantities } from '../src/package-quantity-review.js';
import { sha256 } from '../src/util.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-quantity-review-'));
  const store = new AssociativeStore({ directory: join(directory, 'public') });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  app.collector.start = () => {
    throw new Error('Quantity review cannot open a browser');
  };
  app.cache.fetch = () => {
    throw new Error('Quantity review cannot fetch evidence');
  };
  const original = gunzipSync(
    await readFile(
      new URL(
        '../docs/acceptance/ice-dual-units/expanded-root-pongta-carton.html.gz',
        import.meta.url
      )
    )
  );
  const capture = await app.importCapture({
    url: 'https://www.lazada.vn/products/pdp-i3040048563.html?skuId=14623760583',
    html: original,
    observedAt: '2026-10-10T17:25:00Z',
  });
  const listingEvidenceId = capture.product.evidenceIds[0];
  const source = await readFile(
    new URL(
      '../docs/acceptance/ice-dual-units/expanded-powercap-abc-front.png',
      import.meta.url
    )
  );
  const image = await store.putBlob(source);
  const sourceEvidenceId = `package-label:${image.sha256}`;
  await store.put('evidence', {
    id: sourceEvidenceId,
    role: 'package-label-review',
    productId: capture.product.id,
    image,
    url: 'https://abcf.com.br/wp-content/uploads/2025/11/abc-powercap-chocolate.png',
    observedAt: capture.product.observedAt,
  });
  const product = {
    ...capture.product,
    evidenceIds: [...capture.product.evidenceIds, sourceEvidenceId],
  };
  await store.put('product', product);
  const input = {
    reviewedBy: 'Offline regression reviewer',
    reason:
      'Matched original chocolate130ml bilingual export wrapper; printed mass only, no nutrition approval',
    listingEvidenceId,
    listingSha256: sha256(original),
    facts: {
      netMassG: {
        value: 131,
        unit: 'g',
        basis: 'one-inner-food-package',
        sourceEvidenceId,
        sourceSha256: image.sha256,
        sourceAuthority: 'manufacturer-label-secondary-host',
        excerpt: '130mL; 净含量131克',
        identityMatched: true,
      },
    },
  };
  return {
    directory,
    app,
    store,
    product,
    offer: capture.offer,
    input,
    image,
    sourceEvidenceId,
    original,
  };
}

test('original-bound carton mass persists through restart and private fallback without changing price or manufacturer trust', async (t) => {
  const f = await fixture(t);
  const input = {
    ...f.input,
    facts: {
      ...f.input.facts,
      netVolumeMl: { ...f.input.facts.netMassG, value: 130, unit: 'ml' },
    },
  };
  const review = await reviewPackageQuantities(f.app, f.product.id, input);
  assert.deepEqual(
    await reviewPackageQuantities(f.app, f.product.id, input),
    review
  );
  assert.equal(review.id, f.product.id);
  assert.equal(review.nutritionApproved, false);
  assert.equal(review.factoryIdentityApproved, false);
  assert.match(review.reviewSha256, /^[a-f\d]{64}$/u);
  assert.deepEqual(await f.store.get('product', f.product.id), f.product);
  assert.deepEqual(await f.store.get('offer', f.offer.id), f.offer);
  const restarted = new AssociativeStore({ directory: f.store.directory });
  const shared = await resolveProductReviews(restarted, f.product);
  assert.equal(shared.netMassG, 131);
  assert.equal(shared.netVolumeMl, 130);
  assert.equal(shared.packCount, 24);
  assert.equal(shared.manufacturerVerification, undefined);
  assert.equal(shared.claims.at(-1).source, 'manual-review');
  assert.equal(
    shared.claims.at(-1).sourceAuthority,
    'manufacturer-label-secondary-host'
  );
  const privateStore = new AssociativeStore({
    directory: join(f.directory, 'private'),
    fallback: restarted,
    visibility: 'private',
  });
  await privateStore.put('product', f.product);
  await privateStore.put('offer', { ...f.offer, price: 600000 });
  const privateApp = new LazadaSearch({
    store: privateStore,
    offline: true,
    ocr: false,
  });
  t.after(() => privateApp.close());
  const comparison = (await privateApp.compare({ allowStale: true }))
    .comparisons[0];
  assert.equal(comparison.offer.price, 600000);
  assert.equal(comparison.metrics.totalMassG, 3144);
  assert.equal(comparison.metrics.totalVolumeMl, 3120);
  assert.equal(comparison.metrics.costPerGramBeforeDelivery, 600000 / 3144);
  assert.equal(comparison.metrics.costPerMlBeforeDelivery, 600000 / 3120);
  assert.equal(comparison.metrics.totalAfterDelivery, null);
  assert.equal(comparison.manufacturerVerified, false);
  assert.equal(f.app.cache.stats.downloads, 0);
});

test('quantity-only review rejects unsupported fields, wrong units, unknown basis and unbound or wrong product sources before writes', async (t) => {
  const f = await fixture(t);
  for (const facts of [
    { proteinPerPackageG: { ...f.input.facts.netMassG, value: 1 } },
    { netMassG: { ...f.input.facts.netMassG, unit: 'ml' } },
    { netMassG: { ...f.input.facts.netMassG, basis: 'whole-selling-unit' } },
    { netMassG: { ...f.input.facts.netMassG, identityMatched: false } },
    { netMassG: { ...f.input.facts.netMassG, sourceEvidenceId: 'unattached' } },
    { netMassG: { ...f.input.facts.netMassG, sourceSha256: 'a'.repeat(64) } },
  ]) {
    await assert.rejects(
      reviewPackageQuantities(f.app, f.product.id, { ...f.input, facts }),
      /quantity|original|attached/u
    );
    assert.equal((await f.store.list('package-quantity-review')).length, 0);
  }
  const source = await f.store.get('evidence', f.sourceEvidenceId);
  await f.store.put('evidence', { ...source, productId: 'other-product' });
  await assert.rejects(
    reviewPackageQuantities(f.app, f.product.id, f.input),
    /identity/u
  );
  assert.equal((await f.store.list('package-quantity-review')).length, 0);
});

test('new SKU, observation date, selected options or original bytes cannot inherit the old quantity approval', async (t) => {
  const f = await fixture(t);
  await reviewPackageQuantities(f.app, f.product.id, f.input);
  for (const change of [
    { sku: '3040048563_VNAMZ-999' },
    { observedAt: '2026-10-11T17:25:00Z' },
    { selectedVariant: [{ text: '1 chai' }] },
    { packCount: 1 },
    { evidenceIds: [f.sourceEvidenceId] },
  ]) {
    const resolved = await resolveProductReviews(f.store, {
      ...f.product,
      ...change,
    });
    assert.equal(resolved.netMassG, undefined);
    assert.equal(resolved.netVolumeMl, 130);
  }
  const listing = await f.store.get('evidence', f.input.listingEvidenceId);
  await f.store.put('evidence', {
    ...listing,
    html: await f.store.putBlob(
      Buffer.concat([f.original, Buffer.from('<!-- changed -->')])
    ),
  });
  assert.equal(
    (await resolveProductReviews(f.store, f.product)).netMassG,
    undefined
  );
  await assert.rejects(
    reviewPackageQuantities(f.app, f.product.id, f.input),
    /original/u
  );
});

test('active mass/count holds, pending reviews, conflicts and source invalidations withhold the new fact and preserve volume', async (t) => {
  const f = await fixture(t);
  await reviewPackageQuantities(f.app, f.product.id, f.input);
  for (const change of [
    { pendingSpecificationReview: ['netMassG'] },
    { pendingSpecificationReview: ['packCount'] },
    { packageCountUnresolved: true },
    { specificationsInvalidated: true },
    { crossChecks: [{ conflicts: [{ field: 'netMassG' }] }] },
  ]) {
    const resolved = await resolveProductReviews(f.store, {
      ...f.product,
      ...change,
    });
    assert.equal(resolved.netMassG, undefined);
    assert.equal(resolved.netVolumeMl, 130);
    if (change.pendingSpecificationReview) {
      assert.deepEqual(
        resolved.pendingSpecificationReview,
        change.pendingSpecificationReview
      );
    }
  }
  for (const field of ['netMassG', 'packCount']) {
    await f.store.put('specification-hold', {
      id: `${f.product.sku}:${field}`,
      field,
      active: true,
      evidenceId: f.input.listingEvidenceId,
    });
    assert.equal(
      (await resolveProductReviews(f.store, f.product)).netMassG,
      undefined
    );
    await assert.rejects(
      reviewPackageQuantities(f.app, f.product.id, f.input),
      /hold/u
    );
    await f.store.put('specification-hold', {
      id: `${f.product.sku}:${field}`,
      active: false,
    });
  }
  const copied = await resolveProductReviews(f.store, f.product);
  await f.store.put('product', copied);
  await f.store.put('invalidation', {
    id: 'invalidate-wrapper',
    evidenceIds: [f.sourceEvidenceId],
    invalidatedAt: '2026-10-12T00:00:00Z',
  });
  const invalidated = await resolveProductReviews(f.store, copied);
  assert.equal(invalidated.netMassG, undefined);
  assert.equal(invalidated.netVolumeMl, 130);
  assert.equal(
    invalidated.claims.some((claim) => claim.packageQuantityReviewSha256),
    false
  );
  await assert.rejects(
    reviewPackageQuantities(f.app, f.product.id, f.input),
    /invalidation/u
  );
  await f.store.put('invalidation', {
    id: 'invalidate-wrapper',
    evidenceIds: [f.sourceEvidenceId],
    reason: 'Explicit source invalidation without timestamp',
  });
  assert.equal(
    (await resolveProductReviews(f.store, copied)).netMassG,
    undefined
  );
  await assert.rejects(
    reviewPackageQuantities(f.app, f.product.id, f.input),
    /invalidation/u
  );
});

test('missing or altered original image bytes and mutated review values never calculate a false gram rate', async (t) => {
  const f = await fixture(t);
  const review = await reviewPackageQuantities(f.app, f.product.id, f.input);
  await f.store.put('package-quantity-review', {
    ...review,
    facts: { netMassG: { ...review.facts.netMassG, value: 1000 } },
  });
  assert.equal((await catalogProducts(f.store))[0].netMassG, undefined);
  await f.store.put('package-quantity-review', review);
  const path = join(
    f.store.directory,
    'blobs',
    f.image.sha256.slice(0, 2),
    f.image.sha256
  );
  await rm(path);
  assert.equal((await catalogProducts(f.store))[0].netMassG, undefined);
  await writeFile(path, 'altered original image');
  assert.equal((await catalogProducts(f.store))[0].netMassG, undefined);
  await assert.rejects(
    reviewPackageQuantities(f.app, f.product.id, f.input),
    /Corrupt evidence/u
  );
});

test('catalog resolves source reviews once per batch and never reloads unrelated products', async (t) => {
  const f = await fixture(t);
  await reviewPackageQuantities(f.app, f.product.id, f.input);
  await f.store.put('product', {
    id: 'unrelated',
    title: 'Unknown powder',
    category: 'whey',
    url: 'https://www.lazada.vn/products/pdp-i123.html',
  });
  const counts = new Map();
  const list = f.store.list.bind(f.store);
  f.store.list = (kind, ...args) => {
    counts.set(kind, (counts.get(kind) || 0) + 1);
    return list(kind, ...args);
  };
  const products = await catalogProducts(f.store);
  assert.equal(
    products.find((product) => product.id === f.product.id).netMassG,
    131
  );
  for (const kind of [
    'package-quantity-review',
    'invalidation',
    'specification-hold',
  ]) {
    assert.equal(counts.get(kind), 1, kind);
  }
  assert.equal(f.app.cache.stats.downloads, 0);
});
