export const storedBlobReference = (hash, bytes) => ({
  type: 'stored-blob',
  sha256: hash,
  bytes,
});

export function isStoredBlobReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const valid =
    /^[a-f\d]{64}$/u.test(value.sha256) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0;
  if (value.type === 'stored-blob') {
    if (!valid) {
      throw new Error('Invalid stored blob reference');
    }
    return true;
  }
  // Old stores used exactly these two fields. Descriptive source metadata
  // retains its own digest and may contain independently stored references.
  return valid && Object.keys(value).length === 2;
}
