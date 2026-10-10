import { listingKey } from './text.js';

const massMetrics = [
  'totalMassG',
  'totalVolumeMl',
  'totalProteinG',
  'costPerGramBeforeDelivery',
  'costPerGramAfterDelivery',
  'costPerMlBeforeDelivery',
  'costPerMlAfterDelivery',
  'costPerProteinGramBeforeDelivery',
  'costPerProteinGramAfterDelivery',
  'costPer25gProteinBeforeDelivery',
  'costPer25gProteinAfterDelivery',
  'costPerKgBeforeDelivery',
  'costPerKgAfterDelivery',
  'costPerProteinG',
  'costPer25gProtein',
  'costPerKg',
];

function identity(row) {
  if (!row.offer.sku) {
    return `offer:${row.offer.id}`;
  }
  return `${listingKey(row.offer.url)}:${row.offer.sku.split('_VNAMZ-').at(-1)}`;
}

function observationTime(row) {
  const time = Date.parse(row.offer.observedAt);
  return Number.isFinite(time) ? time : -Infinity;
}

// Store history retains all observations. A shopping comparison has one row per
// selected SKU, using its newest price. Tied contradictory captures fail closed.
export function uniqueComparisons(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = identity(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const comparisons = [],
    duplicateObservations = [];
  for (const [key, observations] of groups) {
    observations.sort(
      (a, b) =>
        observationTime(b) - observationTime(a) ||
        Number(b.manufacturerVerified) - Number(a.manufacturerVerified) ||
        a.offer.id.localeCompare(b.offer.id)
    );
    const latest = observations.filter(
      (row) => observationTime(row) === observationTime(observations[0])
    );
    const chosen = observations[0];
    if (observations.length > 1) {
      duplicateObservations.push({
        skuKey: key,
        selectedOfferId: chosen.offer.id,
        offerIds: observations.map((row) => row.offer.id),
      });
    }
    const conflicts = [];
    if (new Set(latest.map((row) => row.offer.price)).size > 1) {
      conflicts.push('Conflicting prices for the same SKU and capture time');
      chosen.offer.priceInvalidated = true;
    }
    // An exact reviewed factory package resolves older extraction disagreements
    // only within this same selected SKU and observation timestamp.
    if (
      !chosen.manufacturerVerified &&
      latest.some((row) =>
        ['netMassG', 'netVolumeMl', 'packCount'].some(
          (field) =>
            (row.product[field] ?? (field === 'packCount' ? 1 : null)) !==
            (chosen.product[field] ?? (field === 'packCount' ? 1 : null))
        )
      )
    ) {
      conflicts.push(
        'Conflicting package denominators for the same SKU and capture time'
      );
      for (const field of massMetrics) {
        chosen.metrics[field] = null;
      }
    }
    if (conflicts.length) {
      chosen.problems.push(...conflicts);
      chosen.eligible = false;
      chosen.observationConflicts = conflicts;
    }
    comparisons.push(chosen);
  }
  return { comparisons, duplicateObservations };
}
