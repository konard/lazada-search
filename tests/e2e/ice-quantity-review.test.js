import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import {
  AssociativeStore,
  LazadaSearch,
  createTelegramBot,
  reviewPackageQuantities,
  startServer,
} from '../../src/index.js';

const execute = promisify(execFile);
const scope = 'chocolate-or-unflavoured';
const url =
  'https://www.lazada.vn/products/pdp-i3040048563.html?skuId=14623760583';
const wrapperUrl =
  'https://abcf.com.br/wp-content/uploads/2025/11/abc-powercap-chocolate.png';
const wrapperSha256 =
  '36b92b0233b8325abaee53fbb563ea92ab4a3383125ce403988f2a8901541819';
const cartonSha256 =
  '39f5a43f7e064f82736e983ae9e30c134490cd1061a6009bdc3378fa57f322e1';
const observedAt = '2026-10-10T17:25:00.000Z';
const options = {
  category: 'chocolate-ice-cream',
  allowStale: true,
  flavourScope: scope,
  sort: 'costPerGramBeforeDelivery',
};

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-ice-label-review-'));
  const open = () => {
    const application = new LazadaSearch({
      store: new AssociativeStore({ directory }),
      offline: true,
      ocr: false,
      flavourScope: scope,
    });
    application.collector.start = () => {
      throw new Error('Quantity review cannot open a browser');
    };
    return application;
  };
  let app = open();
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const carton = gunzipSync(
    await readFile(
      new URL(
        '../../docs/acceptance/ice-dual-units/expanded-root-pongta-carton.html.gz',
        import.meta.url
      )
    )
  );
  const original = await app.importCapture({ url, html: carton, observedAt });
  const listing = (await app.store.list('evidence')).find(
    (entry) =>
      entry.role === 'listing' &&
      original.product.evidenceIds.includes(entry.id) &&
      entry.html?.sha256 === cartonSha256
  );
  assert.ok(listing, 'the genuine selected-carton original must be attached');
  const image = await app.store.putBlob(
    await readFile(
      new URL(
        '../../docs/acceptance/ice-dual-units/expanded-powercap-abc-front.png',
        import.meta.url
      )
    )
  );
  assert.equal(image.sha256, wrapperSha256);
  const leaf = await app.store.put('evidence', {
    id: `package-label:${wrapperSha256}:${original.product.id}`,
    role: 'ocr',
    productId: original.product.id,
    url: wrapperUrl,
    image,
    observedAt,
  });
  const product = await app.store.put('product', {
    ...original.product,
    evidenceIds: [...original.product.evidenceIds, leaf.id],
  });
  const review = {
    reviewedBy: 'Independent cached-original label reviewer',
    reason:
      'The selected24-bottle chocolate carton matches the original PowerCap Choco Flavor Ice Tube wrapper, printed130mL and131g. This is quantity-only review; factory nutrition, current lot and freight remain unverified.',
    listingEvidenceId: listing.id,
    listingSha256: cartonSha256,
    facts: {
      netMassG: {
        value: 131,
        unit: 'g',
        basis: 'one-inner-food-package',
        sourceEvidenceId: leaf.id,
        sourceSha256: wrapperSha256,
        sourceAuthority: 'manufacturer-label-secondary-host',
        excerpt: '130mL; 净含量131克',
        identityMatched: true,
      },
    },
  };
  const stop = await app.store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
    sourceUrl: 'https://www.optimumnutrition.com/',
  });
  return {
    get app() {
      return app;
    },
    directory,
    product,
    offer: original.offer,
    listing,
    leaf,
    review,
    stop,
    async restart() {
      await app.close();
      app = open();
      return app;
    },
  };
}

async function cli(directory, args) {
  const result = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      ...args,
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
    ],
    { timeout: 30000, maxBuffer: 4 * 1024 ** 2 }
  );
  return JSON.parse(result.stdout);
}

async function telegram(t, app) {
  const messages = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const sent = JSON.parse(Buffer.concat(chunks).toString());
    messages.push(sent.text);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: messages.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: sent.text,
        },
      })
    );
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const bot = createTelegramBot({
    application: app,
    token: '123:TEST',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: `http://127.0.0.1:${api.address().port}`, fetch },
  });
  let count = 0;
  return {
    async send(text) {
      const before = messages.length;
      await bot.handleUpdate({
        update_id: ++count,
        message: {
          message_id: count,
          date: 0,
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat: { id: 777, type: 'private' },
          text,
          entities: [
            {
              offset: 0,
              length: text.split(' ')[0].length,
              type: 'bot_command',
            },
          ],
        },
      });
      return messages.slice(before).join('');
    },
  };
}

function comparison(report, { reviewed = true, quantity = 1 } = {}) {
  assert.equal(report.observedPrices.length, reviewed ? 1 : 0);
  assert.equal(report.comparisons.length, 1);
  const row = report.comparisons[0];
  assert.equal(row.offer.sku, '3040048563_VNAMZ-14623760583');
  assert.equal(row.offer.price, 648000);
  assert.equal(row.offer.observedAt, observedAt);
  assert.equal(row.product.packCount, 24);
  assert.equal(row.product.netVolumeMl, 130);
  assert.equal(row.metrics.totalVolumeMl, 3120 * quantity);
  assert.equal(row.metrics.costPerMlBeforeDelivery, 648000 / 3120);
  assert.equal(row.metrics.totalMassG, reviewed ? 3144 * quantity : null);
  assert.equal(
    row.metrics.costPerGramBeforeDelivery,
    reviewed ? 648000 / 3144 : null
  );
  assert.equal(row.metrics.totalBeforeDelivery, 648000 * quantity);
  assert.equal(row.metrics.totalProteinG, null);
  assert.equal(row.metrics.costPerProteinGramBeforeDelivery, null);
  assert.equal(row.metrics.totalAfterDelivery, null);
  assert.equal(row.metrics.costPerGramAfterDelivery, null);
  assert.equal(row.metrics.costPerMlAfterDelivery, null);
  assert.equal(row.offer.deliveryAvailable, false);
  assert.equal(row.manufacturerVerified, false);
  assert.notEqual(row.product.manufacturerVerification?.identityMatched, true);
  assert.ok(
    row.problems.includes('The listing cannot deliver to this destination')
  );
  assert.equal(report.ranked.length, 0);
  if (reviewed) {
    const claim = row.product.claims.find(
      (entry) => entry.field === 'netMassG' && entry.value === 131
    );
    assert.ok(claim);
    assert.equal(claim.sourceAuthority, 'manufacturer-label-secondary-host');
    assert.notEqual(claim.source, 'manufacturer');
  }
  return row;
}

function reviewedReceipt(receipt, product) {
  assert.equal(receipt.productId, product.id);
  assert.equal(receipt.sku, product.sku);
  assert.equal(receipt.observedAt, observedAt);
  assert.equal(receipt.facts.netMassG.value, 131);
  assert.equal(receipt.facts.netMassG.sourceSha256, wrapperSha256);
  assert.equal(
    receipt.facts.netMassG.sourceAuthority,
    'manufacturer-label-secondary-host'
  );
  assert.equal(receipt.listingSha256, cartonSha256);
  assert.match(receipt.reviewSha256, /^[a-f\d]{64}$/u);
}

test('genuine quantity-only review survives library, actual CLI, HTTP, Telegram and restart without inventing nutrition or Nha Trang freight', async (t) => {
  const state = await setup(t);
  comparison(await state.app.compare(options), { reviewed: false });
  const library = await reviewPackageQuantities(
    state.app,
    state.product.id,
    state.review
  );
  reviewedReceipt(library, state.product);
  comparison(await state.app.compare(options));
  const reviewPath = join(state.directory, 'quantity-review.json');
  await writeFile(reviewPath, JSON.stringify(state.review));
  reviewedReceipt(
    await cli(state.directory, [
      'review-package-quantities',
      state.product.id,
      reviewPath,
    ]),
    state.product
  );
  comparison(
    await cli(state.directory, [
      'compare',
      '--category',
      options.category,
      '--allow-stale',
      '--flavour-scope',
      scope,
      '--sort',
      options.sort,
    ])
  );
  await state.restart();
  comparison(await state.app.compare(options));
  const http = await startServer({ application: state.app, port: 0 });
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const origin = `http://127.0.0.1:${http.address().port}`;
  const operation = {
    operation: 'review-package-quantities',
    input: { productId: state.product.id, review: state.review },
  };
  const response = await fetch(`${origin}/api/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(operation),
  });
  assert.equal(response.status, 200);
  reviewedReceipt(await response.json(), state.product);
  const report = await fetch(
    `${origin}/api/compare?${new URLSearchParams(options)}`
  );
  assert.equal(report.status, 200);
  comparison(await report.json());
  const bot = await telegram(t, state.app);
  reviewedReceipt(
    JSON.parse(await bot.send(`/operation ${JSON.stringify(operation)}`)),
    state.product
  );
  const text = await bot.send(
    `/compare --category ${options.category} --allow-stale --flavour-scope ${scope} --sort ${options.sort}`
  );
  assert.match(text, /Food quantities: 3144\.00 g; 3120\.00 ml/u);
  assert.match(text, /Food g: 206\.11/u);
  assert.match(text, /ml: 207\.69/u);
  assert.match(text, /Manufacturer verification pending/u);
  assert.match(text, /cannot deliver to this destination/u);
  comparison(await state.app.compare({ ...options, quantity: 2 }), {
    quantity: 2,
  });
  assert.deepEqual(
    await state.app.store.get('product', state.product.id),
    state.product,
    'quantity reviews apply at read time, without rewriting the capture'
  );
  assert.deepEqual(
    await state.app.store.get('offer', state.offer.id),
    state.offer
  );
  assert.deepEqual(
    await state.app.store.get('collection-stop', state.stop.id),
    state.stop
  );
  assert.equal(state.app.cache.stats.downloads, 0);
  assert.equal(state.app.cache.stats.misses, 0);
});

test('quantity review rejects unsupported nutrients, wrong immutable digests and unattached originals before writing', async (t) => {
  const state = await setup(t);
  for (const [name, change] of [
    [
      'unsupported nutrient',
      (review) => {
        review.facts.proteinPerPackageG = {
          ...review.facts.netMassG,
          value: 1,
        };
      },
    ],
    [
      'wrong label digest',
      (review) => {
        review.facts.netMassG.sourceSha256 = '0'.repeat(64);
      },
    ],
    [
      'wrong listing digest',
      (review) => {
        review.listingSha256 = '0'.repeat(64);
      },
    ],
    [
      'unattached label',
      (review) => {
        review.facts.netMassG.sourceEvidenceId = 'unattached-label';
      },
    ],
    [
      'nonpositive food amount',
      (review) => {
        review.facts.netMassG.value = 0;
      },
    ],
    [
      'wrong mass unit',
      (review) => {
        review.facts.netMassG.unit = 'ml';
      },
    ],
  ]) {
    await t.test(name, async () => {
      const review = globalThis.structuredClone(state.review);
      change(review);
      await assert.rejects(() =>
        reviewPackageQuantities(state.app, state.product.id, review)
      );
      assert.equal(
        (await state.app.store.list('package-quantity-review')).length,
        0
      );
      comparison(await state.app.compare(options), { reviewed: false });
    });
  }
  assert.equal(state.app.cache.stats.downloads, 0);
});

test('changed or invalidated original label bytes withhold reviewed mass while independent marketplace volume survives', async (t) => {
  for (const mutation of [
    'corrupt bytes',
    'missing bytes',
    'source invalidation',
  ]) {
    await t.test(mutation, async (t) => {
      const state = await setup(t);
      await reviewPackageQuantities(state.app, state.product.id, state.review);
      comparison(await state.app.compare(options));
      const path = join(
        state.directory,
        'blobs',
        wrapperSha256.slice(0, 2),
        wrapperSha256
      );
      if (mutation === 'corrupt bytes') {
        await writeFile(path, Buffer.from('changed original wrapper bytes'));
      } else if (mutation === 'missing bytes') {
        await rm(path);
      } else {
        await state.app.cache.invalidate(wrapperUrl, {
          reason: 'Exact original package label needs correction',
        });
      }
      comparison(await state.app.compare(options), { reviewed: false });
      await state.restart();
      comparison(await state.app.compare(options), { reviewed: false });
      assert.equal(state.app.cache.stats.downloads, 0);
    });
  }
});

test('a new selected capture identity or observation cannot inherit an older quantity review', async (t) => {
  for (const mutation of [
    'new observation',
    'new listing digest',
    'different SKU',
  ]) {
    await t.test(mutation, async (t) => {
      const state = await setup(t);
      await reviewPackageQuantities(state.app, state.product.id, state.review);
      comparison(await state.app.compare(options));
      if (mutation === 'new observation') {
        await state.app.store.put('product', {
          ...state.product,
          observedAt: '2026-10-11T17:25:00.000Z',
        });
      } else if (mutation === 'new listing digest') {
        await state.app.store.put('evidence', {
          ...state.listing,
          html: await state.app.store.putBlob(
            Buffer.concat([
              await state.app.store.blob(cartonSha256),
              Buffer.from('\n<!-- newly captured original -->'),
            ])
          ),
        });
      } else {
        await state.app.store.put('package-quantity-review', {
          ...(await state.app.store.get(
            'package-quantity-review',
            state.product.id
          )),
          sku: '3040048563_VNAMZ-14623760584',
        });
      }
      comparison(await state.app.compare(options), { reviewed: false });
      await state.restart();
      comparison(await state.app.compare(options), { reviewed: false });
      assert.equal(state.app.cache.stats.downloads, 0);
    });
  }
});
