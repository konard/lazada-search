import { requirementDraftStatus } from './requirement-registry.js';
import { caseCoverageStatus } from './case-coverage.js';
import { COLLECTION_STOP_ID } from './page-challenge.js';

export async function caseReadiness(application, options = {}) {
  const coverage = await caseCoverageStatus(application, options);
  const stop = await application.store.get(
    'collection-stop',
    COLLECTION_STOP_ID
  );
  const comparison = await application.compare({
    quantity: options.quantity || 1,
    flavourScope: 'chocolate-or-unflavoured',
    deliveryArea: application.deliveryArea,
  });
  const translation = await application.translationStatus();
  return {
    ...requirementDraftStatus(),
    checkedAt: new Date().toISOString(),
    coverage,
    collectionStop: stop || { active: false },
    qualifiedOffers: comparison.ranked.length,
    unverifiedOrUnpricedOffers: comparison.excluded.length,
    translation,
    externalGates: [
      ...(!coverage.observedScopeReady
        ? ['Complete original inventory, extraction and manual review']
        : []),
      ...(stop?.active
        ? [
            'Manually clear the original challenge and use guarded explicit resume',
          ]
        : []),
      'Exact current manufacturer flavour/package/formula matches for every target SKU',
      'Exact bulk destination, voucher/payment eligibility and frozen-delivery quotes',
      'Configured translation provider and whole-catalog semantic acceptance',
      'Current authenticated session and allowlisted live Telegram acceptance',
      'Package owner npm trusted-publisher configuration (issue32)',
      'Current real marketplace layout and configured provider acceptance',
    ],
    productionReady: false,
    purchaseReady: false,
    allRequirementsDelivered: false,
  };
}
