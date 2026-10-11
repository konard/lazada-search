import { readFile } from 'node:fs/promises';
import { sanitizePublicData } from './archive.js';
import { canonicalUrl, sha256 } from './util.js';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;
const digest = (value) => sha256(JSON.stringify(canonical(value)));
const productDigest = (product) =>
  digest(
    Object.fromEntries(
      Object.entries(product).filter(
        ([key]) =>
          ![
            'id',
            'url',
            'observedAt',
            'evidenceIds',
            'claims',
            'warnings',
            'crossChecks',
            'corrections',
            'reviewedFields',
            'manufacturerVerification',
            'ocrCoverage',
            'pendingSpecificationReview',
            'invalidatedSpecificationFields',
            'visibility',
          ].includes(key)
      )
    )
  );

async function pipelineFingerprint() {
  const pending = [
    new URL('./public-captures.js', import.meta.url),
    new URL('./application.js', import.meta.url),
  ];
  const sources = new Map();
  while (pending.length) {
    const url = pending.pop();
    if (sources.has(url.href)) {
      continue;
    }
    const bytes = await readFile(url);
    sources.set(url.href, [url.pathname.split('/').at(-1), sha256(bytes)]);
    for (const match of bytes
      .toString('utf8')
      .matchAll(/(?:from\s*|import\s*\()['"](\.\.?\/[^'"]+\.js)['"]/gu)) {
      pending.push(new URL(match[1], url));
    }
  }
  const parser = await readFile(
    new URL('../package.json', import.meta.resolve('linkedom'))
  );
  return digest({
    modules: [...sources.values()].sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    linkedom: sha256(parser),
    node: process.versions.node,
  });
}

// Bind the receipt to code loaded by this process. Subsequent source edits take
// effect under a new process and cannot relabel an already loaded parser.
const pipeline = pipelineFingerprint();
export const publicationFingerprint = () => pipeline;

function requestedSku(snapshot) {
  const url = new URL(snapshot.url);
  const requested =
    url.searchParams.get('skuId') || url.pathname.match(/-s(\d+)\.html$/u)?.[1];
  const selected = String(
    snapshot.selectedVariant?.find((entry) => entry.sku)?.sku ||
      snapshot.sku ||
      ''
  );
  if (
    !snapshot.sku ||
    (requested &&
      requested.split('_VNAMZ-').at(-1) !== selected.split('_VNAMZ-').at(-1))
  ) {
    throw new Error('The requested SKU and its price were not confirmed');
  }
  return selected;
}

export function publicationSourceContext(
  application,
  capture,
  bytes,
  fingerprint,
  sourceImages = []
) {
  const selectedSku = requestedSku(capture.snapshot);
  if (!bytes?.length || sha256(bytes) !== capture.html.sha256) {
    throw new Error('The captured product HTML digest is invalid or missing');
  }
  if (capture.html.bytes !== undefined && bytes.length !== capture.html.bytes) {
    throw new Error('The captured product HTML length is invalid');
  }
  if (capture.invalidatedAt) {
    throw new Error('Invalidated product source needs an online reload');
  }
  const observed =
    typeof capture.fetchedAt === 'number'
      ? capture.fetchedAt
      : Date.parse(capture.fetchedAt);
  if (!Number.isFinite(observed)) {
    throw new Error(
      'Product publication requires an original observation time'
    );
  }
  const sourceUrl = canonicalUrl(sanitizePublicData(capture.snapshot.url));
  application.assertMarket(sourceUrl);
  const input = {
    sourceHtmlSha256: capture.html.sha256,
    sourceSnapshotSha256: digest(capture.snapshot),
    sourceImageMetadataSha256: digest(sourceImages),
    sourceUrlSha256: sha256(capture.snapshot.url),
    selectedSku,
    observedAt: new Date(observed).toISOString(),
    pipelineFingerprint: fingerprint,
    market: application.market,
    deliveryArea: application.deliveryArea,
    priceContext: capture.priceContext || 'private-profile-browser-observation',
  };
  return { ...input, id: `publication-source:${digest(input)}`, sourceUrl };
}

async function assertPublicHtml(store, publication) {
  const bytes = await store.blob(publication.html.sha256);
  if (!bytes?.length || sha256(bytes) !== publication.html.sha256) {
    throw new Error('Public output HTML digest is invalid or missing');
  }
  if (
    publication.html.bytes !== undefined &&
    bytes.length !== publication.html.bytes
  ) {
    throw new Error('Public output HTML length is invalid');
  }
}

async function currentOutputMatches(store, proof, publication) {
  const offer = await store.get('offer', publication.offerId);
  const product = offer && (await store.get('product', offer.productId));
  if (
    !offer ||
    !product ||
    offer.visibility === 'private' ||
    product.visibility === 'private'
  ) {
    return false;
  }
  const evidence =
    offer.evidenceId && (await store.get('evidence', offer.evidenceId));
  if (
    !evidence?.html ||
    evidence.visibility === 'private' ||
    !product.evidenceIds?.includes(evidence.id)
  ) {
    return false;
  }
  await assertPublicHtml(store, evidence);
  return (
    currentDatesMatch(offer, product, publication) &&
    (Date.parse(product.observedAt) > Date.parse(publication.observedAt) ||
      productDigest(product) === proof.productSha256)
  );
}

function currentDatesMatch(offer, product, publication) {
  const sourceTime = Date.parse(publication.observedAt);
  const offerTime = Date.parse(offer.observedAt);
  const productTime = Date.parse(product.observedAt);
  return (
    offer.sku === publication.sku &&
    product.sku === publication.sku &&
    offer.variantConfirmed &&
    offerTime >= sourceTime &&
    productTime >= sourceTime &&
    (offerTime > sourceTime || offer.price === publication.price)
  );
}

function proofMatches(proof, context) {
  return (
    Boolean(proof) &&
    proof.pipelineFingerprint === context.pipelineFingerprint &&
    proof.sourceHtmlSha256 === context.sourceHtmlSha256 &&
    proof.sourceSnapshotSha256 === context.sourceSnapshotSha256 &&
    proof.observedAt === context.observedAt &&
    proof.sku === context.selectedSku
  );
}

function publicationMatches(publication, proof, context) {
  return (
    Boolean(publication) &&
    digest(publication) === proof.publicationSha256 &&
    publication.sku === proof.sku &&
    publication.price === proof.price &&
    publication.observedAt === context.observedAt &&
    publication.sourceUrl === context.sourceUrl &&
    publication.price > 0 &&
    publication.exactSkuConfirmed === true
  );
}

export async function reusablePublication(application, context) {
  const proof = await application.store.get('publication-source', context.id);
  if (!proofMatches(proof, context)) {
    return undefined;
  }
  if (proof.visibility === 'private') {
    throw new Error('Private publication receipts cannot enter public data');
  }
  const publication = await application.store.get(
    'publication',
    proof.publicationId
  );
  if (publication?.visibility === 'private') {
    throw new Error('Private publication records cannot enter public data');
  }
  if (!publicationMatches(publication, proof, context)) {
    return undefined;
  }
  await assertPublicHtml(application.store, publication);
  return (await currentOutputMatches(application.store, proof, publication))
    ? publication
    : undefined;
}

export async function savePublicationProof(application, context, publication) {
  const offer = await application.store.get('offer', publication.offerId);
  const product = await application.store.get('product', offer.productId);
  return await application.store.put('publication-source', {
    ...context,
    publicationId: publication.id,
    publicationSha256: digest(publication),
    sku: publication.sku,
    price: publication.price,
    productSha256: productDigest(product),
  });
}

// Source collection normally uses the latest listing alias. A publication must
// process its own exact original while atomic chronology protects current data.
export function publicationApplication(application) {
  const state = {};
  const store = new Proxy(application.store, {
    get(target, property) {
      if (property === 'get') {
        return async (kind, id) => {
          if (kind === 'offer' && state.quoting && state.offer?.id === id) {
            return state.offer;
          }
          const record = await target.get(kind, id);
          return kind === 'cache' && record && Number.isFinite(record.fetchedAt)
            ? {
                ...record,
                observedAt: new Date(record.fetchedAt).toISOString(),
              }
            : record;
        };
      }
      if (property === 'put') {
        return (kind, record) => {
          if (kind === 'cache' && Number.isFinite(record.fetchedAt)) {
            if (record.id.startsWith(`lazada:${application.market}:`)) {
              state.page = record;
            }
            return Reflect.apply(target.putLatest, store, [
              kind,
              {
                ...record,
                observedAt: new Date(record.fetchedAt).toISOString(),
              },
            ]);
          }
          return ['sku-inventory', 'evidence'].includes(kind) &&
            record.observedAt
            ? target.putLatest(kind, record)
            : target.put(kind, record);
        };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const view = Object.create(application);
  view.store = store;
  view.collector = {
    page: () => Promise.resolve({ ...state.page, cacheHit: true }),
  };
  view.saveOffer = async (offer) => {
    await application.saveOffer.call(view, offer);
    state.offer = offer;
    return offer;
  };
  view.quote = async (id, input) => {
    state.quoting = true;
    try {
      return await application.quote.call(view, id, input);
    } finally {
      state.quoting = false;
    }
  };
  return { view, state };
}
