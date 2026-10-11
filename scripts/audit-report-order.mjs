import assert from 'node:assert/strict';

// Unresolved denominators belong after ranked facts, never at zero or NaN.
// Source-price and arithmetic checks remain independent of this order check.
export function auditHandpickedGramOrder(rows) {
  let previous = 0;
  let unresolved = false;
  let rankedRows = 0;
  for (const row of rows) {
    const value = row.costs?.beforePerFoodGram;
    if (value === null || value === undefined) {
      assert.ok(
        row.costs?.massG === null || row.costs?.massG === undefined,
        `Declared mass requires its gram price: ${row.exactSku}`
      );
      unresolved = true;
      continue;
    }
    assert.ok(Number.isFinite(value) && value > 0, row.exactSku);
    assert.ok(row.costs.massG > 0, row.exactSku);
    assert.ok(!unresolved && value >= previous, row.exactSku);
    previous = value;
    rankedRows++;
  }
  return {
    rankedRows,
    unresolvedRows: rows.length - rankedRows,
    unresolvedDenominatorsLast: true,
  };
}
