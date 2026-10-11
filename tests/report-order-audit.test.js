import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHandpickedGramOrder } from '../scripts/audit-report-order.mjs';

const priced = (value) => ({
  exactSku: `priced-${value}`,
  costs: { massG: 1000, beforePerFoodGram: value },
});
const held = {
  exactSku: 'held-source-conflict',
  costs: { massG: null, beforePerFoodGram: null },
};

test('held source denominators are audited after sorted gram prices without claiming full coverage', () => {
  assert.deepEqual(auditHandpickedGramOrder([priced(400), priced(500), held]), {
    rankedRows: 2,
    unresolvedRows: 1,
    unresolvedDenominatorsLast: true,
  });
  assert.equal(auditHandpickedGramOrder([held]).rankedRows, 0);
});

test('the audit still rejects missing arithmetic, false zero prices and unsorted or interleaved rows', () => {
  for (const rows of [
    [priced(500), priced(400)],
    [held, priced(400)],
    [priced(0)],
    [priced(Number.NaN)],
    [{ ...priced(400), costs: { massG: 1000, beforePerFoodGram: null } }],
    [{ ...priced(400), costs: { massG: null, beforePerFoodGram: 400 } }],
  ]) {
    assert.throws(() => auditHandpickedGramOrder(rows));
  }
});
