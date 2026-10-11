import { powderCategory, reportUnitCosts } from './report-unit-costs.mjs';

// Food prices use selected source facts. Conditional factory calculations
// belong in their own reference section and cannot supply this denominator.
export function deadlineFoodGramRanking(rows, limit = 10) {
  return rows
    .filter(
      (row) =>
        powderCategory(row.product) === 'whey' &&
        !row.product.massEvidence?.conflicting
    )
    .map((row) => ({ row, costs: reportUnitCosts(row) }))
    .filter(
      ({ costs }) =>
        Number.isFinite(costs.massG) &&
        costs.massG > 0 &&
        Number.isFinite(costs.beforePerFoodGram) &&
        costs.beforePerFoodGram > 0
    )
    .map(({ row, costs }) => ({
      row,
      mass: costs.massG,
      before: costs.beforePerFoodGram,
      after: costs.afterPerFoodGram,
      costs,
      conditional: false,
    }))
    .sort((left, right) => left.before - right.before)
    .slice(0, limit);
}
