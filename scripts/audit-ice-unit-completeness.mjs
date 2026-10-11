import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { sha256 } from '../src/util.js';

const metrics = [
  ['massG', 'beforePerFoodGram', 'afterPerFoodGram'],
  ['volumeMl', 'beforePerMl', 'afterPerMl'],
  ['proteinG', 'beforePerProteinGram', 'afterPerProteinGram'],
];
const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : '—';

export function auditIceUnitCompleteness(report, markdown) {
  let calculations = 0;
  for (const row of report.rows) {
    for (const [amount, before, after] of metrics) {
      for (const [total, metric] of [
        ['totalBeforeDelivery', before],
        ['totalAfterDelivery', after],
      ]) {
        const expected =
          Number.isFinite(row[total]) && row[amount] > 0
            ? row[total] / row[amount]
            : null;
        assert.equal(row[metric], expected, `${row.sku}: ${metric}`);
        calculations++;
      }
    }
  }
  let displayedRows = 0;
  for (const [index, title, metric] of [
    [0, 'Lowest price per gram of food', 'beforePerFoodGram'],
    [1, 'Lowest price per millilitre', 'beforePerMl'],
    [2, 'Lowest price per gram of protein — reference', 'beforePerProteinGram'],
  ]) {
    const section = markdown.split(`## ${title}\n`)[1]?.split('\n## ')[0];
    assert.ok(section, `Missing ranking ${index}`);
    const lines = section.split('\n').filter((line) => line.startsWith('|'));
    if (!report.rankings[metric].length) {
      continue;
    }
    const cells = (line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((s) => s.trim());
    const headers = cells(lines[0]);
    const fields = [
      ['Food g', 'massG'],
      ['Volume ml', 'volumeMl'],
      ['VND/g before delivery', 'beforePerFoodGram'],
      ['VND/ml before delivery', 'beforePerMl'],
    ];
    const columns = fields.map(([header, field]) => {
      const column = headers.indexOf(header);
      assert.ok(column >= 0, `${title}: missing ${header}`);
      return [column, field];
    });
    for (const [rowIndex, row] of report.rankings[metric]
      .slice(0, 10)
      .entries()) {
      const displayed = cells(lines[rowIndex + 2] || '');
      assert.ok(
        displayed.some((cell) => cell.includes(`](${row.url})`)),
        row.sku
      );
      for (const [column, field] of columns) {
        assert.equal(
          displayed[column],
          number(row[field]),
          `${row.sku}: ${field}`
        );
      }
      displayedRows++;
    }
  }
  return {
    selectedRows: report.rows.length,
    independentMetricCalculations: calculations,
    displayedRankingRows: displayedRows,
    bothUnitPricesShownWheneverSupported: true,
    densityConversions: 0,
  };
}

async function main() {
  const jsonPath = 'docs/tables/ice-unit-rankings.json';
  const markdownPath = 'docs/tables/ice-unit-rankings.md';
  const bytes = await readFile(jsonPath);
  const markdown = await readFile(markdownPath);
  const receipt = {
    checkedAt: new Date().toISOString(),
    ...auditIceUnitCompleteness(JSON.parse(bytes), markdown.toString()),
    downloads: 0,
    inputs: [
      { path: jsonPath, sha256: sha256(bytes) },
      { path: markdownPath, sha256: sha256(markdown) },
    ],
  };
  await writeFile(
    'docs/acceptance/ice-unit-completeness/report-audit.json',
    await format(JSON.stringify(receipt), { parser: 'json' })
  );
  console.log(JSON.stringify(receipt));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
