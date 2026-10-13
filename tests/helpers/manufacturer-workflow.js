import { EvidenceCache, DomainScheduler } from '../../src/cache.js';
import { sha256 } from '../../src/util.js';
import { workflowProductFingerprint } from '../../src/label-worklist.js';

export class MemoryStore {
  constructor() {
    this.records = new Map();
    this.blobs = new Map();
    this.writes = [];
  }
  get(kind, id) {
    return Promise.resolve(
      globalThis.structuredClone(this.records.get(`${kind}:${id}`))
    );
  }
  list(kind) {
    return Promise.resolve(
      [...this.records.entries()]
        .filter(([key]) => key.startsWith(`${kind}:`))
        .map(([, value]) => globalThis.structuredClone(value))
    );
  }
  put(kind, value) {
    this.records.set(`${kind}:${value.id}`, globalThis.structuredClone(value));
    this.writes.push({ kind, id: value.id });
    return Promise.resolve(globalThis.structuredClone(value));
  }
  putBlob(bytes) {
    const hash = sha256(bytes);
    this.blobs.set(hash, Buffer.from(bytes));
    return Promise.resolve({
      type: 'stored-blob',
      sha256: hash,
      bytes: bytes.length,
    });
  }
  blob(hash) {
    return Promise.resolve(this.blobs.get(hash));
  }
}

export const identity = {
  brand: 'Factory',
  name: 'Chocolate whey',
  flavour: 'chocolate',
  market: 'VN',
  category: 'whey',
  packageType: 'pouch',
  formulaRevision: '2026-label-A',
  gtin: '0123456789012',
  netMassG: 2000,
  innerPackCount: 1,
  currentFormula: true,
};
export const registry = [
  {
    name: 'Factory',
    aliases: ['factory'],
    domains: ['factory.example'],
    url: 'https://factory.example/chocolate',
  },
];

function factCandidates(product, source) {
  const base = {
    productId: product.id,
    sourceId: source.id,
    sourceSha256: source.blob.sha256,
    sourceUrl: source.finalUrl,
    sourceRecordKind: 'manufacturer-source',
    sourceAuthority: 'manufacturer',
    identity,
    identityGaps: [],
    identityMatched: false,
    requiresReview: true,
    approvalStatus: 'candidate-only',
  };
  const protein = {
    ...base,
    id: 'candidate:protein',
    field: 'proteinPer100g',
    value: 80,
    unit: 'g/100g',
    basis: 'per-100g',
    excerpt: 'Protein 80 g per 100g',
    valueExcerpt: '80 g',
    basisExcerpt: 'per 100g',
  };
  const mass = {
    ...base,
    id: 'candidate:mass',
    field: 'netMassG',
    value: 2000,
    unit: 'g',
    basis: 'one-inner-food-package',
    excerpt: 'Net weight 2000 g',
    valueExcerpt: '2000 g',
  };
  return [protein, mass];
}

export async function fixture() {
  const store = new MemoryStore();
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const cache = new EvidenceCache({
    store,
    offline: true,
    scheduler: new DomainScheduler({ intervalMs: 0 }),
  });
  const application = { store, cache, manufacturerRegistry: registry };
  const listing = await store.putBlob(
    Buffer.from(
      '<html><body>Factory Chocolate whey 2000 g, GTIN0123456789012, selected chocolate</body></html>'
    )
  );
  const product = {
    id: 'product:fixture',
    sku: '1_VNAMZ-2',
    title: 'Factory Chocolate whey 2000g',
    brand: 'Factory',
    category: 'whey',
    url: 'https://www.lazada.vn/products/pdp-i1.html?skuId=2',
    observedAt,
    packCount: 1,
    netMassG: 2000,
    ingredients: [],
    claims: [],
    selectedVariant: [{ text: 'Chocolate', selected: true }],
    evidenceIds: ['listing:fixture'],
  };
  await store.put('evidence', {
    id: 'listing:fixture',
    role: 'listing',
    html: listing,
    url: product.url,
    observedAt,
  });
  await store.put('product', product);
  await store.put('offer', {
    id: 'offer:fixture',
    productId: product.id,
    sku: product.sku,
    price: 1000000,
    currency: 'VND',
    url: product.url,
    observedAt,
  });
  const sourceText = JSON.stringify({
    identity,
    label:
      'Net weight 2000 g. Protein 80 g per 100g. Ingredients: Whey protein isolate',
  });
  const blob = await store.putBlob(Buffer.from(sourceText));
  const source = {
    id: 'manufacturer-source:fixture',
    brand: 'Factory',
    authority: 'manufacturer',
    kind: 'page',
    status: 'captured',
    contentType: 'application/json',
    url: 'https://factory.example/chocolate',
    finalUrl: 'https://factory.example/chocolate',
    blob,
    observedAt,
  };
  await store.put('manufacturer-source', source);
  const fingerprint = workflowProductFingerprint(product);
  const item = {
    id: 'label-work:fixture',
    productId: product.id,
    productFingerprint: fingerprint,
    identity,
    originals: [
      {
        evidenceId: 'listing:fixture',
        kind: 'html',
        role: 'listing',
        url: product.url,
        sha256: listing.sha256,
        bytes: listing.bytes,
      },
    ],
    quantityFields: [],
    nutritionFields: ['protein:explicit-label-basis'],
    candidates: [],
    sku: product.sku,
  };
  const [protein, mass] = factCandidates(product, source);
  for (const candidate of [protein, mass]) {
    await store.put('manufacturer-fact-candidate', candidate);
  }
  const draft = {
    id: 'review-draft:nutrition',
    productId: product.id,
    productFingerprint: fingerprint,
    kind: 'nutrition',
    candidates: [protein],
    listingOriginals: item.originals,
  };
  await store.put('manufacturer-review-draft', draft);
  await store.put('manufacturer-review-draft', {
    ...draft,
    id: 'review-draft:quantity',
    kind: 'quantity',
    candidates: [mass],
  });
  const plan = {
    id: 'manufacturer-workflow:fixture',
    items: [item],
    tasks: [
      { reviewDraftId: draft.id },
      { reviewDraftId: 'review-draft:quantity' },
    ],
  };
  await store.put('manufacturer-workflow', plan);
  const packet = {
    workflowId: plan.id,
    reviewDraftId: draft.id,
    productFingerprint: fingerprint,
    reviewedBy: 'Explicit fixture reviewer',
    reason: 'Exact original package and formula matched',
    listingEvidenceId: 'listing:fixture',
    listingSha256: listing.sha256,
    listingIdentity: identity,
    manufacturerIdentity: identity,
    sourceIdentities: { [source.id]: identity },
    candidateIds: [protein.id],
    factoryQuantityCandidateIds: [mass.id],
  };
  store.writes = [];
  return {
    application,
    store,
    product,
    source,
    item,
    draft,
    packet,
    protein,
    mass,
  };
}
