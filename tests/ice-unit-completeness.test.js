import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditIceUnitCompleteness } from '../scripts/audit-ice-unit-completeness.mjs';

const report = JSON.parse(
  await readFile(
    new URL('../docs/tables/ice-unit-rankings.json', import.meta.url)
  )
);
const markdown = await readFile(
  new URL('../docs/tables/ice-unit-rankings.md', import.meta.url),
  'utf8'
);

test('every published ice ranking displays both independently known quantities and unit prices', () => {
  const review = auditIceUnitCompleteness(report, markdown);
  assert.equal(review.selectedRows, 14);
  assert.equal(review.independentMetricCalculations, 84);
  assert.equal(review.displayedRankingRows, 14);
  const pairs = report.rows.filter((row) => row.massG > 0 && row.volumeMl > 0);
  assert.deepEqual(
    pairs.map((row) => [row.massG, row.volumeMl]).sort((a, b) => a[0] - b[0]),
    [
      [131, 130],
      [3144, 3120],
    ]
  );
});

test('the independent audit rejects an omitted metric, wrong carton arithmetic or hidden known quantity', () => {
  const mutated = globalThis.structuredClone(report);
  const row = mutated.rows.find((r) => r.massG === 3144);
  row.beforePerFoodGram = row.totalBeforeDelivery / 131;
  assert.throws(
    () => auditIceUnitCompleteness(mutated, markdown),
    /beforePerFoodGram/u
  );
  assert.throws(
    () =>
      auditIceUnitCompleteness(
        report,
        markdown.replaceAll('VND/ml before delivery', 'Volume price hidden')
      ),
    /missing VND\/ml/u
  );
  assert.throws(
    () => auditIceUnitCompleteness(report, markdown.replaceAll('3,144', '—')),
    /massG/u
  );
});

test('Windows CRLF report text preserves all denominator and arithmetic assertions', () => {
  const crlf = markdown.replace(/\r?\n/gu, '\r\n');
  assert.deepEqual(
    auditIceUnitCompleteness(report, crlf),
    auditIceUnitCompleteness(report, markdown)
  );
  assert.throws(
    () =>
      auditIceUnitCompleteness(
        report,
        crlf.replaceAll('VND/ml before delivery', 'Volume price hidden')
      ),
    /missing VND\/ml/u
  );
});
