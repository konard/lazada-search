// Nutrition bases describe the same inner food package. Never infer mass from
// volume; independently printed bases must agree within label rounding.
export function proteinAmount(fields, massG, volumeMl, packages = 1) {
  const candidates = [];
  const add = (basis, density, amount) => {
    if (
      Number.isFinite(density) &&
      density >= 0 &&
      Number.isFinite(amount) &&
      amount > 0
    ) {
      candidates.push([basis, density * amount]);
    }
  };
  if (Number.isFinite(packages) && packages > 0) {
    add('package', fields.proteinPerPackageG, packages);
    add('100g', fields.proteinPer100g, massG / 100);
    add('100ml', fields.proteinPer100ml, volumeMl / 100);
  }
  const proteinConflict = candidates.some(
    ([, value]) =>
      Math.abs(value - candidates[0][1]) >
      Math.max(0.05 * packages, 0.02 * candidates[0][1])
  );
  return {
    proteinG: proteinConflict || !candidates.length ? null : candidates[0][1],
    proteinBasis:
      proteinConflict || !candidates.length ? null : candidates[0][0],
    proteinConflict,
  };
}
