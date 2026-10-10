import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AssociativeStore, LazadaSearch } from '../src/index.js';

const execute = promisify(execFile);

test('published price tables contain every confirmed food price in ascending order per category', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../docs/tables/catalog.json', import.meta.url))
  );
  const markdown = await readFile(
    new URL('../docs/tables/known-prices.md', import.meta.url),
    'utf8'
  );
  const sections = markdown.split(/^## /mu).slice(1);
  assert.equal(sections.length, 2);
  for (const [index, section] of sections.entries()) {
    const expected = catalog.comparisons.filter(
      ({ product, offer }) =>
        offer.price > 0 &&
        offer.variantConfirmed &&
        (index === 0
          ? ['whey', 'protein-powder'].includes(product.category)
          : product.category === 'chocolate-ice-cream')
    );
    const rows = section
      .split('\n')
      .filter((line) => line.startsWith('| ['))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((value) => value.trim())
      );
    assert.equal(rows.length, expected.length);
    const prices = rows.map((row) => Number(row[3].replaceAll(',', '')));
    assert.ok(prices.length > 0);
    assert.ok(prices.every((price) => Number.isFinite(price) && price > 0));
    assert.deepEqual(
      prices,
      [...prices].sort((a, b) => a - b)
    );
    assert.deepEqual(
      rows.map((row) => `${row[2]}:${row[3].replaceAll(',', '')}`).sort(),
      expected.map(({ offer }) => `${offer.sku}:${offer.price}`).sort()
    );
  }
});

test('Markdown export retains a newly collected product without a pre-existing manual-review entry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-table-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const subdirectory of [
    'scripts',
    'tests/fixtures',
    'docs/acceptance/visual-review',
  ]) {
    await mkdir(join(directory, subdirectory), { recursive: true });
  }
  await symlink(join(root, 'src'), join(directory, 'src'));
  await symlink(join(root, 'node_modules'), join(directory, 'node_modules'));
  await copyFile(
    join(root, 'scripts/export-catalog-tables.mjs'),
    join(directory, 'scripts/export-catalog-tables.mjs')
  );
  await copyFile(
    join(root, 'tests/fixtures/products.json'),
    join(directory, 'tests/fixtures/products.json')
  );
  await writeFile(
    join(directory, 'docs/acceptance/manual-catalog-review.json'),
    JSON.stringify({ items: [] })
  );
  const fixture = JSON.parse(
    await readFile(join(directory, 'tests/fixtures/products.json'))
  );
  const product = {
    ...fixture.products[0],
    id: 'new-product',
    title: 'New unreviewed whey without a manual-review entry',
  };
  delete product.manufacturerVerification;
  const offer = {
    ...fixture.offers[0],
    id: 'new-offer',
    productId: product.id,
    observedAt: new Date().toISOString(),
  };
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory: join(directory, 'store') }),
    offline: true,
    ocr: false,
  });
  await app.importRecords({ products: [product], offers: [offer] });
  await app.close();
  const result = await execute(
    process.execPath,
    [
      'scripts/export-catalog-tables.mjs',
      '--offline',
      '--data-dir',
      join(directory, 'store'),
    ],
    { cwd: directory }
  );
  assert.equal(JSON.parse(result.stdout).observed, 1);
  const markdown = await readFile(
    join(directory, 'docs/tables/protein-powder.md'),
    'utf8'
  );
  assert.ok(markdown.includes(product.title));
  assert.ok(markdown.includes('Manual review pending'));
  const catalog = JSON.parse(
    await readFile(join(directory, 'docs/tables/catalog.json'))
  );
  assert.equal(catalog.products[0].id, product.id);
  assert.equal(catalog.comparisons[0].manufacturerVerified, false);
  assert.match(
    await readFile(
      join(directory, 'docs/tables/verified-comparison.md'),
      'utf8'
    ),
    /No verified comparison rows/
  );
});

test('committed catalog imports offline with the same offers and explicit coverage gaps', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-catalog-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalog = JSON.parse(
    await readFile(new URL('../docs/tables/catalog.json', import.meta.url))
  );
  assert.ok(catalog.discoveries.length > 0);
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  app.collector.start = () => {
    throw new Error('Committed catalog import must never start a browser');
  };
  const imported = await app.importRecords(catalog);
  assert.equal(imported.offers, catalog.offers.length);
  const audit = await app.audit();
  assert.deepEqual(audit.missingListings, catalog.audit.missingListings);
  assert.deepEqual(audit.missingSkuPrices, catalog.audit.missingSkuPrices);
  assert.equal(audit.verifiedProducts, catalog.audit.verifiedProducts);
  const report = await app.compare({ allowStale: true });
  assert.equal(report.comparisons.length, catalog.offers.length);
  assert.equal(
    report.comparisons.filter((row) => row.manufacturerVerified).length,
    catalog.comparisons.filter((row) => row.manufacturerVerified).length
  );
  assert.equal(app.cache.stats.downloads, 0);
  await app.close();
});
