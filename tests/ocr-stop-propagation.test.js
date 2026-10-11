import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { LazadaSearch } from '../src/application.js';
import { CollectionStoppedError } from '../src/page-challenge.js';

function product() {
  return {
    id: 'ocr-stop-product',
    ingredients: [],
    claims: [],
    evidenceIds: [],
    warnings: [],
  };
}

for (const phase of ['image', 'ocr']) {
  test(`OCR workflow propagates a ${phase} collection stop before processing later images or screenshots`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'lazada-ocr-stop-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new AssociativeStore({ directory });
    const blob = await store.putBlob('synthetic OCR stop fixture');
    const stop = new CollectionStoppedError({
      id: 'test-stop',
      reason: 'security-challenge',
      active: true,
      url: 'https://img.lazcdn.com/challenge',
    });
    let images = 0;
    let passes = 0;
    const app = new LazadaSearch({
      store,
      offline: true,
      cache: {
        offline: true,
        image: async () => {
          images += 1;
          if (phase === 'image') {
            throw stop;
          }
          return { blob };
        },
      },
      ocr: {
        recognize: async () => {
          passes += 1;
          throw stop;
        },
      },
    });
    t.after(() => app.close());
    const current = product();
    await assert.rejects(
      app.collectOcr(current, {
        snapshot: {
          url: 'https://www.lazada.vn/products/pdp-i123.html',
          productImages: [
            'https://img.lazcdn.com/first.jpg',
            'https://img.lazcdn.com/second.jpg',
          ],
        },
        screenshot: blob,
      }),
      (error) => error === stop
    );
    assert.equal(images, 1);
    assert.equal(passes, phase === 'ocr' ? 1 : 0);
    assert.equal(current.ocrCoverage.failed, 0);
    assert.deepEqual(current.evidenceIds, []);
    assert.deepEqual(await store.list('product'), []);
    assert.deepEqual(await store.list('offer'), []);
  });
}

test('ordinary image/OCR failures retain partial evidence without becoming security-stop errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-ocr-ordinary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const blob = await store.putBlob('synthetic partial OCR fixture');
  let images = 0;
  let passes = 0;
  const app = new LazadaSearch({
    store,
    offline: true,
    cache: {
      offline: true,
      image: async () => {
        images += 1;
        if (images === 1) {
          throw new Error('Image unavailable');
        }
        return { blob };
      },
    },
    ocr: {
      recognize: async () => {
        passes += 1;
        if (passes === 1) {
          throw new Error('Decode failure');
        }
        return {
          id: 'partial-ocr',
          imageHash: blob.sha256,
          text: 'Protein 20 g per serving',
          confidence: 0.95,
        };
      },
    },
  });
  t.after(() => app.close());
  const current = product();
  await app.collectOcr(current, {
    snapshot: {
      url: 'https://www.lazada.vn/products/pdp-i123.html',
      productImages: [
        'https://img.lazcdn.com/first.jpg',
        'https://img.lazcdn.com/second.jpg',
      ],
    },
    screenshot: blob,
  });
  assert.equal(images, 2);
  assert.equal(passes, 2);
  assert.equal(current.ocrCoverage.failed, 2);
  assert.equal(current.evidenceIds.length, 1);
});
