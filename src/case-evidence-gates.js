import { sha256 } from './util.js';
import { workflowSourceInvalidated } from './source-invalidation.js';
import {
  capturedPriceFresh,
  exactCapturedDelivery,
} from './captured-offer-gates.js';
import { shoppingCategory } from './shopping-report.js';
import { listingKey } from './text.js';
import {
  selectedPriceOriginalMatches,
  deliveryOriginalMatches,
} from './captured-offer-original.js';

const nonemptyEvery = (rows, check) => rows.length > 0 && rows.every(check);
const rateKnown = (value) => Number.isFinite(value) && value >= 0;

/** Mixed-basket freight stays on its basket; only one-line quotes price a SKU. */
export function readinessComparisons(comparison, baskets, quantity) {
  const rows = new Map(
    comparison.comparisons.map((row) => [row.offer.id, row])
  );
  for (const basket of baskets.ranked) {
    if (
      basket.quote.lines.length !== 1 ||
      basket.quote.lines[0].quantity !== quantity ||
      basket.lines.length !== 1
    ) {
      continue;
    }
    const row = basket.lines[0];
    const shipping =
      basket.metrics.totalAfterDelivery - basket.metrics.totalBeforeDelivery;
    const replacement = {
      ...row,
      eligible: true,
      problems: [],
      offer: {
        ...row.offer,
        shippingInvalidated: false,
        quoteEvidenceId: basket.quote.evidenceId,
        quoteObservedAt: basket.quote.observedAt,
        shipping,
        shippingQuantity: quantity,
        deliveryArea: basket.quote.deliveryArea,
        shippingDestination: basket.quote.shippingDestination,
        coldChainConfirmed: basket.quote.coldChainConfirmed,
      },
      metrics: { ...row.metrics, ...basket.metrics, quantity, shipping },
      sourceQuoteId: basket.quote.id,
      originalSourceBindings: {
        sourceSha256: basket.quote.sourceSha256,
        sourceUrl: basket.quote.sourceUrl,
      },
    };
    const previous = rows.get(row.offer.id);
    if (
      !previous?.eligible ||
      replacement.metrics.totalAfterDelivery <
        previous.metrics.totalAfterDelivery
    ) {
      rows.set(row.offer.id, replacement);
    }
  }
  return [...rows.values()];
}

function originalRejected(store, source, observedAt, context) {
  return (
    !source ||
    source.status === 'failed' ||
    source.challenge?.detected ||
    source.observedAt !== observedAt ||
    (store.visibility === 'public' && source.visibility === 'private') ||
    workflowSourceInvalidated(
      { ...source, url: source.url || source.sourceUrl },
      context.caches,
      context.invalidations
    )
  );
}

function originalValid(store, id, observedAt, binding, context, review) {
  if (!id || !binding?.sourceSha256 || !binding.sourceUrl) {
    return false;
  }
  const key = `${id}:${observedAt}:${binding.sourceSha256}:${binding.sourceUrl}:${review.offer.id}:${review.role}`;
  if (context.sources.has(key)) {
    return context.sources.get(key);
  }
  const checked = (async () => {
    const source =
      (await store.get('evidence', id)) || (await store.get('cache', id));
    if (
      originalRejected(store, source, observedAt, context) ||
      listingKey(source.url || source.sourceUrl) !==
        listingKey(binding.sourceUrl)
    ) {
      return false;
    }
    const descriptors = [source.html, source.blob].filter(
      (descriptor) => descriptor?.sha256 === binding.sourceSha256
    );
    if (!descriptors.length) {
      return false;
    }
    for (const descriptor of descriptors) {
      if (!context.blobs.has(descriptor.sha256)) {
        context.blobs.set(descriptor.sha256, store.blob(descriptor.sha256));
      }
      const bytes = await context.blobs.get(descriptor.sha256);
      if (
        !bytes ||
        bytes.length !== descriptor.bytes ||
        sha256(bytes) !== descriptor.sha256
      ) {
        return false;
      }
      if (
        !review.checkout &&
        !(review.role === 'price'
          ? selectedPriceOriginalMatches(
              bytes,
              source.url || source.sourceUrl,
              review.offer
            )
          : deliveryOriginalMatches(bytes, source, review.offer))
      ) {
        return false;
      }
    }
    return true;
  })().catch(() => false);
  context.sources.set(key, checked);
  return checked;
}

/** Read originals locally; a numeric quote never substitutes for its source. */
export async function capturedOfferOriginals(
  application,
  rows,
  reviewEvidence = []
) {
  const reviewed = new Map(
    reviewEvidence.map((entry) => [entry.evidenceId, entry.sourceSha256])
  );
  const context = {
    caches: await application.store.list('cache'),
    invalidations: await application.store.list('invalidation'),
    sources: new Map(),
    blobs: new Map(),
  };
  const problems = [];
  for (const row of rows) {
    const { offer } = row;
    if (
      !(await originalValid(
        application.store,
        offer.evidenceId,
        offer.observedAt,
        row.originalSourceBindings || {
          sourceSha256: reviewed.get(offer.evidenceId),
          sourceUrl: offer.url,
        },
        context,
        { offer, role: 'price', checkout: Boolean(row.sourceQuoteId) }
      ))
    ) {
      problems.push({
        offerId: offer.id,
        reason: 'Missing, changed or invalidated original selected price',
      });
    }
    if (
      !(await originalValid(
        application.store,
        offer.quoteEvidenceId,
        offer.quoteObservedAt,
        row.originalSourceBindings || {
          sourceSha256: reviewed.get(offer.quoteEvidenceId),
          sourceUrl: offer.url,
        },
        context,
        { offer, role: 'delivery', checkout: Boolean(row.sourceQuoteId) }
      ))
    ) {
      problems.push({
        offerId: offer.id,
        reason: 'Missing, changed or invalidated original delivery quote',
      });
    }
  }
  return { complete: rows.length > 0 && problems.length === 0, problems };
}

/** These gates certify only the explicitly reviewed captured inventory. */
export function caseEvidenceGates({
  coverage,
  rows,
  originals,
  translation,
  quantity,
  deliveryArea,
  now,
  maxPriceAgeMs,
}) {
  const target = rows.filter((row) =>
    ['whey', 'chocolate-ice-cream'].includes(shoppingCategory(row.product))
  );
  const ice = target.filter(
    (row) => row.product.category === 'chocolate-ice-cream'
  );
  const freshQuote = (row) => {
    const age = now - Date.parse(row.offer.quoteObservedAt);
    return Number.isFinite(age) && age >= 0 && age <= maxPriceAgeMs;
  };
  return {
    declaredInventoryComplete: Boolean(
      coverage.manifest?.declaredRows > 0 &&
      coverage.manifest.scopedPricesComplete &&
      coverage.manifest.scope === coverage.scope
    ),
    originalExtractionAndInventoryReviewed:
      coverage.observedScopeReady === true,
    bothTargetCategoriesPresent: ['whey', 'chocolate-ice-cream'].every(
      (category) =>
        target.some((row) => shoppingCategory(row.product) === category)
    ),
    exactManufacturerSpecificationsVerified: nonemptyEvery(
      target,
      (row) => row.manufacturerVerified === true
    ),
    currentSelectedPrices: nonemptyEvery(target, (row) =>
      capturedPriceFresh(row, now, maxPriceAgeMs)
    ),
    originalPricesAndQuotesVerified: originals.complete === true,
    exactQuantityDestinationAndStock: nonemptyEvery(
      target,
      (row) =>
        row.metrics.quantity === quantity &&
        row.eligible &&
        exactCapturedDelivery(row, deliveryArea) &&
        freshQuote(row)
    ),
    foodAndProteinRatesComplete: nonemptyEvery(target, (row) =>
      [
        'costPerGramBeforeDelivery',
        'costPerGramAfterDelivery',
        'costPerProteinGramBeforeDelivery',
        'costPerProteinGramAfterDelivery',
      ].every((field) => rateKnown(row.metrics[field]))
    ),
    iceMassVolumeProteinAndFrozenDeliveryComplete: nonemptyEvery(
      ice,
      (row) =>
        row.product.manufacturerVerification?.identity?.coreFlavour ===
          'chocolate' &&
        row.metrics.totalMassG > 0 &&
        row.metrics.totalVolumeMl > 0 &&
        row.metrics.totalProteinG > 0 &&
        row.offer.coldChainConfirmed === true &&
        ['costPerMlBeforeDelivery', 'costPerMlAfterDelivery'].every((field) =>
          rateKnown(row.metrics[field])
        )
    ),
    currentCachedCatalogEnglishAccepted:
      translation.completeCachedCatalogEnglishAccepted === true,
  };
}
