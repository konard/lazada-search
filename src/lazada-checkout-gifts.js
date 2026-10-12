import { clone, sha256 } from './util.js';
import { normalizeText } from './text.js';
import { parseHTML } from 'linkedom';
import { extractBasketQuote } from './basket-quote.js';
import { checkoutField } from './lazada-checkout-fields.js';
import { discoverFoodOfferSourceBasis } from './food-offer-source-basis.js';
import { validateFoodComponentEvidence } from './food-component-evidence.js';
import { accountFoodComponents } from './food-components.js';
import { extractCheckoutLineBinding } from './lazada-checkout-line-bindings.js';

/** Original gift text is retained as potential until all existing fact gates pass. */
export function discoverLazadaCheckoutFoodGifts(
  html,
  mapping,
  { giftMappings = [], products = [], offers = [] } = {}
) {
  const quote = extractBasketQuote(html, mapping);
  const { document } = parseHTML(Buffer.from(html).toString('utf8'));
  const results = [];
  if (!Array.isArray(giftMappings) || giftMappings.length > 100) {
    throw new Error(
      'Checkout gift discovery needs at most 100 reviewed source mappings'
    );
  }
  for (const gift of giftMappings) {
    const line = quote.lines.find(
      (entry) => entry.offerId === gift.offerId && entry.sku === gift.sku
    );
    const offer = offers.find(
      (entry) => entry.id === line?.offerId && entry.sku === line?.sku
    );
    const product = products.find((entry) => entry.id === offer?.productId);
    if (!line || !offer || !product) {
      results.push({
        offerId: gift.offerId,
        status: 'potential',
        reasons: [
          'Gift source has no exact selected paid offer and stored product',
        ],
      });
      continue;
    }
    const original = checkoutField(
      document,
      gift.selector,
      'original checkout gift text'
    );
    const sourceLine = mapping.lines.find(
      (entry) => entry.offerId === line.offerId
    );
    const sourceIdentity = extractCheckoutLineBinding(document, sourceLine);
    if (
      !sourceIdentity ||
      !sourceIdentity.row.contains(document.querySelector(gift.selector))
    ) {
      throw new Error(
        'Original gift statement must belong to its exact identity-bound selected paid row'
      );
    }
    const discovery = discoverFoodOfferSourceBasis(
      {
        url: mapping.sourceUrl,
        sku: line.sku,
        selectedVariant: [
          { selected: true, sku: line.sku, text: original.text },
        ],
      },
      {
        product,
        offer,
        evidence: {
          id: mapping.evidenceId,
          sourceUrl: mapping.sourceUrl,
          html: { sha256: mapping.sourceSha256 },
          observedAt: mapping.observedAt,
        },
      }
    );
    results.push({
      offerId: line.offerId,
      sku: line.sku,
      orderQuantity: line.quantity,
      originalText: original.text,
      selector: gift.selector,
      status: 'potential',
      components: discovery.foodComponents,
      reasons: [
        'Exact food identity, current manufacturer quantities, nutrition, allocation, eligibility and stock still require original proofs',
      ],
      sourceEvidenceId: mapping.evidenceId,
      sourceSha256: mapping.sourceSha256,
      observedAt: mapping.observedAt,
      factualApprovalGranted: false,
    });
  }
  return results;
}

async function checkedObservation(application, observationId) {
  if (application.store.visibility !== 'private') {
    throw new Error(
      'Account checkout gift originals and eligibility remain private'
    );
  }
  const observation = await application.store.get(
    'checkout-adapter',
    observationId
  );
  const mapping = observation?.mapping;
  const evidence =
    mapping && (await application.store.get('evidence', mapping.evidenceId));
  const bytes =
    evidence?.html && (await application.store.blob(evidence.html.sha256));
  const invalidations = await application.store.list('invalidation');
  if (
    observation?.status !== 'mapping-ready' ||
    !mapping ||
    !bytes ||
    sha256(bytes) !== mapping.sourceSha256 ||
    evidence.html.sha256 !== mapping.sourceSha256 ||
    evidence.invalidated ||
    evidence.invalidatedAt ||
    evidence.sourceUrl !== mapping.sourceUrl ||
    evidence.observedAt !== mapping.observedAt ||
    invalidations.some(
      (item) =>
        (item.url === mapping.sourceUrl ||
          item.evidenceIds?.includes(evidence.id)) &&
        (item.invalidated ||
          !Number.isFinite(Date.parse(item.invalidatedAt)) ||
          Date.parse(item.invalidatedAt) >= Date.parse(mapping.observedAt))
    )
  ) {
    throw new Error(
      'Gift acquisition needs a matching accessible non-invalidated exact original prepared checkout'
    );
  }
  return {
    observation,
    mapping,
    bytes,
    quote: extractBasketQuote(bytes, mapping),
  };
}

export async function importLazadaCheckoutFoodGiftDiscovery(
  application,
  input
) {
  const { mapping, bytes } = await checkedObservation(
    application,
    input.observationId
  );
  const offers = await application.store.list('offer');
  const products = await application.store.list('product');
  const observations = discoverLazadaCheckoutFoodGifts(bytes, mapping, {
    giftMappings: input.giftMappings,
    offers,
    products,
  });
  const record = await application.store.put('checkout-food-gift-discovery', {
    id: `checkout-gift-discovery:${sha256(JSON.stringify([input.observationId, input.giftMappings]))}`,
    observationId: input.observationId,
    observedAt: mapping.observedAt,
    sourceEvidenceId: mapping.evidenceId,
    sourceSha256: mapping.sourceSha256,
    observations,
    visibility: 'private',
    factualApprovalGranted: false,
    acceptanceStatus: 'draft-unexecuted-gift-discovery',
  });
  for (const row of observations) {
    if (!row.components?.length) {
      continue;
    }
    const offer = offers.find((candidate) => candidate.id === row.offerId);
    const merged = new Map(
      (offer.foodComponents || []).map((component) => [component.id, component])
    );
    for (const component of row.components) {
      if (!merged.has(component.id)) {
        merged.set(component.id, component);
      }
    }
    await application.store.put('offer', {
      ...offer,
      foodComponents: [...merged.values()],
    });
  }
  return record;
}

function checkoutEligibility(component, mapping, line) {
  const eligibility = component.eligibility;
  if (
    !eligibility ||
    eligibility.offerId !== line.offerId ||
    eligibility.sku !== line.sku ||
    eligibility.orderQuantity !== line.quantity ||
    eligibility.observedAt !== mapping.observedAt
  ) {
    throw new Error(
      'Gift eligibility must identify the exact original checkout selected offer, SKU and quantity'
    );
  }
  for (const field of [
    'orderQuantity',
    'minOrderQuantity',
    'maxOrderQuantity',
    'units',
    'stockUnits',
    'maxUnitsPerOrder',
  ]) {
    const proof = eligibility.claims?.[field];
    if (
      proof?.evidenceId !== mapping.evidenceId ||
      proof.sourceSha256 !== mapping.sourceSha256 ||
      proof.sourceUrl !== mapping.sourceUrl
    ) {
      throw new Error(
        `Gift ${field} proof requires the exact original checkout`
      );
    }
  }
}

export async function acquireLazadaCheckoutFoodGifts(application, input) {
  const { mapping, quote } = await checkedObservation(
    application,
    input.observationId
  );
  const line = quote.lines.find((entry) => entry.offerId === input.offerId);
  const offer = await application.store.get('offer', input.offerId);
  const product =
    offer && (await application.store.get('product', offer.productId));
  if (
    !line ||
    !offer ||
    offer.sku !== line.sku ||
    !product ||
    typeof input.reviewedBy !== 'string' ||
    !normalizeText(input.reviewedBy)
  ) {
    throw new Error(
      'Gift acquisition needs one exact stored selected checkout offer, product and explicit reviewer'
    );
  }
  if (
    !Array.isArray(input.components) ||
    !input.components.length ||
    input.components.length > 100
  ) {
    throw new Error(
      'Gift acquisition needs between one and 100 explicit food components'
    );
  }
  if (
    new Set(input.components.map((component) => component.id)).size !==
    input.components.length
  ) {
    throw new Error(
      'A gift component may be allocated only once in one acquisition'
    );
  }
  const maxPromotionAgeMs = input.maxPromotionAgeMs ?? 86400000;
  if (
    !Number.isSafeInteger(maxPromotionAgeMs) ||
    maxPromotionAgeMs < 1 ||
    maxPromotionAgeMs > 86400000
  ) {
    throw new Error(
      'Gift eligibility freshness must be within one day of its original checkout'
    );
  }
  const components = clone(input.components);
  const observations = [];
  for (const component of components) {
    if (component.kind !== 'bonus-food') {
      throw new Error(
        'This food-gift acquisition path only reviews bonus food; accessories never increase food quantities'
      );
    }
    checkoutEligibility(component, mapping, line);
  }
  const candidate = { ...clone(offer), foodComponents: components };
  const [validated] = await validateFoodComponentEvidence(application.store, [
    candidate,
  ]);
  const accounting = accountFoodComponents(product, validated, {
    quantity: line.quantity,
    market: 'vn',
    flavourScope: 'chocolate-or-unflavoured',
    requireManufacturer: true,
    maxPromotionAgeMs,
  });
  const confirmedIds = new Set(
    accounting.confirmedBonuses.map((component) => component.id)
  );
  for (const component of validated.foodComponents) {
    component.status = confirmedIds.has(component.id)
      ? 'confirmed'
      : 'potential';
    observations.push({
      id: component.id,
      status: component.status,
      evidenceValidation: component.evidenceValidation,
      reasons:
        accounting.potentialBonuses.find((bonus) => bonus.id === component.id)
          ?.reasons || [],
    });
    if (component.status !== 'confirmed') {
      component.eligibility = { ...component.eligibility, confirmed: false };
    }
  }
  const merged = new Map(
    (offer.foodComponents || []).map((component) => [component.id, component])
  );
  for (const component of validated.foodComponents) {
    merged.set(component.id, component);
  }
  await application.store.put('offer', {
    ...offer,
    foodComponents: [...merged.values()],
  });
  return application.store.put('checkout-food-gift-review', {
    id: `checkout-gift-review:${sha256(JSON.stringify([input.observationId, input.offerId, validated.foodComponents]))}`,
    observationId: input.observationId,
    offerId: offer.id,
    sku: offer.sku,
    orderQuantity: line.quantity,
    reviewedBy: normalizeText(input.reviewedBy),
    reviewedAt: new Date().toISOString(),
    observedAt: mapping.observedAt,
    sourceEvidenceId: mapping.evidenceId,
    sourceSha256: mapping.sourceSha256,
    observations,
    confirmed: observations.filter(
      (component) => component.status === 'confirmed'
    ).length,
    potential: observations.filter(
      (component) => component.status !== 'confirmed'
    ).length,
    visibility: 'private',
    acceptanceStatus: 'draft-unexecuted-acquisition',
    purchaseReady: false,
  });
}
