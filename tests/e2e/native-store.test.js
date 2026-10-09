import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, NativeLinkStore } from '../../src/index.js';
import { decode } from 'lino-objects-codec';

test(
  'real link-cli native doublets preserve the graph, cache verified shards and repair corruption',
  { skip: !process.env.LAZADA_TEST_CLINK },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'lazada-clink-e2e-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new AssociativeStore({ directory });
    await store.put('product', {
      id: 'whey',
      ingredients: ['whey protein isolate', 'sô cô la'],
      nested: { unknown: null, reviewed: true },
      raw: '"quotes" and\nnewlines, Bob\'s (2 x 500g)!'.repeat(5000),
      attributes: Object.fromEntries(
        Array.from({ length: 1600 }, (_, i) => [`attribute-${i}`, `value-${i}`])
      ),
    });
    await store.put('offer', {
      id: 'offer',
      productId: 'whey',
      currency: 'VND',
      price: 250000,
    });
    const native = new NativeLinkStore({
      command: process.env.LAZADA_TEST_CLINK,
    });
    const first = await native.mirror(store);
    assert.equal(first.shards.length, 2);
    assert.equal(first.reused, 0);
    const productShard = first.shards.find((shard) => shard.kind === 'product');
    const atoms = decode({
      notation: await readFile(
        join(productShard.directory, 'atoms.lino'),
        'utf8'
      ),
    });
    assert.ok(
      Object.values(atoms).includes(
        `string:${'"quotes" and\nnewlines, Bob\'s (2 x 500g)!'.repeat(5000)}`
      )
    );
    assert.ok(
      (await readdir(first.shards[0].directory)).includes('data.links')
    );
    assert.equal((await native.mirror(store)).reused, 2);
    await store.put('offer', {
      id: 'other-offer',
      productId: 'whey',
      currency: 'VND',
      price: 250000,
    });
    const distinct = await native.mirror(store);
    assert.equal(distinct.shards.length, 3);
    assert.equal(
      new Set(distinct.shards.map(({ directory: shard }) => shard)).size,
      3
    );
    await writeFile(join(first.shards[0].directory, 'data.links'), 'corrupt');
    assert.equal((await native.mirror(store)).reused, 2);
    await writeFile(join(first.shards[0].directory, 'manifest.json'), '{');
    assert.equal((await native.mirror(store)).reused, 2);
  }
);
