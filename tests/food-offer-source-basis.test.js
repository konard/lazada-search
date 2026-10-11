import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { discoverFoodOfferSourceBasis } from '../src/food-offer-source-basis.js';
import { extractPage } from '../src/browser.js';
import { parseProduct, validateOffer } from '../src/products.js';
import { calculateOffer } from '../src/compare.js';
import { sha256 } from '../src/util.js';

const source = {
  id: 'source',
  url: 'https://www.lazada.vn/products/pdp-i100.html',
  html: { sha256: 'a'.repeat(64) },
  observedAt: '2026-10-11T08:00:00Z',
};

function fixture(
  text = '2 túi tặng1 túi',
  massText = 'Net Content 2kg',
  origin = 'specification'
) {
  const snapshot = {
    sku: '100_VNAMZ-11',
    url: source.url,
    title: 'Chocolate whey protein powder',
    selectedVariant: [
      { text, selected: true },
      { text: 'Chocolate', selected: true },
    ],
  };
  const product = {
    id: 'product',
    sku: snapshot.sku,
    title: snapshot.title,
    category: 'whey',
    netMassG: 2000,
    packCount: 2,
    massEvidence: {
      selected: {
        value: 2000,
        metric: true,
        origin,
        context: massText,
        excerpt: '2kg',
      },
    },
  };
  const offer = {
    id: 'offer',
    sku: snapshot.sku,
    productId: product.id,
    url: source.url,
    currency: 'VND',
    price: 1790000,
    available: true,
    variantConfirmed: true,
    observedAt: source.observedAt,
  };
  return { snapshot, context: { product, offer, evidence: source } };
}

function discover(record) {
  return discoverFoodOfferSourceBasis(record.snapshot, record.context);
}

test('actual committed two-plus-one SKU yields one potential gift and a paid per-pouch mass hold without changing records', async () => {
  const html = await readFile(
    new URL(
      '../docs/acceptance/bonus-hydropure-evidence/3255422832-cached-public.html',
      import.meta.url
    )
  );
  assert.equal(
    sha256(html),
    '19ca775d018f221f06c5722ceedb21e3f8d20c6881ccd8290910ea367857aebf'
  );
  const { document } = parseHTML(html.toString());
  const snapshot = extractPage({
    document,
    url: 'https://www.lazada.vn/products/pdp-i3255422832.html',
  });
  const parsed = parseProduct(snapshot, {
    evidenceId:
      'evidence:3dfb72f823b28bd579e707642ae722e1afc0853c3cc0081f47d4d2ec471f6045',
    observedAt: '2026-10-10T21:09:54.492Z',
    originalHtmlSha256: sha256(html),
  });
  const context = {
    ...parsed,
    evidence: {
      ...source,
      id: parsed.offer.evidenceId,
      url: snapshot.url,
      html: { sha256: sha256(html) },
      observedAt: parsed.offer.observedAt,
    },
  };
  const before = globalThis.structuredClone({ snapshot, context });
  const result = discoverFoodOfferSourceBasis(snapshot, context);
  assert.equal(result.selectedSku, '3255422832_VNAMZ-117013951240');
  assert.equal(result.selectedSkuBound, true);
  assert.equal(result.foodComponents.length, 1);
  const gift = result.foodComponents[0];
  assert.equal(gift.kind, 'bonus-food');
  assert.equal(gift.status, 'potential');
  assert.equal(gift.discovery.advertisedPaidUnits, 2);
  assert.equal(gift.discovery.advertisedBonusUnits, 1);
  assert.equal(gift.discovery.source.sourceSha256, sha256(html));
  for (const field of [
    'product',
    'identity',
    'sourceIdentity',
    'facts',
    'eligibility',
    'review',
  ]) {
    assert.equal(gift[field], undefined, field);
  }
  assert.equal(result.paidMassBasis.safeToMultiplyByPackCount, false);
  assert.ok(parsed.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(result.paidMassBasis.basis, 'missing-or-already-held');
  assert.deepEqual({ snapshot, context }, before);
  const proposedOffer = validateOffer({
    ...parsed.offer,
    foodComponents: result.foodComponents,
  });
  const row = calculateOffer(
    {
      ...parsed.product,
      pendingSpecificationReview: parsed.product.pendingSpecificationReview,
    },
    proposedOffer,
    {
      requireManufacturer: false,
      requireShipping: false,
      now: Date.parse(parsed.offer.observedAt),
    }
  );
  assert.equal(row.offer.price, 1790000);
  assert.equal(row.metrics.totalMassG, null);
  assert.equal(row.metrics.foodComponents.confirmedBonuses.length, 0);
  assert.equal(row.metrics.foodComponents.potentialBonuses.length, 1);
});

test('Vietnamese and English quantity advertisements remain unapproved and purchase thresholds do not become multipacks', () => {
  for (const text of [
    '2 túi tặng 1 túi',
    '2túi tặng1túi',
    'mua2tặng1',
    'MUA 2 TẶNG 1',
    'Buy 2 get 1 free',
  ]) {
    const result = discover(fixture(text));
    assert.equal(result.foodComponents.length, 1, text);
    const gift = result.foodComponents[0];
    assert.equal(gift.discovery.advertisedPaidUnits, 2);
    assert.equal(gift.discovery.advertisedBonusUnits, 1);
    assert.equal(gift.discovery.factualApprovalGranted, false);
    assert.equal(gift.eligibility, undefined);
    assert.equal(gift.facts, undefined);
  }
  const record = fixture('Mua 2 tặng 1');
  record.context.product.packCount = 1;
  const result = discover(record);
  assert.equal(
    result.foodComponents[0].discovery.paidCountBasis,
    'promotion-purchase-threshold'
  );
  assert.equal(result.paidMassBasis.basis, 'single-selling-unit');
});

test('shakers, training plans, vouchers and utensil gifts never become edible denominators', () => {
  for (const text of [
    'Mua 2 tặng 1 bình 500ml',
    '2 túi tặng shaker',
    'Tặng muỗng',
    'Tặng giáo án',
    'Bonus meal plan',
    'Free voucher',
  ]) {
    const result = discover(fixture(text));
    assert.equal(result.foodComponents.length, 1, text);
    assert.equal(result.foodComponents[0].kind, 'non-food', text);
    assert.equal(result.foodComponents[0].facts, undefined);
  }
  const mixed = discover(fixture('2 túi tặng 1 túi + kèm shaker'));
  assert.deepEqual(
    mixed.foodComponents.map((component) => component.kind),
    ['bonus-food', 'non-food']
  );
});

test('nonselected siblings and shared title/body promotions do not create exact-SKU gifts', () => {
  const record = fixture('1kg');
  record.snapshot.title = 'Whey buy2 get1free';
  record.snapshot.description = 'Mua 2 tặng 1 túi';
  record.snapshot.selectedVariant.push({
    text: '2 túi tặng 1 túi',
    selected: false,
  });
  record.snapshot.skuCatalogObserved = true;
  record.snapshot.skuCatalog = [
    { sku: '11', options: [{ value: '1kg' }, { value: 'Chocolate' }] },
    {
      sku: '12',
      options: [{ value: '2 túi tặng 1 túi' }, { value: 'Vanilla' }],
    },
  ];
  assert.equal(discover(record).foodComponents.length, 0);
});

test('primary Vietnamese ice-cream options are not gifts and accented accompaniment does not approve food bonuses', () => {
  for (const text of [
    'kem hộp chocolate125ml',
    'Kem hộp 475ml',
    'Kem chocolate 2 hộp',
    'kèm 1 túi',
  ]) {
    const record = fixture(text);
    record.context.product.category = 'chocolate-ice-cream';
    assert.equal(discover(record).foodComponents.length, 0, text);
  }
  for (const text of ['kèm shaker', 'With shaker', 'Kèm bình lắc 500ml']) {
    const result = discover(fixture(text));
    assert.equal(result.foodComponents.length, 1, text);
    assert.equal(result.foodComponents[0].kind, 'non-food', text);
  }
  assert.equal(
    discover(fixture('kem hộp với chocolate')).foodComponents.length,
    0
  );
});

test('dietary-free primary foods do not become gifts and a separate free gift remains potential', () => {
  for (const text of [
    'Chocolate sugar-free 2 bags',
    'Chocolate lactose free 2 bags',
    'Gluten-free chocolate cup125ml',
    'Gluten‑free chocolate cup125ml',
    'FAT FREE chocolate 2 tubs',
    'Sugar-free ice cream 125ml cup',
    'Chocolate cup free of added sugar',
    'Chocolate2 bags free from any lactose',
    'Chocolate2 bags free-from lactose',
  ]) {
    assert.equal(discover(fixture(text)).foodComponents.length, 0, text);
  }
  for (const text of ['Free1 bag', 'Free chocolate cup125ml']) {
    const result = discover(fixture(text));
    assert.equal(result.foodComponents.length, 1, text);
    assert.equal(result.foodComponents[0].kind, 'bonus-food', text);
    assert.equal(result.foodComponents[0].status, 'potential', text);
    assert.equal(result.foodComponents[0].facts, undefined, text);
  }
  const mixed = discover(fixture('Sugar-free2 bags + Free1 bag'));
  assert.equal(mixed.foodComponents.length, 1);
  assert.equal(mixed.foodComponents[0].status, 'potential');
  const repeated = discover(fixture('Sugar-free chocolate2 bags free1 bag'));
  assert.equal(repeated.foodComponents.length, 1);
  assert.equal(
    discover(fixture('2 bags', 'Sugar-free each bag2kg', 'selected-option'))
      .paidMassBasis.safeToMultiplyByPackCount,
    true
  );
});

test('stored expected SKU IDs cannot attest an unobserved selected SKU or unlock multipack multiplication', () => {
  const record = fixture('2 túi tặng1 túi', 'Each bag 2kg', 'selected-option');
  delete record.snapshot.sku;
  const result = discover(record);
  assert.equal(result.selectedSkuBound, false);
  assert.equal(
    result.foodComponents[0].discovery.source.selectedSkuBound,
    false
  );
  assert.equal(result.paidMassBasis.safeToMultiplyByPackCount, false);
  assert.deepEqual(result.paidMassBasis.holdFields, ['netMassG']);
  record.snapshot.selectedVariant[0].sku = '11';
  assert.equal(discover(record).selectedSkuBound, true);
});

test('conflicting displayed identifiers or selected catalogue options quarantine discovery binding', () => {
  const cases = [
    (record) => {
      record.context.offer.sku = '100_VNAMZ-12';
    },
    (record) => {
      record.snapshot.selectedVariant[0].sku = '12';
    },
    (record) => {
      record.snapshot.skuCatalogObserved = true;
      record.snapshot.skuCatalog = [
        { sku: '11', options: [{ value: '1kg' }, { value: 'Vanilla' }] },
      ];
    },
  ];
  for (const mutate of cases) {
    const record = fixture();
    mutate(record);
    const result = discover(record);
    assert.equal(result.selectionConflict, true);
    assert.equal(result.selectedSkuBound, false);
    assert.equal(result.foodComponents.length, 0);
  }
});

test('duplicate displayed option renditions yield one stable potential record', () => {
  const record = fixture();
  const first = discover(record);
  record.snapshot.selectedVariant.push(...record.snapshot.selectedVariant);
  assert.deepEqual(discover(record).foodComponents, first.foodComponents);
});

test('explicit selected per-inner metric statements allow count multiplication without changing mass or approving factory facts', () => {
  for (const text of [
    'Mỗi túi 2kg',
    'Each bag weighs 2kg',
    '2kg per bag',
    '2 × 2kg',
    '2kg x2 bags',
    '2 bags of2kg',
  ]) {
    const record = fixture('2 túi', text, 'selected-option');
    const before = globalThis.structuredClone(record.context.product);
    const result = discover(record).paidMassBasis;
    assert.equal(result.basis, 'one-inner-food-package', text);
    assert.equal(result.safeToMultiplyByPackCount, true, text);
    assert.equal(result.factualApprovalGranted, false);
    assert.deepEqual(record.context.product, before);
  }
});

test('a derived short nutrition net-weight excerpt retains the equally ranked original selected per-bottle source basis', () => {
  const snapshot = {
    url: 'https://www.lazada.vn/products/fixture-i9201-s102.html',
    sku: '9201_VNAMZ-102',
    title: 'Thùng24 chai kem choco chocolate130ml/131g',
    priceText: '648.000 ₫',
    description:
      'Gross shipping weight:3500g\nNet weight:131g per bottle\nThể tích:130ml\nQuy cách:24 chai/thùng',
    selectedVariant: [{ text: '1 thùng' }],
  };
  const parsed = parseProduct(snapshot);
  assert.equal(parsed.product.massEvidence.selected.origin, 'nutrition-net');
  assert.equal(parsed.product.massEvidence.selected.context, 'Net weight:131g');
  assert.equal(parsed.product.netMassG, 131);
  assert.equal(parsed.product.packCount, 24);
  assert.equal(parsed.product.pendingSpecificationReview, undefined);
  const basis = discoverFoodOfferSourceBasis(snapshot, parsed).paidMassBasis;
  assert.equal(basis.basis, 'one-inner-food-package');
  assert.equal(basis.safeToMultiplyByPackCount, true);
  assert.equal(basis.factualApprovalGranted, false);
  assert.ok(
    basis.sourceStatements.every(
      (statement) => statement.origin === 'description'
    )
  );
  assert.match(basis.sourceStatements[0].excerpt, /131g per bottle/u);
  assert.equal(
    calculateOffer(parsed.product, parsed.offer).metrics.totalMassG,
    3144
  );
  assert.equal(parsed.offer.price, 648000);
  const before = globalThis.structuredClone(parsed.product);
  discoverFoodOfferSourceBasis(snapshot, parsed);
  assert.deepEqual(parsed.product, before);
  const ambiguous = parseProduct({
    ...snapshot,
    description: snapshot.description.replace(' per bottle', ''),
  });
  assert.ok(ambiguous.product.pendingSpecificationReview.includes('netMassG'));
  assert.equal(
    calculateOffer(ambiguous.product, ambiguous.offer).metrics.totalMassG,
    null
  );
});

test('context recovery cannot use another size, a parent title, shipping/nutrient scope, a lower-priority candidate or an unbound SKU', () => {
  const record = fixture('2 bags', 'Net weight2kg', 'nutrition-net');
  record.context.product.massEvidence.selected.priority = 5;
  const candidate = {
    value: 2000,
    metric: true,
    scope: 'net',
    origin: 'description',
    priority: 5,
    context: 'Net weight2kg per bag',
  };
  record.context.product.massEvidence.candidates = [candidate];
  assert.equal(discover(record).paidMassBasis.safeToMultiplyByPackCount, true);
  for (const invalid of [
    { value: 1000 },
    { metric: false },
    { scope: 'gross' },
    { scope: 'nutrition' },
    { scope: 'parent' },
    { origin: 'title' },
    { priority: 2 },
    { context: '' },
  ]) {
    record.context.product.massEvidence.candidates = [
      { ...candidate, ...invalid },
    ];
    assert.equal(
      discover(record).paidMassBasis.safeToMultiplyByPackCount,
      false
    );
  }
  record.context.product.massEvidence.candidates = [candidate];
  delete record.snapshot.sku;
  assert.equal(discover(record).paidMassBasis.safeToMultiplyByPackCount, false);
});

test('recovered original per-inner context still holds a contradictory total paid mass', () => {
  const record = fixture('2 bags', 'Net weight2kg', 'nutrition-net');
  record.context.product.massEvidence.selected.priority = 5;
  record.context.product.massEvidence.candidates = [
    {
      value: 2000,
      metric: true,
      scope: 'net',
      origin: 'description',
      priority: 5,
      context: 'Net weight2kg per bag; total net weight3kg for2 bags',
    },
  ];
  const result = discover(record).paidMassBasis;
  assert.equal(result.safeToMultiplyByPackCount, false);
  assert.equal(result.basis, 'conflicting-total-selling-unit');
  assert.deepEqual(result.holdFields, ['netMassG']);
  assert.equal(result.selectedMassG, 2000);
});

test('explicit total mass retains its original value and exposes a source-basis hold', () => {
  for (const text of [
    'Tổng khối lượng 2kg',
    'Total net weight:2kg',
    '2kg for 2 bags',
  ]) {
    const result = discover(fixture('2 túi', text)).paidMassBasis;
    assert.equal(result.basis, 'total-selling-unit', text);
    assert.equal(result.safeToMultiplyByPackCount, false);
    assert.deepEqual(result.holdFields, ['netMassG']);
    assert.equal(result.selectedMassG, 2000);
  }
  assert.equal(
    discover(fixture('2 túi', 'Each bag 2kg', 'title')).paidMassBasis
      .safeToMultiplyByPackCount,
    false
  );
});

test('mass basis must bind the selected numeric value and must not borrow a gift or other package size', () => {
  for (const text of [
    'Each bag 1kg; total2kg',
    'Gift bag2kg',
    '2 × 1kg',
    'Net Content2kg',
    'Protein per100g:2kg',
    '3 x2kg',
  ]) {
    const result = discover(fixture('2 túi', text)).paidMassBasis;
    assert.equal(result.safeToMultiplyByPackCount, false, text);
    assert.deepEqual(result.holdFields, ['netMassG']);
  }
});

test('decimal count tails cannot attest an integer per-inner multiplication basis', () => {
  for (const [text, packCount] of [
    ['0.2 x2kg', 2],
    ['0,2 ×2kg', 2],
    ['1.5 bags of2kg', 5],
    ['1.5 x2kg', 5],
    ['2kg x2.5 bags', 2],
  ]) {
    const record = fixture('2 bags', text, 'selected-option');
    record.context.product.packCount = packCount;
    const result = discover(record).paidMassBasis;
    assert.equal(result.safeToMultiplyByPackCount, false, text);
    assert.deepEqual(result.holdFields, ['netMassG'], text);
  }
});

test('explicit total and per-inner mass must agree with the selected paid pack count', () => {
  const conflict = discover(
    fixture('2 bags', 'Each bag2kg; total3kg', 'selected-option')
  ).paidMassBasis;
  assert.equal(conflict.basis, 'conflicting-total-selling-unit');
  assert.equal(conflict.safeToMultiplyByPackCount, false);
  assert.deepEqual(conflict.holdFields, ['netMassG']);
  assert.equal(conflict.selectedMassG, 2000);
  assert.equal(conflict.packCount, 2);
  assert.ok(
    conflict.sourceStatements.some(
      (statement) =>
        statement.massG === 3000 && statement.basis === 'total-selling-unit'
    )
  );
  const consistent = discover(
    fixture('2 bags', 'Each bag2kg; total4kg', 'selected-option')
  ).paidMassBasis;
  assert.equal(consistent.basis, 'one-inner-food-package');
  assert.equal(consistent.safeToMultiplyByPackCount, true);
  assert.equal(consistent.factualApprovalGranted, false);
  assert.deepEqual(consistent.holdFields, []);
});

test('advertised paid package mismatch exposes holds and preserves the recorded multiplier', () => {
  const record = fixture();
  record.context.product.packCount = 3;
  const result = discover(record).paidMassBasis;
  assert.deepEqual(result.holdFields, ['netMassG', 'packCount']);
  assert.equal(record.context.product.packCount, 3);
});

test('existing exact manufacturer/manual mass reviews and existing holds survive automatic discovery', () => {
  for (const authority of ['manufacturer', 'manual-review']) {
    const record = fixture();
    const product = record.context.product;
    product.evidenceIds = [source.id];
    product.reviewedFields = ['netMassG'];
    product.claims = [
      {
        field: 'netMassG',
        value: 2000,
        evidenceId: source.id,
        source: authority,
        requiresReview: false,
        reviewedAt: source.observedAt,
      },
    ];
    if (authority === 'manufacturer') {
      product.manufacturerVerification = {
        identityMatched: true,
        sourceAuthority: 'manufacturer',
        evidenceId: source.id,
      };
    }
    assert.equal(
      discover(record).paidMassBasis.basis,
      'existing-reviewed-mass-preserved'
    );
    product.pendingSpecificationReview = ['netMassG'];
    assert.equal(
      discover(record).paidMassBasis.basis,
      'missing-or-already-held'
    );
    assert.equal(
      discover(record).paidMassBasis.safeToMultiplyByPackCount,
      false
    );
  }
});

test('fractional quantity text cannot be shortened into a false purchase or gift count', () => {
  const result = discover(fixture('Mua 2.5 túi tặng 1 túi'));
  assert.equal(result.foodComponents.length, 1);
  assert.equal(
    result.foodComponents[0].discovery.advertisedPaidUnits,
    undefined
  );
  assert.equal(
    result.foodComponents[0].discovery.advertisedBonusUnits,
    undefined
  );
});
