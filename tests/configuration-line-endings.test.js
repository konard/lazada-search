import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArguments } from '../src/config.js';

test('CRLF configuration preserves Nha Trang, exact flavour filters and meaningful value spaces', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-crlf-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'preferences.lenv');
  const values = {
    LAZADA_MARKET: 'vn',
    LAZADA_DELIVERY_AREA: 'Nha Trang',
    LAZADA_FLAVOUR_SCOPE: 'chocolate-or-unflavoured',
    LAZADA_SEARCH_SORT: 'priceasc',
    LAZADA_CATEGORY_ONLY: 'true',
    LAZADA_FIXTURE_SPACES: '  keep these spaces  ',
    LAZADA_FIXTURE_QUOTED: '"quoted value"',
  };
  const original = new Map(
    Object.keys(values).map((name) => [name, process.env[name]])
  );
  t.after(() => {
    for (const [name, value] of original) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}: ${value}\r\n`)
      .join('')
  );
  const options = parseArguments(['discover', '--configuration', path]);
  assert.equal(options.market, 'vn');
  assert.equal(options.deliveryArea, 'Nha Trang');
  assert.equal(options.flavourScope, 'chocolate-or-unflavoured');
  assert.equal(options.searchSort, 'priceasc');
  assert.equal(options.categoryOnly, true);
  assert.equal(process.env.LAZADA_FIXTURE_SPACES, values.LAZADA_FIXTURE_SPACES);
  assert.equal(process.env.LAZADA_FIXTURE_QUOTED, 'quoted value');
});
