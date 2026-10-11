import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { LazadaSearch } from '../src/application.js';
import { parseTsv } from '../src/ocr.js';
import { sha256 } from '../src/util.js';
import { calculateOffer } from '../src/compare.js';
import { validateFoodComponentEvidence } from '../src/food-component-evidence.js';
import { REQUIRED_SPEC_FIELDS } from '../src/verification.js';

const registry = [
  {
    name: 'Factory',
    aliases: ['factory'],
    domains: ['factory.example'],
    url: 'https://factory.example/chocolate',
  },
];
const officialUrl = registry[0].url;
const checkoutUrl = 'https://cart.lazada.vn/cart';
const makerId = 'original-manufacturer';
const checkoutId = 'original-checkout';
const reviewId = 'stored-exact-review';
const excerpts = {
  identity: 'Factory Chocolate Isolate CHOC-1000 CURRENT-V1 VN bag',
  netMassG: 'Net weight: 1000 g',
  packCount: 'One package: 1 bag',
  proteinPer100g: 'Per 100 g Protein: 80 g',
  sugarPer100g: 'Per 100 g Sugar: 0 g',
  fatPer100g: 'Per 100 g Fat: 1 g',
  saturatedFatPer100g: 'Per 100 g Saturated Fat: 0 g',
  kcalPer100g: 'Per 100 g Energy: 400 kcal',
  ingredients: 'Ingredients: whey protein isolate, cocoa',
};

function sourcedFact(value, unit, basis, proof, excerpt, original) {
  return {
    ...proof,
    value,
    unit,
    basis,
    excerpt,
    ...(typeof original === 'string' ? { valueExcerpt: original } : original),
  };
}

function fixtureProduct(sourceProof, manufacturerApproved) {
  const { reviewedAt } = sourceProof;
  const product = {
    id: 'gift-product',
    title: 'Factory Chocolate Isolate 1kg',
    url: 'https://www.lazada.vn/products/pdp-i100.html?skuId=11',
    brand: 'Factory',
    market: 'VN',
    category: 'whey',
    netMassG: 1000,
    packCount: 1,
    proteinPer100g: 80,
    sugarPer100g: 0,
    fatPer100g: 1,
    saturatedFatPer100g: 0,
    kcalPer100g: 400,
    ingredients: ['whey protein isolate', 'cocoa'],
    evidenceIds: [makerId],
  };
  if (manufacturerApproved) {
    product.manufacturerVerification = {
      identityMatched: true,
      sourceAuthority: 'manufacturer',
      identityMethod: 'visual-exact-variant',
      evidenceId: makerId,
      sourceUrl: officialUrl,
      checkedAt: reviewedAt,
      reviewId,
    };
    product.claims = [...REQUIRED_SPEC_FIELDS, 'packCount'].map((field) => ({
      field,
      value: product[field],
      evidenceId: makerId,
      sourceEvidenceId: makerId,
      source: 'manufacturer',
      requiresReview: false,
      excerpt: excerpts[field],
      reviewedBy: sourceProof.reviewedBy,
      reviewedAt,
      reviewId,
    }));
  }
  return product;
}

function fixtureComponent(
  product,
  sourceProof,
  eligibilityProof,
  checkoutText,
  counts,
  observedAt
) {
  const identity = {
    brand: product.brand,
    name: 'Chocolate Isolate',
    flavour: 'chocolate',
    market: 'VN',
    packageType: 'bag',
    formulaRevision: 'CURRENT-V1',
    variantCode: 'CHOC-1000',
    netMassG: 1000,
    innerPackCount: 1,
    currentFormula: true,
  };
  const component = {
    id: 'gift-line',
    kind: 'bonus-food',
    product,
    identity,
    sourceIdentity: { ...identity },
    evidenceIds: [makerId, checkoutId],
    review: {
      ...sourceProof,
      identityMatched: true,
      excerpt: excerpts.identity,
    },
    facts: {
      netMassG: sourcedFact(
        1000,
        'g',
        'one-inner-food-package',
        sourceProof,
        excerpts.netMassG,
        '1000 g'
      ),
      proteinPer100g: sourcedFact(
        80,
        'g/100g',
        'per-100g',
        sourceProof,
        excerpts.proteinPer100g,
        { valueExcerpt: '80 g', basisExcerpt: 'Per 100 g' }
      ),
    },
    eligibility: {
      allocationId: 'physical-gift-1',
      offerId: 'offer-1',
      sku: '100_VNAMZ-11',
      ...counts,
      confirmed: true,
      available: true,
      conditionsComplete: true,
      conditionsSatisfied: true,
      observedAt,
      claims: Object.fromEntries(
        Object.entries(counts).map(([field, value]) => [
          field,
          sourcedFact(
            value,
            'count',
            ['orderQuantity', 'minOrderQuantity', 'maxOrderQuantity'].includes(
              field
            )
              ? 'paid-selling-unit'
              : 'inner-food-package',
            eligibilityProof,
            checkoutText,
            `${value} units`
          ),
        ])
      ),
    },
  };
  return component;
}

async function fixture(t, { manufacturerApproved = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'food-originals-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const observedAt = new Date(Date.now() - 10000).toISOString();
  const reviewedAt = new Date(Date.now() - 1000).toISOString();
  const makerText = Object.values(excerpts).join('\n');
  const makerBlob = await store.putBlob(
    Buffer.from(
      `<html><body>${Object.values(excerpts)
        .map((text) => `<p>${text}</p>`)
        .join('')}</body></html>`
    )
  );
  const counts = {
    orderQuantity: 1,
    minOrderQuantity: 1,
    maxOrderQuantity: 5,
    units: 1,
    stockUnits: 4,
    maxUnitsPerOrder: 1,
  };
  const checkoutText = `Selected SKU: 100_VNAMZ-11; ${Object.entries(counts)
    .map(([field, value]) => `${field}: ${value} units`)
    .join('; ')}; gift conditions reviewed`;
  const checkoutBlob = await store.putBlob(Buffer.from(checkoutText));
  const sourceProof = {
    sourceUrl: officialUrl,
    sourceSha256: makerBlob.sha256,
    evidenceId: makerId,
    reviewedBy: 'Exact package reviewer',
    reviewedAt,
  };
  const eligibilityProof = {
    ...sourceProof,
    sourceUrl: checkoutUrl,
    sourceSha256: checkoutBlob.sha256,
    evidenceId: checkoutId,
  };
  const product = fixtureProduct(sourceProof, manufacturerApproved);
  const component = fixtureComponent(
    product,
    sourceProof,
    eligibilityProof,
    checkoutText,
    counts,
    observedAt
  );
  const identity = component.identity;
  const offer = {
    id: 'offer-1',
    productId: 'paid-product',
    sku: '100_VNAMZ-11',
    url: 'https://www.lazada.vn/products/pdp-i100.html?skuId=11',
    market: 'VN',
    currency: 'VND',
    price: 1790000,
    available: true,
    variantConfirmed: true,
    observedAt,
    foodComponents: [component],
  };
  const paidProduct = { ...product, id: offer.productId, packCount: 2 };
  const makerEvidence = {
    id: makerId,
    url: officialUrl,
    role: 'manufacturer-supplied-by-operator',
    html: makerBlob,
    observedAt,
  };
  const checkoutEvidence = {
    id: checkoutId,
    sourceUrl: checkoutUrl,
    role: 'checkout',
    blob: checkoutBlob,
    contentType: 'text/plain',
    observedAt,
  };
  await store.put('evidence', makerEvidence);
  await store.put('evidence', checkoutEvidence);
  await store.put('product', product);
  await store.put('manufacturer-review', {
    id: reviewId,
    productId: product.id,
    evidenceId: makerId,
    identityMatched: true,
    identityMethod: 'visual-exact-variant',
    sourceAuthority: 'manufacturer',
    manufacturerUrl: officialUrl,
    reviewedBy: sourceProof.reviewedBy,
    checkedAt: reviewedAt,
    identity: { manufacturer: { ...identity, packCount: 1 } },
  });
  const options = {
    now: Date.now(),
    requireManufacturer: manufacturerApproved,
    requireShipping: false,
  };
  return {
    store,
    component,
    offer,
    product,
    paidProduct,
    options,
    observedAt,
    reviewedAt,
    makerEvidence,
    checkoutEvidence,
    makerText,
    makerBlob,
    checkoutBlob,
  };
}

const validated = (record, options = {}) =>
  validateFoodComponentEvidence(record.store, [record.offer], {
    manufacturerRegistry: registry,
    ...options,
  });
const reasons = (offers) =>
  offers[0].foodComponents[0].evidenceValidation.reasons.join('\n');

test('offers without bonus food clone without reading source storage', async () => {
  const offers = [
    { id: 'plain', foodComponents: [{ id: 'shaker', kind: 'non-food' }] },
  ];
  const result = await validateFoodComponentEvidence({}, offers);
  assert.deepEqual(result, offers);
  assert.notEqual(result, offers);
  assert.notEqual(result[0].foodComponents, offers[0].foodComponents);
});

test('a syntactically valid invented SHA and evidence ID cannot increase the food denominator', async (t) => {
  const record = await fixture(t);
  assert.equal(
    calculateOffer(record.paidProduct, record.offer, record.options).metrics
      .totalMassG,
    3000
  );
  record.component.review.evidenceId = 'invented-evidence';
  record.component.review.sourceSha256 = 'a'.repeat(64);
  record.component.evidenceIds.push('invented-evidence');
  const result = await validated(record);
  assert.match(reasons(result), /stored evidence/u);
  const metrics = calculateOffer(
    record.paidProduct,
    result[0],
    record.options
  ).metrics;
  assert.equal(metrics.totalMassG, 2000);
  assert.equal(metrics.totalProteinG, 1600);
  assert.equal(metrics.foodComponents.potentialBonuses.length, 1);
  assert.equal(record.component.review.invalidated, undefined);
});

test('real primary HTML, plain checkout originals and stored exact manufacturer approvals confirm once without writes', async (t) => {
  const record = await fixture(t);
  const before = await record.store.list('evidence');
  const original = globalThis.structuredClone(record.offer);
  const result = await validated(record);
  assert.equal(
    result[0].foodComponents[0].evidenceValidation.status,
    'originals-validated',
    reasons(result)
  );
  assert.equal(
    calculateOffer(record.paidProduct, result[0], record.options).metrics
      .totalMassG,
    3000
  );
  assert.deepEqual(record.offer, original);
  assert.deepEqual(await record.store.list('evidence'), before);
  assert.ok(
    result[0].foodComponents[0].evidenceValidation.sources.some(
      (source) => source.sourceSha256 === record.makerBlob.sha256
    )
  );
});

test('source URL, attachment digest, missing original and invented excerpt mismatches each quarantine the gift', async (t) => {
  const mutations = [
    (record) => {
      record.component.review.sourceUrl = 'https://factory.example/other';
    },
    (record) => {
      record.component.facts.netMassG.sourceSha256 = '0'.repeat(64);
    },
    async (record) => {
      await record.store.put('evidence', {
        ...record.makerEvidence,
        html: { sha256: 'f'.repeat(64) },
      });
      record.component.review.sourceSha256 = 'f'.repeat(64);
    },
    (record) => {
      record.component.facts.proteinPer100g.excerpt = 'Per 100 g Protein: 90 g';
    },
    (record) => {
      record.component.evidenceIds = [checkoutId];
    },
  ];
  for (const mutate of mutations) {
    const record = await fixture(t);
    await mutate(record);
    const result = await validated(record);
    assert.equal(result[0].foodComponents[0].invalidated, true);
    assert.equal(
      calculateOffer(record.paidProduct, result[0], record.options).metrics
        .totalMassG,
      2000
    );
  }
});

test('real evidence and cache invalidations remain effective after a fresh cache replaces the original', async (t) => {
  const record = await fixture(t);
  const invalidatedAt = new Date(
    Date.parse(record.observedAt) + 1000
  ).toISOString();
  await record.store.put('invalidation', {
    id: officialUrl,
    url: officialUrl,
    invalidatedAt,
  });
  await record.store.put('cache', {
    id: `manufacturer:${officialUrl}`,
    url: officialUrl,
    html: record.makerBlob,
    fetchedAt: Date.now(),
  });
  assert.match(reasons(await validated(record)), /invalidated/u);
  await record.store.put('invalidation', {
    id: officialUrl,
    url: officialUrl,
    invalidatedAt: new Date(Date.parse(record.observedAt) - 1000).toISOString(),
  });
  assert.equal(
    (await validated(record))[0].foodComponents[0].evidenceValidation.status,
    'originals-validated'
  );
  await record.store.put('evidence', {
    ...record.checkoutEvidence,
    invalidatedAt,
  });
  assert.match(reasons(await validated(record)), /invalidated/u);
});

test('missing or future capture times and caller-refreshed stock cannot replace a real observation', async (t) => {
  const mutations = [
    async (record) => {
      const source = { ...record.checkoutEvidence };
      delete source.observedAt;
      await record.store.put('evidence', source);
    },
    async (record) => {
      await record.store.put('evidence', {
        ...record.checkoutEvidence,
        observedAt: new Date(Date.now() + 120000).toISOString(),
      });
    },
    (record) => {
      record.component.eligibility.observedAt = record.reviewedAt;
    },
    (record) => {
      record.component.review.reviewedAt = new Date(
        Date.parse(record.observedAt) - 1
      ).toISOString();
    },
  ];
  for (const mutate of mutations) {
    const record = await fixture(t);
    await mutate(record);
    assert.equal(
      (await validated(record))[0].foodComponents[0].evidenceValidation.status,
      'unconfirmed'
    );
  }
});

test('another SKU cannot borrow original checkout gift counts even when all caller fields agree', async (t) => {
  const record = await fixture(t);
  record.offer.sku = '100_VNAMZ-12';
  record.component.eligibility.sku = record.offer.sku;
  assert.match(reasons(await validated(record)), /exact selected SKU/u);
});

test('untrusted roles and redirects cannot claim manufacturer authority; custom registry and identity guards apply', async (t) => {
  const record = await fixture(t);
  const defaultResult = await validateFoodComponentEvidence(record.store, [
    record.offer,
  ]);
  assert.match(reasons(defaultResult), /trusted bonus brand/u);
  await record.store.put('cache', {
    id: `manufacturer:${officialUrl}`,
    url: officialUrl,
    finalUrl: 'https://retailer.example/label',
    html: record.makerBlob,
    fetchedAt: Date.parse(record.observedAt),
  });
  assert.match(reasons(await validated(record)), /trusted bonus brand/u);
  await record.store.put('cache', {
    id: `manufacturer:${officialUrl}`,
    url: officialUrl,
    finalUrl: officialUrl,
    html: record.makerBlob,
    fetchedAt: Date.parse(record.observedAt),
  });
  record.component.product.brand = 'Other factory';
  record.component.product.title = 'Other factory chocolate whey';
  assert.match(reasons(await validated(record)), /trusted bonus brand/u);
});

test('caller-only approval, contradictory stored fields and invalidated operator reviews cannot become factory verified', async (t) => {
  const mutations = [
    (record) => {
      record.component.product.id = 'invented-product';
    },
    async (record) => {
      await record.store.put('product', { ...record.product, netMassG: 900 });
    },
    async (record) => {
      const review = await record.store.get('manufacturer-review', reviewId);
      await record.store.put('manufacturer-review', {
        ...review,
        invalidated: true,
      });
    },
    async (record) => {
      const review = await record.store.get('manufacturer-review', reviewId);
      await record.store.put('manufacturer-review', {
        ...review,
        identity: {
          manufacturer: {
            ...record.component.sourceIdentity,
            flavour: 'vanilla',
          },
        },
      });
    },
    async (record) => {
      await record.store.put('product', {
        ...record.product,
        pendingSpecificationReview: ['netMassG'],
      });
    },
  ];
  for (const mutate of mutations) {
    const record = await fixture(t);
    await mutate(record);
    assert.match(reasons(await validated(record)), /manufacturer:/u);
  }
});

test('source-backed reference components retain evidence without acquiring manufacturer approval', async (t) => {
  const record = await fixture(t, { manufacturerApproved: false });
  const result = await validated(record);
  assert.equal(
    result[0].foodComponents[0].evidenceValidation.status,
    'originals-validated'
  );
  assert.equal(
    result[0].foodComponents[0].product.manufacturerVerification,
    undefined
  );
  assert.equal(
    calculateOffer(record.paidProduct, result[0], record.options).metrics
      .totalMassG,
    3000
  );
  assert.equal(
    calculateOffer(record.paidProduct, result[0], {
      ...record.options,
      requireManufacturer: true,
    }).metrics.totalMassG,
    2000
  );
});

function tsv(text) {
  return `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t100\t20\t95\t${text}\n`;
}

async function labelSource(record, { withOcr = true } = {}) {
  const bytes = await readFile(
    new URL(
      '../docs/acceptance/ice-dual-units/expanded-hd-sg-belgian-label.png',
      import.meta.url
    )
  );
  assert.equal(
    sha256(bytes),
    '67907ce23aa9ff33a8431ad6ebe68289d842ab83f14586abf9d5ac7a5ab3c9e8'
  );
  const image = await record.store.putBlob(bytes);
  const id = 'original-label';
  const url = 'https://factory.example/label.png';
  await record.store.put('evidence', {
    id,
    role: 'ocr',
    url,
    image,
    ocrId: withOcr ? 'label-ocr' : undefined,
    observedAt: record.observedAt,
  });
  if (withOcr) {
    await record.store.put('ocr', {
      id: 'label-ocr',
      imageHash: image.sha256,
      engine: 'tesseract fixture engine',
      text: 'Protein 4.5 g',
      rawTsv: await record.store.putBlob(Buffer.from(tsv('Protein 4.5 g'))),
      observedAt: record.reviewedAt,
    });
  }
  record.component.evidenceIds.push(id);
  record.component.facts.proteinPer100g = {
    ...record.component.facts.proteinPer100g,
    evidenceId: id,
    sourceUrl: url,
    sourceSha256: image.sha256,
    excerpt: 'Protein 4.5 g',
    valueExcerpt: '4.5 g',
    value: 4.5,
  };
  return { image, id, url };
}

test('binary originals require preserved OCR, and SHA/TSV text corruption cannot be hidden in caller excerpts', async (t) => {
  const record = await fixture(t, { manufacturerApproved: false });
  await labelSource(record);
  assert.equal(
    (await validated(record))[0].foodComponents[0].evidenceValidation.status,
    'originals-validated'
  );
  const original = await record.store.get('ocr', 'label-ocr');
  await record.store.put('ocr', { ...original, text: 'Protein 45 g' });
  assert.match(reasons(await validated(record)), /preserved original TSV/u);
  await record.store.put('ocr', { ...original, imageHash: '0'.repeat(64) });
  assert.match(reasons(await validated(record)), /preserved original image/u);
  await record.store.put('ocr', {
    ...original,
    rawTsv: { sha256: 'f'.repeat(64) },
  });
  assert.match(reasons(await validated(record)), /missing or corrupt/u);
});

test('a binary-label excerpt cannot pretend to be original text without bound OCR or stored visual claims', async (t) => {
  const record = await fixture(t, { manufacturerApproved: false });
  await labelSource(record, { withOcr: false });
  assert.match(reasons(await validated(record)), /Binary source needs/u);
  assert.equal(record.component.facts.proteinPer100g.invalidated, undefined);
});

test('an exact stored visual claim accepts its original label only when the manufacturer page publishes that image', async (t) => {
  // Factory.example is an isolated provenance harness, not a real SKU approval.
  // The unchanged committed label genuinely prints the reviewed 4.5 g value.
  const record = await fixture(t);
  const { image, id, url } = await labelSource(record, { withOcr: false });
  record.product.proteinPer100g = 4.5;
  record.product.evidenceIds.push(id);
  record.product.claims = record.product.claims.map((claim) =>
    claim.field === 'proteinPer100g'
      ? {
          ...claim,
          value: 4.5,
          sourceEvidenceId: id,
          excerpt: record.component.facts.proteinPer100g.excerpt,
        }
      : claim
  );
  await record.store.put('product', record.product);
  const page = {
    id: `manufacturer:${officialUrl}`,
    url: officialUrl,
    finalUrl: officialUrl,
    html: record.makerBlob,
    fetchedAt: Date.parse(record.observedAt),
    snapshot: { productImages: [{ url }] },
  };
  await record.store.put('cache', page);
  const before = globalThis.structuredClone(record.offer);
  const result = await validated(record);
  assert.equal(
    result[0].foodComponents[0].evidenceValidation.status,
    'originals-validated',
    reasons(result)
  );
  assert.ok(
    result[0].foodComponents[0].evidenceValidation.sources.some(
      (source) =>
        source.field === 'proteinPer100g' &&
        source.evidenceId === id &&
        source.sourceSha256 === image.sha256
    )
  );
  assert.equal(await record.store.get('ocr', 'label-ocr'), undefined);
  assert.deepEqual(record.offer, before);

  await record.store.put('cache', {
    ...page,
    snapshot: { productImages: ['https://factory.example/another-label.png'] },
  });
  assert.match(reasons(await validated(record)), /not published/u);
  await record.store.put('cache', page);
  await record.store.put('product', {
    ...record.product,
    claims: record.product.claims.map((claim) =>
      claim.field === 'proteinPer100g' ? { ...claim, excerpt: '45 g' } : claim
    ),
  });
  assert.match(reasons(await validated(record)), /Binary source needs/u);
});

test('a preserved real decimal-recovery crop validates through its original image, transform and original OCR ancestry', async (t) => {
  const record = await fixture(t, { manufacturerApproved: false });
  const { image, id } = await labelSource(record, { withOcr: false });
  const [replayBytes, baselineBytes, originalTsv, croppedImage, croppedTsv] =
    await Promise.all(
      [
        'decimal-ocr/replay.json',
        'manufacturer-research/second-ocr-pass.json',
        'decimal-ocr/original-psm11.tsv',
        'decimal-ocr/protein-per100g-crop.png',
        'decimal-ocr/protein-per100g-crop.tsv',
      ].map((path) =>
        readFile(new URL(`../docs/acceptance/${path}`, import.meta.url))
      )
    );
  const replay = JSON.parse(replayBytes);
  const cropped = replay.rows.find(
    (row) => row.role === 'protein-per100g'
  ).result;
  const original = JSON.parse(baselineBytes).find(
    (entry) => entry.id === cropped.imageTransform.sourceOcr.id
  );
  for (const [bytes, reference] of [
    [originalTsv, original.rawTsv],
    [croppedImage, cropped.derivedImage],
    [croppedTsv, cropped.rawTsv],
  ]) {
    assert.equal(sha256(bytes), reference.sha256);
    assert.deepEqual(await record.store.putBlob(bytes), reference);
  }
  assert.equal(cropped.originalImageHash, image.sha256);
  assert.equal(parseTsv(originalTsv.toString()).text, original.text);
  assert.match(original.text, /Protein\n45g\n40g/u);
  assert.equal(parseTsv(croppedTsv.toString()).text, '4.5');
  await record.store.put('ocr', original);
  await record.store.put('ocr', cropped);
  await record.store.put('image-transform', cropped.imageTransform);
  const evidence = await record.store.get('evidence', id);
  await record.store.put('evidence', {
    ...evidence,
    observedAt: original.observedAt,
  });
  Object.assign(record.component.facts.proteinPer100g, {
    ocrId: cropped.id,
    excerpt: '4.5',
    valueExcerpt: '4.5',
  });
  const before = globalThis.structuredClone(record.offer);
  const result = await validated(record);
  assert.equal(
    result[0].foodComponents[0].evidenceValidation.status,
    'originals-validated',
    reasons(result)
  );
  assert.equal(
    result[0].foodComponents[0].product.manufacturerVerification,
    undefined
  );
  assert.equal(
    calculateOffer(record.paidProduct, result[0], {
      ...record.options,
      requireManufacturer: true,
    }).metrics.totalMassG,
    2000
  );
  assert.deepEqual(record.offer, before);
  assert.deepEqual(
    await record.store.blob(image.sha256),
    await readFile(
      new URL(
        '../docs/acceptance/ice-dual-units/expanded-hd-sg-belgian-label.png',
        import.meta.url
      )
    )
  );

  await record.store.put('image-transform', {
    ...cropped.imageTransform,
    originalImage: {
      ...cropped.imageTransform.originalImage,
      sha256: '0'.repeat(64),
    },
  });
  assert.match(reasons(await validated(record)), /preserved original image/u);
  await record.store.put('image-transform', cropped.imageTransform);
  await record.store.put('ocr', {
    ...original,
    rawTsv: { ...original.rawTsv, sha256: 'f'.repeat(64) },
  });
  assert.match(reasons(await validated(record)), /original OCR provenance/u);
  await record.store.put('ocr', original);
  await record.store.put('ocr', { ...cropped, text: '45' });
  assert.match(reasons(await validated(record)), /preserved original TSV/u);
});

test('the actual cached decimal-loss TSV cannot be relabelled as a corrected original excerpt', async (t) => {
  const record = await fixture(t, { manufacturerApproved: false });
  const { image } = await labelSource(record);
  const original = await readFile(
    new URL(
      '../docs/acceptance/decimal-ocr/original-psm11.tsv',
      import.meta.url
    )
  );
  assert.equal(
    sha256(original),
    '0ce3ceffc726fd6299cfad3a7ced6d9166fe5f7e93600f5f03dce533a6e416c3'
  );
  await record.store.put('ocr', {
    id: 'label-ocr',
    imageHash: image.sha256,
    engine: 'preserved original Tesseract pass',
    rawTsv: await record.store.putBlob(original),
    ...parseTsv(original.toString('utf8')),
    observedAt: record.reviewedAt,
  });
  assert.match(reasons(await validated(record)), /absent from the original/u);
});

test('application comparisons apply the stored-original gate and retain the paid-only denominator for invented gift evidence', async (t) => {
  const record = await fixture(t);
  const app = new LazadaSearch({
    store: record.store,
    offline: true,
    ocr: false,
    manufacturerRegistry: registry,
  });
  record.component.review.evidenceId = 'invented-evidence';
  record.component.evidenceIds.push('invented-evidence');
  await app.importRecords({
    products: [record.paidProduct],
    offers: [record.offer],
  });
  const report = await app.compare({
    ...record.options,
    requireManufacturer: false,
  });
  const row = report.comparisons.find(
    (entry) => entry.offer.id === record.offer.id
  );
  assert.ok(row);
  assert.equal(row.metrics.totalMassG, 2000);
  assert.equal(row.metrics.totalProteinG, 1600);
  assert.equal(row.metrics.foodComponents.confirmedBonuses.length, 0);
  assert.equal(row.metrics.foodComponents.potentialBonuses.length, 1);
  assert.equal(
    (await record.store.get('offer', record.offer.id)).foodComponents[0].review
      .invalidated,
    undefined
  );
});
