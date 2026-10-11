import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { catalogMarkdownPages } from '../scripts/catalog-markdown-pages.mjs';

test('bounded Markdown pages preserve every original discovery and review row', async () => {
  for (const name of ['category-review.md', 'discovered-listings.md']) {
    const text = await readFile(
      new URL(`../docs/tables/${name}`, import.meta.url),
      'utf8'
    );
    // Already paginated reports use a synthetic stress fixture, not marketplace facts.
    const source = text.includes('bounded pages;')
      ? `# Large inventory\n\n| Listing | Value |\n| --- | --- |\n${Array.from(
          { length: 6403 },
          (_, i) => `| [item ${i}](https://example.com/${i}) | ${i} |`
        ).join('\n')}`
      : text;
    const result = catalogMarkdownPages(name, source);
    assert.ok(result.pages.length > 1);
    const originalRows = source
      .trimEnd()
      .split('\n')
      .filter((line) => line.startsWith('| ['));
    const pageRows = result.pages.flatMap((page) =>
      page.text.split('\n').filter((line) => line.startsWith('| ['))
    );
    assert.deepEqual(pageRows, originalRows);
    let nextLine = 1;
    for (const page of result.pages) {
      assert.equal(page.sourceLineStart, nextLine);
      nextLine = page.sourceLineEnd + 1;
      const formatted = await format(page.text, { parser: 'markdown' });
      assert.ok(formatted.split('\n').length < 1500);
      assert.ok(result.index.includes(`](${page.name})`));
    }
    assert.equal(nextLine - 1, source.trimEnd().split('\n').length);
    assert.ok(result.index.includes('[catalog.json](catalog.json)'));
  }
});

test('table headers remain intact at page boundaries and small reports stay unchanged', () => {
  const rows = Array.from(
    { length: 11 },
    (_, i) => `| [row ${i}](https://example.com/${i}) | ${i} |`
  );
  const text = `# Inventory\n\n| Product | Quantity |\n| --- | --- |\n${rows.join('\n')}\n\nOriginal footer.\n`;
  const result = catalogMarkdownPages('inventory.md', text, 4);
  assert.deepEqual(
    result.pages.flatMap((page) =>
      page.text.split('\n').filter((line) => line.startsWith('| ['))
    ),
    rows
  );
  for (const page of result.pages) {
    if (page.text.includes('| [row')) {
      assert.ok(page.text.includes('| Product | Quantity |\n| --- | --- |'));
    }
  }
  assert.ok(result.pages.at(-1).text.includes('Original footer.'));
  assert.deepEqual(catalogMarkdownPages('small.md', '# Small\n'), {
    index: '# Small\n',
    pages: [],
  });
  assert.throws(() => catalogMarkdownPages('x.md', text, 1500), /between/);
});
