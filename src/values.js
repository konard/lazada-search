export function positive(value, label, { zero = false, integer = false } = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (zero ? value < 0 : value <= 0) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new TypeError(
      `${label} must be a ${zero ? 'non-negative' : 'positive'} ${integer ? 'integer' : 'number'}`
    );
  }
  return value;
}
