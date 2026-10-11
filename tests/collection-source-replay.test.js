import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import { parseProduct } from '../src/products.js';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { replayedSpecificationReviews } from '../src/collection-source-replay.js';

const cases = [
  {
    sku: '367656830_VNAMZ-116917756014',
    sourceSha256:
      'bf17215a7a9e359df92d81620aeac96e2431f4841e3a7f5313c27afbd6ee123d',
    mass: 40,
    packCount: 5,
    price: 39000,
  },
  {
    sku: '497264871_VNAMZ-15825435034',
    sourceSha256:
      '9d12389169d6edd98aa0a6219c27403b3343c31e5aa5d9f405f8b5a58d9fe235',
    mass: 60,
    packCount: 5,
    price: 89000,
  },
];

async function originalFixture(entry = cases[0]) {
  const receipt = JSON.parse(
    await readFile(
      new URL(
        '../docs/acceptance/ice-dual-units/merino-review.json',
        import.meta.url
      )
    )
  ).reviews.find((review) => review.skus.includes(entry.sku)).sourceCapture;
  const html = gunzipSync(
    await readFile(new URL(`../${receipt.artifactPath}`, import.meta.url))
  );
  assert.equal(sha256(html), entry.sourceSha256);
  const snapshot = extractPage({
    document: parseHTML(html.toString()).document,
    url: receipt.url,
  });
  const proof = {
    evidenceId: `fixture-original:${entry.sourceSha256}`,
    previousHtmlSha256: entry.sourceSha256,
    originalHtmlSha256: entry.sourceSha256,
  };
  const parsed = parseProduct(snapshot, {
    evidenceId: proof.evidenceId,
    originalHtmlSha256: entry.sourceSha256,
    observedAt: receipt.observedAt,
  });
  assert.equal(parsed.product.sku, entry.sku);
  assert.equal(parsed.product.netMassG, entry.mass);
  assert.equal(parsed.product.packCount, entry.packCount);
  assert.equal(parsed.offer.price, entry.price);
  return {
    ...parsed,
    html,
    snapshot,
    proof: { ...proof, offer: parsed.offer },
  };
}

function automaticPrevious(product) {
  return {
    ...globalThis.structuredClone(product),
    pendingSpecificationReview: ['netMassG', 'ingredients'],
    paidMassBasis: {
      selectedMassG: product.netMassG,
      packCount: product.packCount,
      basis: 'ambiguous',
      safeToMultiplyByPackCount: false,
      holdFields: ['netMassG'],
      requiresReview: true,
      factualApprovalGranted: false,
      sourceStatements: [],
      reasons: ['The old short net-weight excerpt lacked its per-stick suffix'],
    },
  };
}

function reviews(
  record,
  previous,
  current = record.product,
  proof = record.proof
) {
  return replayedSpecificationReviews(
    previous,
    current,
    record.snapshot,
    proof
  );
}

test('both original Merino per-stick declarations clear only the obsolete automatic mass flag without altering source facts', async () => {
  for (const entry of cases) {
    const record = await originalFixture(entry);
    const previous = automaticPrevious(record.product);
    record.product.pendingSpecificationReview = ['netVolumeMl'];
    const before = sha256(Buffer.from(JSON.stringify({ record, previous })));
    assert.deepEqual(reviews(record, previous), ['ingredients', 'netVolumeMl']);
    assert.equal(
      sha256(Buffer.from(JSON.stringify({ record, previous }))),
      before
    );
    assert.equal(record.offer.price, entry.price);
    assert.equal(record.product.proteinPer100g, undefined);
  }
});

test('different source bytes, observations, exact identities, quantities and missing original bindings preserve old holds', async () => {
  const record = await originalFixture();
  const previous = automaticPrevious(record.product);
  for (const altered of [
    { proof: { ...record.proof, originalHtmlSha256: 'b'.repeat(64) } },
    { proof: { ...record.proof, previousHtmlSha256: undefined } },
    { proof: { ...record.proof, evidenceId: undefined } },
    { proof: { ...record.proof, offer: { ...record.offer, sku: 'other' } } },
    {
      proof: {
        ...record.proof,
        offer: { ...record.offer, evidenceId: 'other' },
      },
    },
    { current: { ...record.product, observedAt: '2026-10-11T09:00:00Z' } },
    {
      current: { ...record.product, url: `${record.product.url}?skuId=other` },
    },
    { current: { ...record.product, id: 'other' } },
    { current: { ...record.product, sku: 'other' } },
    { current: { ...record.product, netMassG: 60 } },
    { current: { ...record.product, packCount: 6 } },
    { current: { ...record.product, evidenceIds: [] } },
    { previous: { ...previous, evidenceIds: [] } },
    { previous: { ...previous, paidMassBasis: undefined } },
    {
      previous: {
        ...previous,
        paidMassBasis: {
          ...previous.paidMassBasis,
          factualApprovalGranted: true,
        },
      },
    },
  ]) {
    assert.ok(
      reviews(
        record,
        altered.previous || previous,
        altered.current || record.product,
        altered.proof || record.proof
      ).includes('netMassG')
    );
  }
  assert.ok(
    reviews(record, previous, record.product, null).includes('netMassG')
  );
});

test('explicit holds, manual pending reviews, invalidations, consistency conflicts and paid-count holds cannot be waived', async () => {
  const record = await originalFixture();
  const previous = automaticPrevious(record.product);
  const blocked = [
    { specificationsInvalidated: true },
    { invalidatedAt: record.product.observedAt },
    { requiresReview: true },
    { packageCountUnresolved: true },
    { pendingSpecificationReview: ['netMassG', 'packCount'] },
    {
      specificationHolds: [
        {
          field: 'netMassG',
          active: true,
          evidenceId: record.proof.evidenceId,
        },
      ],
    },
    {
      specificationHolds: [
        {
          field: 'packCount',
          active: true,
          evidenceId: record.proof.evidenceId,
        },
      ],
    },
    { packageMassConsistency: { field: 'netMassG', requiresReview: true } },
    {
      claims: [
        { field: 'netMassG', source: 'manual-review', requiresReview: true },
      ],
    },
    { crossChecks: [{ conflicts: [{ field: 'netMassG' }] }] },
    { crossChecks: [{ conflicts: [{ field: 'packCount' }] }] },
  ];
  for (const change of blocked) {
    assert.ok(reviews(record, { ...previous, ...change }).includes('netMassG'));
    assert.ok(
      reviews(record, previous, { ...record.product, ...change }).includes(
        'netMassG'
      )
    );
  }
  for (const change of [
    { basis: 'conflicting-total-selling-unit' },
    { holdFields: ['netMassG', 'packCount'] },
    { selectedMassG: 200 },
    { packCount: 40 },
  ]) {
    assert.ok(
      reviews(record, {
        ...previous,
        paidMassBasis: { ...previous.paidMassBasis, ...change },
      }).includes('netMassG')
    );
  }
});

test('claim-level invalidation and consistency flags preserve quantity holds independently of claim authority or top-level flags', async () => {
  const record = await originalFixture();
  const previous = automaticPrevious(record.product);
  for (const field of ['netMassG', 'packCount']) {
    for (const source of ['dom', 'ocr', 'manual-review', 'manufacturer']) {
      for (const flag of [
        { invalidated: true },
        { invalidatedAt: record.product.observedAt },
        { consistencyReviewRequired: true },
      ]) {
        const claim = {
          field,
          value: record.product[field],
          source,
          requiresReview: false,
          evidenceId: record.proof.evidenceId,
          ...flag,
        };
        assert.ok(
          reviews(record, {
            ...previous,
            claims: [...previous.claims, claim],
          }).includes('netMassG')
        );
        assert.ok(
          reviews(record, previous, {
            ...record.product,
            claims: [...record.product.claims, claim],
          }).includes('netMassG')
        );
      }
    }
  }
  const unrelated = {
    ...previous,
    pendingSpecificationReview: ['netMassG', 'proteinPer100g'],
    claims: [
      ...previous.claims,
      {
        field: 'proteinPer100g',
        invalidatedAt: record.product.observedAt,
      },
    ],
  };
  assert.deepEqual(reviews(record, unrelated), ['proteinPer100g']);
});

test('fresh ambiguous, total, contradictory or unbound package statements cannot clear old mass reviews', async () => {
  const record = await originalFixture();
  const previous = automaticPrevious(record.product);
  for (const context of [
    'Net weight40g',
    'Total net weight40g for5 sticks',
    'Net weight40g per stick; Total net weight100g for5 sticks',
  ]) {
    const current = {
      ...record.product,
      massEvidence: {
        selected: { value: 40, metric: true, origin: 'description', context },
      },
    };
    assert.ok(reviews(record, previous, current).includes('netMassG'), context);
  }
  const unbound = { ...record.snapshot, sku: 'other' };
  assert.ok(
    replayedSpecificationReviews(
      previous,
      record.product,
      unbound,
      record.proof
    ).includes('netMassG')
  );
});

async function collectionFixture(t, entry = cases[0]) {
  const record = await originalFixture(entry);
  const directory = await mkdtemp(join(tmpdir(), 'lazada-source-mass-replay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const capture = {
    snapshot: record.snapshot,
    html: await store.putBlob(record.html),
    status: 'ok',
    fetchedAt: Date.parse(record.product.observedAt),
    id: `lazada:${record.snapshot.url}`,
    cacheHit: true,
  };
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    collector: {
      page: async () => capture,
      close: async () => {},
      start: () => {
        throw new Error('Offline source replay cannot start a browser');
      },
    },
  });
  t.after(() => app.close());
  const first = await app.collect(record.snapshot.url);
  await store.put('product', automaticPrevious(first.product));
  return { app, store, directory, capture, first, record };
}

test('reprocessing both exact Merino originals persists corrected selling mass and preserves prices after application restart', async (t) => {
  for (const entry of cases) {
    const { app, store, directory, capture, first } = await collectionFixture(
      t,
      entry
    );
    const result = await app.collect(capture.snapshot.url, { reprocess: true });
    assert.deepEqual(result.product.pendingSpecificationReview, [
      'ingredients',
    ]);
    assert.equal(result.product.netMassG, entry.mass);
    assert.equal(result.product.packCount, entry.packCount);
    assert.equal(result.offer.price, first.offer.price);
    assert.equal(result.offer.observedAt, first.offer.observedAt);
    assert.equal(result.offer.evidenceId, first.offer.evidenceId);
    assert.equal(result.product.manufacturerVerification, undefined);
    assert.equal(result.product.proteinPer100g, undefined);
    assert.deepEqual(
      (await store.get('product', result.product.id))
        .pendingSpecificationReview,
      ['ingredients']
    );
    const restarted = new LazadaSearch({
      store: new AssociativeStore({ directory }),
      offline: true,
      ocr: false,
    });
    t.after(() => restarted.close());
    const comparison = await restarted.compare({
      allowStale: true,
      requireManufacturer: false,
      requireShipping: false,
    });
    const row = comparison.comparisons.find(
      (item) => item.product.sku === entry.sku
    );
    assert.equal(row.metrics.totalMassG, entry.mass * entry.packCount);
    assert.equal(
      row.metrics.costPerGramBeforeDelivery,
      entry.price / (entry.mass * entry.packCount)
    );
    assert.equal(row.metrics.totalProteinG, null);
  }
});

test('the collection integration retains prior automatic mass hold if original bytes change without a snapshot change', async (t) => {
  const { app, store, capture, record } = await collectionFixture(t);
  capture.html = await store.putBlob(
    Buffer.concat([record.html, Buffer.from('<!-- changed source -->')])
  );
  const result = await app.collect(capture.snapshot.url, { reprocess: true });
  assert.ok(result.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(result.offer.price, cases[0].price);
});

test('the collection integration cannot erase an explicit store mass hold or an unresolved paid-package count', async (t) => {
  for (const field of ['netMassG', 'packCount']) {
    const { app, store, capture, first } = await collectionFixture(t);
    if (field === 'netMassG') {
      await store.put('specification-hold', {
        id: `${first.product.sku}:netMassG`,
        field,
        active: true,
        evidenceId: first.offer.evidenceId,
        reviewedAt: first.product.observedAt,
      });
    } else {
      await store.put('product', {
        ...automaticPrevious(first.product),
        pendingSpecificationReview: ['netMassG', 'packCount'],
      });
    }
    const result = await app.collect(capture.snapshot.url, { reprocess: true });
    assert.ok(result.product.pendingSpecificationReview.includes('netMassG'));
    const comparison = await app.compare({
      allowStale: true,
      requireManufacturer: false,
      requireShipping: false,
    });
    assert.equal(comparison.comparisons[0].metrics.totalMassG, null);
    assert.equal(result.offer.price, first.offer.price);
  }
});
