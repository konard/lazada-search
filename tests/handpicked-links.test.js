import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { extractPage } from '../src/browser.js';
import {
  registerHandpickedLinks,
  resolveHandpickedLinks,
  handpickedLinkStatus,
} from '../src/handpicked-links.js';
import { draftWorkflowFixture } from './helpers/draft-workflows.js';

async function original(app, store, url = 'https://s.lazada.vn/fixture') {
  const resolvedUrl = 'https://www.lazada.vn/products/fixture-i9000-s8000.html';
  const html =
    '<html><head><title>Chocolate whey powder 1000g</title></head><body>' +
    '<h1 class="pdp-product-title">Chocolate whey powder 1000g</h1>' +
    '<span class="pdp-price">600.000 ₫</span>' +
    '<li class="key-li"><span class="key-title">SKU</span>' +
    '<span class="key-value">9000_VNAMZ-8000</span></li></body></html>';
  const blob = await store.putBlob(Buffer.from(html));
  const { document } = parseHTML(html);
  const cache = await store.put('cache', {
    id: 'cache:short-fixture',
    url,
    finalUrl: resolvedUrl,
    status: 'ok',
    fetchedAt: Date.now(),
    html: blob,
    snapshot: extractPage({ document, url: resolvedUrl }),
  });
  let calls = 0;
  app.collector.page = () => {
    calls += 1;
    return Promise.resolve(cache);
  };
  return { cache, calls: () => calls, url, resolvedUrl };
}

test('original-bound short-link resolution preserves exact selected SKU and reuses it without another page request', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const source = await original(app, store);
  const registered = await registerHandpickedLinks(app, {
    links: [source.url, source.url],
  });
  assert.equal(registered.submissions.length, 2);
  assert.equal(registered.uniqueLinks, 1);
  assert.equal(registered.submissions[0].sourceVerified, false);
  const first = await resolveHandpickedLinks(app);
  assert.equal(source.calls(), 1);
  assert.equal(first.links[0].sourceVerified, true);
  assert.equal(first.links[0].sku, '9000_VNAMZ-8000');
  assert.equal(first.links[0].status, 'captured');
  assert.deepEqual(first.links[0].capturedOfferIds, ['draft-offer-0']);
  const second = await resolveHandpickedLinks(app);
  assert.equal(source.calls(), 1);
  assert.equal(second.links[0].reused, true);
  assert.equal(
    (await handpickedLinkStatus(app)).links[0].sourceValidation,
    'cache-original-digest-and-observation-verified'
  );
});

test('supplied aliases, corrupt originals, conflicting current prices and source invalidations never certify a short link', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const source = await original(app, store);
  const input = {
    submittedUrl: source.url,
    resolvedUrl: source.resolvedUrl,
    sku: '9000_VNAMZ-8000',
  };
  const registered = await registerHandpickedLinks(app, { links: [input] });
  assert.equal(registered.submissions[0].sourceVerified, false);
  await resolveHandpickedLinks(app);
  const replaced = await store.putBlob(Buffer.from('different original body'));
  await store.put('cache', { ...source.cache, html: replaced });
  assert.equal(
    (await handpickedLinkStatus(app)).links[0].sourceVerified,
    false
  );
  await store.put('cache', source.cache);
  const offer = await store.get('offer', 'draft-offer-0');
  await store.put('offer', {
    ...offer,
    id: 'conflicting-offer',
    price: offer.price - 1,
  });
  assert.equal(
    (await handpickedLinkStatus(app)).links[0].status,
    'resolved-price-and-exact-sku-pending'
  );
  await store.put('invalidation', {
    id: 'invalidate-short-original',
    cacheIds: [source.cache.id],
    invalidated: true,
  });
  const invalid = (await handpickedLinkStatus(app)).links[0];
  assert.equal(invalid.sourceVerified, false);
  assert.deepEqual(invalid.capturedOfferIds, []);
});

test('a persisted challenge blocks handpicked network resolution before collector access', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  await registerHandpickedLinks(app, {
    links: ['https://s.lazada.vn/unresolved-fixture'],
  });
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    reason: 'challenge',
  });
  let requests = 0;
  app.collector.page = () => {
    requests += 1;
    throw new Error('Must not request');
  };
  const result = await resolveHandpickedLinks(app, { allowNetwork: true });
  assert.equal(requests, 0);
  assert.equal(result.links[0].errorCode, 'COLLECTION_STOPPED');
  assert.equal(
    (await store.get('collection-stop', 'browser-collection')).active,
    true
  );
  await assert.rejects(
    registerHandpickedLinks(app, {
      links: ['https://lazada.vn.evil.example/products/x-i1.html'],
    }),
    /Vietnam/u
  );
});
