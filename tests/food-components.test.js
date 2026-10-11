import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOffer } from '../src/compare.js';
import { accountFoodComponents } from '../src/food-components.js';
import { REQUIRED_SPEC_FIELDS } from '../src/verification.js';

const observedAt = '2026-10-11T06:00:00Z';
const options = {
  now: Date.parse(observedAt),
  flavourScope: 'chocolate-or-unflavoured',
};
const evidenceId = 'original-reviewed-fixture';
const proof = {
  sourceUrl: 'https://factory.example/chocolate',
  sourceSha256: 'a'.repeat(64),
  evidenceId,
  reviewedBy: 'Exact source fixture reviewer',
  reviewedAt: observedAt,
};

function fact(value, unit, basis, excerpt, valueExcerpt, basisExcerpt) {
  return { ...proof, value, unit, basis, excerpt, valueExcerpt, basisExcerpt };
}

function verifiedProduct(id = 'paid-product') {
  const product = {
    id,
    title: 'Factory chocolate whey',
    brand: 'Factory',
    market: 'VN',
    category: 'whey',
    netMassG: 1000,
    packCount: 2,
    proteinPer100g: 80,
    sugarPer100g: 1,
    fatPer100g: 1,
    saturatedFatPer100g: 0,
    kcalPer100g: 400,
    ingredients: ['whey protein isolate', 'cocoa'],
    evidenceIds: [evidenceId],
    manufacturerVerification: {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      evidenceId,
    },
  };
  product.claims = REQUIRED_SPEC_FIELDS.map((field) => ({
    field,
    value: product[field],
    source: 'manufacturer',
    requiresReview: false,
    evidenceId,
  }));
  return product;
}

function offer(foodComponents = []) {
  return {
    id: 'selected-offer',
    productId: 'paid-product',
    sku: '12345',
    market: 'VN',
    price: 1790000,
    currency: 'VND',
    available: true,
    variantConfirmed: true,
    shipping: 50000,
    observedAt,
    stock: 10,
    foodComponents,
  };
}

function bonus(orderQuantity = 1, units = 1) {
  const product = verifiedProduct('bonus-product');
  product.packCount = 1;
  const identity = {
    brand: 'Factory',
    name: 'Chocolate isolate',
    flavour: 'chocolate',
    market: 'VN',
    packageType: 'bag',
    formulaRevision: 'current-reviewed-revision',
    variantCode: 'chocolate-1000g',
    netMassG: 1000,
    innerPackCount: 1,
    currentFormula: true,
  };
  const counts = {
    orderQuantity,
    units,
    minOrderQuantity: 1,
    maxOrderQuantity: 10,
    stockUnits: 100,
    maxUnitsPerOrder: units,
  };
  return {
    id: 'one-free-bag',
    kind: 'bonus-food',
    product,
    identity: { ...identity },
    sourceIdentity: { ...identity },
    evidenceIds: [evidenceId],
    review: {
      ...proof,
      excerpt: 'Exact chocolate bag, VN market and current formula matched',
      identityMatched: true,
    },
    facts: {
      netMassG: fact(
        1000,
        'g',
        'one-inner-food-package',
        'Net weight 1000g',
        '1000g'
      ),
      proteinPer100g: fact(
        80,
        'g/100g',
        'per-100g',
        'Protein 80g per 100g',
        '80g',
        'per 100g'
      ),
    },
    eligibility: {
      ...counts,
      allocationId: 'order-food-gift-line-1',
      offerId: 'selected-offer',
      sku: '12345',
      confirmed: true,
      available: true,
      conditionsComplete: true,
      conditionsSatisfied: true,
      observedAt,
      claims: Object.fromEntries(
        Object.entries(counts).map(([field, value]) => [
          field,
          fact(
            value,
            'count',
            ['units', 'stockUnits', 'maxUnitsPerOrder'].includes(field)
              ? 'inner-food-package'
              : 'paid-selling-unit',
            `${field}: ${value} units`,
            `${value} units`
          ),
        ])
      ),
    },
  };
}

test('legacy paid multipacks retain their exact original denominator', () => {
  const result = calculateOffer(verifiedProduct(), offer(), options);
  assert.equal(result.metrics.totalMassG, 2000);
  assert.equal(result.metrics.totalProteinG, 1600);
  assert.equal(result.metrics.costPerGramBeforeDelivery, 895);
  assert.equal(result.metrics.foodComponents.paidFood.units, 2);
});

test('confirmed food adds once per exact order while paid quantity multiplies normally', () => {
  const one = calculateOffer(verifiedProduct(), offer([bonus()]), options);
  assert.equal(one.metrics.totalMassG, 3000);
  assert.equal(one.metrics.totalProteinG, 2400);
  assert.equal(one.metrics.costPerGramBeforeDelivery, 1790000 / 3000);
  assert.equal(one.metrics.costPerGramAfterDelivery, 1840000 / 3000);
  assert.equal(one.metrics.proteinPer100g, 80);
  assert.equal(one.metrics.proteinBasis, 'components');
  assert.equal(one.metrics.sugarPer25gProtein, null);
  const two = calculateOffer(verifiedProduct(), offer([bonus(2)]), {
    ...options,
    quantity: 2,
  });
  assert.equal(two.metrics.totalMassG, 5000);
  assert.equal(two.metrics.totalProteinG, 4000);
  assert.equal(two.metrics.foodComponents.confirmedBonuses[0].units, 1);
  assert.equal(
    two.metrics.foodComponents.confirmedBonuses[0].allocationId,
    'order-food-gift-line-1'
  );
  assert.equal(two.metrics.totalBeforeDelivery, 3580000);
});

test('paid metadata and accessories never add a second multipack or edible grams', () => {
  const result = calculateOffer(
    verifiedProduct(),
    offer([
      {
        id: 'paid-bags',
        kind: 'paid-food',
        productId: 'paid-product',
        unitsPerSellingUnit: 2,
      },
      {
        id: 'shaker',
        kind: 'non-food',
        name: 'Shaker',
        netMassG: 2000,
        netVolumeMl: 700,
        proteinPerPackageG: 500,
      },
      bonus(),
    ]),
    options
  );
  assert.equal(result.metrics.totalMassG, 3000);
  assert.equal(result.metrics.totalVolumeMl, null);
  assert.equal(
    result.metrics.foodComponents.nonFoodAccessories[0].counted,
    false
  );
});

test('advertised gift without exact stock and source-backed eligibility stays potential', () => {
  const unconfirmed = bonus();
  unconfirmed.eligibility.confirmed = false;
  const result = calculateOffer(
    verifiedProduct(),
    offer([unconfirmed]),
    options
  );
  assert.equal(result.metrics.totalMassG, 2000);
  assert.equal(result.metrics.costPerGramBeforeDelivery, 895);
  assert.equal(result.metrics.foodComponents.potentialBonuses.length, 1);
  assert.equal(result.metrics.foodComponents.completeOffer, false);
});

test('wrong identity, formula, market, flavour or unbound original proof cannot count a gift', () => {
  const changes = [
    (item) => {
      item.sourceIdentity.formulaRevision = 'other-revision';
    },
    (item) => {
      item.sourceIdentity.variantCode = 'other-bag';
    },
    (item) => {
      item.sourceIdentity.currentFormula = false;
    },
    (item) => {
      item.identity.market = item.sourceIdentity.market = 'US';
    },
    (item) => {
      item.product.selectedVariant = [{ text: 'Vanilla' }];
    },
    (item) => {
      item.review.sourceSha256 = 'not-a-digest';
    },
    (item) => {
      item.evidenceIds = [];
    },
    (item) => {
      item.product.packCount = 2;
    },
  ];
  for (const change of changes) {
    const item = bonus();
    change(item);
    const result = calculateOffer(verifiedProduct(), offer([item]), options);
    assert.equal(result.metrics.totalMassG, 2000);
    assert.equal(result.metrics.foodComponents.confirmedBonuses.length, 0);
  }
});

test('exact order, selected SKU, limits, stock, conditions and freshness independently gate gifts', () => {
  const changes = [
    (item) => {
      item.eligibility.orderQuantity = 2;
    },
    (item) => {
      item.eligibility.sku = 'other';
    },
    (item) => {
      item.eligibility.offerId = 'other';
    },
    (item) => {
      item.eligibility.stockUnits = 0;
    },
    (item) => {
      item.eligibility.units = 2;
    },
    (item) => {
      item.eligibility.conditionsSatisfied = false;
    },
    (item) => {
      item.eligibility.conditionsComplete = false;
    },
    (item) => {
      item.eligibility.available = false;
    },
    (item) => {
      item.eligibility.claims.units.sourceSha256 = '';
    },
    (item) => {
      item.eligibility.observedAt = '2026-10-09T06:00:00Z';
    },
    (item) => {
      item.eligibility.observedAt = '2026-10-12T06:00:00Z';
    },
  ];
  for (const change of changes) {
    const item = bonus();
    change(item);
    assert.equal(
      calculateOffer(verifiedProduct(), offer([item]), options).metrics
        .totalMassG,
      2000
    );
  }
  const result = calculateOffer(verifiedProduct(), offer([bonus(11)]), {
    ...options,
    quantity: 11,
  });
  assert.equal(result.metrics.foodComponents.confirmedBonuses.length, 0);
  assert.equal(result.eligible, false);
});

test('identical gift records deduplicate and contradictory IDs or allocation lines remain potential', () => {
  const item = bonus();
  let result = calculateOffer(
    verifiedProduct(),
    offer([item, globalThis.structuredClone(item)]),
    options
  );
  assert.equal(result.metrics.totalMassG, 3000);
  const conflicting = globalThis.structuredClone(item);
  conflicting.eligibility.confirmed = false;
  result = calculateOffer(
    verifiedProduct(),
    offer([item, conflicting]),
    options
  );
  assert.equal(result.metrics.totalMassG, 2000);
  const alias = globalThis.structuredClone(item);
  alias.id = 'same-physical-bag-under-new-id';
  result = calculateOffer(verifiedProduct(), offer([item, alias]), options);
  assert.equal(result.metrics.totalMassG, 2000);
});

test('held bonus quantities cannot count and gifts cannot repair unknown held paid quantities', () => {
  const item = bonus();
  item.product.pendingSpecificationReview = ['netMassG'];
  let result = calculateOffer(verifiedProduct(), offer([item]), options);
  assert.equal(result.metrics.totalMassG, 2000);
  const paid = verifiedProduct();
  paid.pendingSpecificationReview = ['netMassG'];
  result = calculateOffer(paid, offer([bonus()]), options);
  assert.equal(result.metrics.totalMassG, null);
  assert.equal(result.metrics.costPerGramBeforeDelivery, null);
  assert.equal(result.eligible, false);
});

test('missing or contradictory bonus nutrition withholds the combined protein metric', () => {
  const item = bonus();
  item.facts.proteinPer100g.basisExcerpt = 'per package';
  let result = calculateOffer(verifiedProduct(), offer([item]), {
    ...options,
    requireManufacturer: false,
  });
  assert.equal(result.metrics.totalMassG, 3000);
  assert.equal(result.metrics.totalProteinG, null);
  assert.equal(result.metrics.costPerProteinGramBeforeDelivery, null);
  const conflicting = bonus();
  conflicting.product.proteinPerPackageG = 1;
  conflicting.facts.proteinPerPackageG = fact(
    1,
    'g/package',
    'one-inner-food-package',
    'Protein 1g per package',
    '1g',
    'per package'
  );
  result = calculateOffer(verifiedProduct(), offer([conflicting]), {
    ...options,
    requireManufacturer: false,
  });
  assert.equal(result.metrics.totalProteinG, null);
  assert.equal(result.metrics.proteinConflict, true);
});

test('volume-based package protein sums exact inner units without density inference', () => {
  const paid = verifiedProduct();
  paid.netMassG = undefined;
  paid.netVolumeMl = 130;
  paid.proteinPer100g = undefined;
  paid.proteinPerPackageG = 1;
  const item = bonus();
  item.product.netMassG = undefined;
  item.product.netVolumeMl = 130;
  item.product.proteinPer100g = undefined;
  item.product.proteinPerPackageG = 1;
  for (const identity of [item.identity, item.sourceIdentity]) {
    delete identity.netMassG;
    identity.netVolumeMl = 130;
  }
  item.facts = {
    netVolumeMl: fact(
      130,
      'ml',
      'one-inner-food-package',
      'Net volume 130ml',
      '130ml'
    ),
    proteinPerPackageG: fact(
      1,
      'g/package',
      'one-inner-food-package',
      'Protein 1g per package',
      '1g',
      'per package'
    ),
  };
  const result = calculateOffer(paid, offer([item]), {
    ...options,
    requireManufacturer: false,
  });
  assert.equal(result.metrics.totalVolumeMl, 390);
  assert.equal(result.metrics.totalMassG, null);
  assert.equal(result.metrics.totalProteinG, 3);
});

test('contradictory explicit paid metadata quarantines denominators and invalid quantities fail', () => {
  const result = calculateOffer(
    verifiedProduct(),
    offer([
      {
        id: 'paid',
        kind: 'paid-food',
        productId: 'paid-product',
        unitsPerSellingUnit: 3,
      },
    ]),
    options
  );
  assert.equal(result.metrics.totalMassG, null);
  assert.equal(result.eligible, false);
  assert.throws(
    () => accountFoodComponents(verifiedProduct(), offer(), { quantity: 1.5 }),
    /integer/u
  );
});

test('exact kilogram conversion is allowed while density guesses and mass-as-count claims are withheld', () => {
  const item = bonus();
  item.facts.netMassG = {
    ...fact(1000, 'g', 'one-inner-food-package', 'Net weight 1kg', '1kg'),
    sourceValue: 1,
    sourceUnit: 'kg',
  };
  assert.equal(
    calculateOffer(verifiedProduct(), offer([item]), options).metrics
      .totalMassG,
    3000
  );
  const density = bonus();
  density.facts.netMassG = {
    ...fact(1000, 'g', 'one-inner-food-package', 'Net volume 1000ml', '1000ml'),
    sourceUnit: 'ml',
  };
  assert.equal(
    calculateOffer(verifiedProduct(), offer([density]), options).metrics
      .totalMassG,
    2000
  );
  const gramsAsCount = bonus();
  gramsAsCount.eligibility.claims.units.valueExcerpt = '1g';
  gramsAsCount.eligibility.claims.units.excerpt = 'Gift sample weight 1g';
  assert.equal(
    calculateOffer(verifiedProduct(), offer([gramsAsCount]), options).metrics
      .totalMassG,
    2000
  );
});

test('per100 and serving-count excerpts cannot supply package protein even with valid source hashes', () => {
  for (const excerpt of [
    'Protein 1g per 100g',
    'Servings per package: 1; Protein 1g per serving',
  ]) {
    const item = bonus();
    delete item.facts.proteinPer100g;
    item.product.proteinPerPackageG = 1;
    item.facts.proteinPerPackageG = fact(
      1,
      'g/package',
      'one-inner-food-package',
      excerpt,
      '1g',
      excerpt.includes('100g') ? 'per 100g' : 'per package'
    );
    const result = calculateOffer(verifiedProduct(), offer([item]), {
      ...options,
      requireManufacturer: false,
    });
    assert.equal(result.metrics.totalProteinG, null);
    assert.equal(result.metrics.costPerProteinGramBeforeDelivery, null);
  }
});

test('physical units must be original and bound to the source number; isolated glyphs cannot relabel milligrams', () => {
  const invalid = [
    { value: 100, excerpt: 'Net 100mg', valueExcerpt: '100', unitExcerpt: 'g' },
    {
      value: 1000,
      excerpt: 'Net 1000mg',
      valueExcerpt: '1000',
      unitExcerpt: '1000g',
    },
    {
      value: 1000,
      excerpt: 'Net 1000g; Protein 80g',
      valueExcerpt: '1000',
      unitExcerpt: 'Protein 80g',
    },
    {
      value: 1000,
      excerpt: 'Net 1000g; Sugar 2g',
      valueExcerpt: '1000',
      unitExcerpt: 'Sugar 2g',
    },
  ];
  for (const source of invalid) {
    const item = bonus();
    item.product.netMassG = source.value;
    item.identity.netMassG = source.value;
    item.sourceIdentity.netMassG = source.value;
    item.facts.netMassG = {
      ...item.facts.netMassG,
      ...source,
      sourceUnit: 'g',
    };
    assert.equal(
      calculateOffer(verifiedProduct(), offer([item]), {
        ...options,
        requireManufacturer: false,
      }).metrics.totalMassG,
      2000
    );
  }
  const valid = bonus();
  valid.facts.netMassG = {
    ...valid.facts.netMassG,
    excerpt: 'Net 1000 g',
    valueExcerpt: '1000',
    unitExcerpt: 'Net 1000 g',
  };
  assert.equal(
    calculateOffer(verifiedProduct(), offer([valid]), options).metrics
      .totalMassG,
    3000
  );
  const litre = bonus();
  litre.product.netVolumeMl = 125;
  litre.identity.netVolumeMl = 125;
  litre.sourceIdentity.netVolumeMl = 125;
  litre.facts.netVolumeMl = {
    ...fact(125, 'ml', 'one-inner-food-package', 'Net volume 0.125 L', '0.125'),
    sourceValue: 0.125,
    sourceUnit: 'L',
    unitExcerpt: '0.125 L',
  };
  const paid = verifiedProduct();
  paid.netVolumeMl = 125;
  assert.equal(
    calculateOffer(paid, offer([litre]), options).metrics.totalVolumeMl,
    375
  );
});

test('trusted reviews retain historical same-value claims while unresolved conflicts stay held', () => {
  const reviewed = bonus();
  reviewed.product.claims.push({
    field: 'netMassG',
    value: 1000,
    requiresReview: true,
  });
  assert.equal(
    calculateOffer(verifiedProduct(), offer([reviewed]), options).metrics
      .totalMassG,
    3000
  );
  const held = bonus();
  held.product.crossChecks = [{ conflicts: [{ field: 'netMassG' }] }];
  assert.equal(
    calculateOffer(verifiedProduct(), offer([held]), options).metrics
      .totalMassG,
    2000
  );
  assert.throws(
    () => accountFoodComponents(verifiedProduct(), offer({})),
    /component records/u
  );
});
