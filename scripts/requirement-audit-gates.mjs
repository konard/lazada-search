import {
  capturedPriceFresh,
  exactCapturedDelivery,
} from '../src/captured-offer-gates.js';
export { capturedPriceFresh, exactCapturedDelivery };

const positive = (value) => Number.isFinite(value) && value > 0;
const nonempty = (values) => Array.isArray(values) && values.length > 0;

export function currentRequirementInventory(registry, issues) {
  const saved = new Map(issues.map((issue) => [issue.number, issue]));
  const expected = registry.githubIssues;
  return (
    nonempty(registry.requirements) &&
    registry.mappedRequirements === registry.requirements.length &&
    registry.mappedGithubIssues === expected.length &&
    new Set(registry.requirements.map((row) => row.id)).size ===
      registry.requirements.length &&
    nonempty(expected) &&
    saved.size === issues.length &&
    saved.size === expected.length &&
    expected.every((row) => saved.get(row.number)?.state === row.state)
  );
}

export function collectionAcceptanceGates({
  registry,
  issues,
  coverage,
  broad,
  active,
  ice,
  targetComparisons,
  stop,
  now = Date.now(),
}) {
  const delivered = (row) => exactCapturedDelivery(row);
  const relevantIce = ice.rows.filter(
    (row) => row.strictChocolateEligible !== false
  );
  return {
    currentRequirementInventory: currentRequirementInventory(registry, issues),
    authoritativeCategoryInventory:
      coverage.authoritativeCategoryInventoryCollected === true,
    visibleListsTerminal: broad.sourceListsComplete === true,
    allDiscoveredTargetListingsCaptured: active.missingListings.length === 0,
    allRelevantSkuPricesCaptured:
      active.missingSkuPrices.length === 0 && active.missingPrices.length === 0,
    allSkuInventoriesObserved: active.unknownSkuInventories.length === 0,
    allCategoryReviewsResolved: active.categoryReview.length === 0,
    allExactManufacturerSpecificationsVerified:
      nonempty(active.specifications) &&
      active.specifications.every((row) => row.problems.length === 0),
    iceMassVolumeAndProteinComplete:
      nonempty(relevantIce) &&
      relevantIce.every(
        (row) =>
          positive(row.massG) &&
          positive(row.volumeMl) &&
          Number.isFinite(row.proteinG) &&
          row.proteinG >= 0
      ),
    allIceRowsStrictChocolateVerified:
      nonempty(relevantIce) &&
      relevantIce.every(
        (row) =>
          row.strictChocolateEligible === true &&
          row.manufacturerIdentityMatched === true
      ),
    allCapturedTargetPricesFresh:
      nonempty(targetComparisons) &&
      targetComparisons.every((row) => capturedPriceFresh(row, now)),
    allCapturedTargetDeliveryQuotesExact:
      nonempty(targetComparisons) && targetComparisons.every(delivered),
    bulkDestinationQuotesCaptured: targetComparisons.some(
      (row) => row.offer.shippingQuantity > 1 && delivered(row)
    ),
    frozenNhaTrangDeliveryConfirmed: targetComparisons.some(
      (row) => row.product.category === 'chocolate-ice-cream' && delivered(row)
    ),
    collectionStopCleared: stop?.active === false,
    allRequirementsAccepted: registry.allRequirementsDelivered === true,
    allGithubIssuesClosed:
      nonempty(issues) && issues.every((issue) => issue.state === 'CLOSED'),
  };
}
