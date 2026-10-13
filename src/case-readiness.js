import { requirementDraftStatus } from './requirement-registry.js';
import { caseCoverageStatus } from './case-coverage.js';
import { COLLECTION_STOP_ID } from './page-challenge.js';
import { positive } from './values.js';
import { shoppingCategory } from './shopping-report.js';
import {
  capturedOfferOriginals,
  caseEvidenceGates,
  readinessComparisons,
} from './case-evidence-gates.js';

export async function caseReadiness(application, options = {}) {
  const quantity = positive(options.quantity ?? 1, 'quantity', {
    integer: true,
  });
  const maxPriceAgeMs = positive(
    options.maxPriceAgeMs ?? 86400000,
    'maxPriceAgeMs',
    { zero: true }
  );
  const now = Date.now();
  const coverage = await caseCoverageStatus(application, options);
  const stop = await application.store.get(
    'collection-stop',
    COLLECTION_STOP_ID
  );
  const comparison = await application.compare({
    quantity,
    maxPriceAgeMs,
    now,
    allowStale: false,
    flavourScope: 'chocolate-or-unflavoured',
    deliveryArea: application.deliveryArea,
  });
  const translation = await application.translationStatus({
    verifyCurrentCatalog: true,
  });
  const baskets = await application.compareBaskets({
    quantity,
    maxPriceAgeMs,
    now,
    allowStale: false,
    flavourScope: 'chocolate-or-unflavoured',
    deliveryArea: application.deliveryArea,
  });
  const targetRows = readinessComparisons(comparison, baskets, quantity).filter(
    (row) =>
      ['whey', 'chocolate-ice-cream'].includes(shoppingCategory(row.product))
  );
  const originals = await capturedOfferOriginals(
    application,
    targetRows,
    coverage.manualReview?.evidence
  );
  const evidenceGates = caseEvidenceGates({
    coverage,
    rows: targetRows,
    originals,
    translation,
    quantity,
    deliveryArea: application.deliveryArea,
    now,
    maxPriceAgeMs,
  });
  const capturedInventoryPurchaseReady = Object.values(evidenceGates).every(
    (value) => value === true
  );
  return {
    ...requirementDraftStatus(),
    checkedAt: new Date().toISOString(),
    coverage,
    collectionStop: stop || { active: false },
    qualifiedOffers: targetRows.filter((row) => row.eligible).length,
    unverifiedOrUnpricedOffers: targetRows.filter((row) => !row.eligible)
      .length,
    translation,
    quantity,
    maxPriceAgeMs,
    evidenceGates,
    originalEvidenceProblems: originals.problems,
    capturedInventoryPurchaseReady,
    purchaseReadinessScope: 'explicitly-reviewed-captured-inventory',
    wholeMarketBestPriceProven: false,
    externalGates: [
      ...(!coverage.observedScopeReady
        ? ['Complete original inventory, extraction and manual review']
        : []),
      ...(stop?.active
        ? [
            'Manually clear the original challenge and use guarded explicit resume',
          ]
        : []),
      ...(!evidenceGates.exactManufacturerSpecificationsVerified
        ? [
            'Exact current manufacturer flavour/package/formula matches for every target SKU',
          ]
        : []),
      ...(!evidenceGates.exactQuantityDestinationAndStock ||
      !evidenceGates.iceMassVolumeProteinAndFrozenDeliveryComplete
        ? [
            'Exact bulk destination, voucher/payment eligibility and frozen-delivery quotes',
          ]
        : []),
      ...(!evidenceGates.currentCachedCatalogEnglishAccepted
        ? [
            'Configured translation provider and whole-catalog semantic acceptance',
          ]
        : []),
      'Authoritative whole-market inventory and all selling/basket options',
      'Current authenticated session and allowlisted live Telegram acceptance',
      'Package owner npm trusted-publisher configuration (issue32)',
      'Current real marketplace layout and configured provider acceptance',
    ],
    productionReady: false,
    purchaseReady: capturedInventoryPurchaseReady,
    allRequirementsDelivered: false,
  };
}
