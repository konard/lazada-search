import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import { parseHTML } from 'linkedom';
import {
  discoverLazadaCheckoutSnapshot,
  importLazadaCheckoutSnapshot,
  lazadaCheckoutAdapterStatus,
} from '../src/lazada-checkout-adapter.js';
import {
  capturePreparedLazadaCheckout,
  waitPreparedCheckoutStable,
} from '../src/lazada-checkout-capture.js';
import {
  prepareLazadaCheckoutScenario,
  runPreparedLazadaCheckoutScenarios,
} from '../src/lazada-checkout-actions.js';
import { planCheckoutScenarios } from '../src/checkout-scenarios.js';

const original = `<html><body>
<div id="address">Khánh Hòa, Phường Nha Trang</div>
<div id="line" data-item-id="100" data-sku-id="11" data-row-key="cart-100">
<input id="selected" type="checkbox" checked>
<input id="quantity" type="number" value="2">
<span id="unit">100.000 ₫</span><span id="subtotal">200.000 ₫</span>
<span id="stock">3</span><span id="available">Còn hàng</span><span id="eligible">Số lượng hợp lệ</span>
</div>
<span id="shipping">20.000 ₫</span><span id="total">200.000 ₫</span>
<span id="voucher-id">MERCH20</span><span id="voucher-amount">-20.000 ₫</span>
<span id="payment">Cash on delivery</span><span id="vouchers">MERCH20 applied</span>
<script id="state" type="application/json">{"rows":[{"key":"cart-100","itemId":"100","skuId":"11","quantity":2,"stock":3,"available":true,"allowedQuantity":2}]}</script>
</body></html>`;

function source(html = original) {
  return {
    sourceUrl: 'https://cart.lazada.vn/cart',
    sourceSha256: sha256(html),
    evidenceId: `checkout-fixture:${sha256(html)}`,
    observedAt: new Date(Date.now() - 1000).toISOString(),
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
  };
}

function layout() {
  return {
    id: 'reviewed-original-test-layout',
    reviewed: true,
    reviewedBy: 'Draft reviewer',
    reviewedAt: new Date().toISOString(),
    selectors: {
      destination: '#address',
      shipping: '#shipping',
      total: '#total',
      paymentMethod: '#payment',
      voucherState: '#vouchers',
    },
    lines: [
      {
        offerId: 'offer:100-11',
        sku: '100_VNAMZ-11',
        identityBinding: {
          kind: 'attributes',
          rowSelector: '#line',
          itemId: { selector: '#line', attribute: 'data-item-id' },
          skuId: { selector: '#line', attribute: 'data-sku-id' },
          selection: { selector: '#selected', attribute: 'checked' },
        },
        quantityBinding: { selector: '#quantity', attribute: 'value' },
        selectors: {
          unitPrice: '#unit',
          subtotal: '#subtotal',
          stock: '#stock',
          availability: '#available',
          eligibility: '#eligible',
        },
      },
    ],
    appliedDiscounts: [
      {
        id: 'MERCH20',
        scope: 'merchandise',
        selector: '#voucher-amount',
        identitySelector: '#voucher-id',
        amountSign: 'negative-reduction',
      },
    ],
  };
}

const offer = {
  id: 'offer:100-11',
  productId: 'product:100-11',
  sku: '100_VNAMZ-11',
  url: 'https://www.lazada.vn/products/pdp-i100-s11.html',
  currency: 'VND',
  price: 100000,
  available: true,
  variantConfirmed: true,
  observedAt: '2026-10-10T00:00:00.000Z',
};

test('draft checkout extracts original attribute identities and reconciles signed discounts without HTML rewriting', () => {
  const before = original;
  const result = discoverLazadaCheckoutSnapshot(original, source(), {
    layout: layout(),
    offers: [offer],
  });
  assert.equal(result.status, 'mapping-ready');
  assert.equal(result.quote.lines[0].sku, '100_VNAMZ-11');
  assert.equal(result.quote.lines[0].quantity, 2);
  assert.equal(result.quote.merchandiseSubtotal, 200000);
  assert.equal(result.quote.shipping, 20000);
  assert.equal(result.quote.discount, 20000);
  assert.equal(result.quote.total, 200000);
  assert.equal(original, before);
  assert.equal(result.checkoutLayoutLiveVerified, false);
  assert.equal(result.purchaseReady, false);
});

test('draft checkout original selected JSON row supplies exact item/SKU, quantity and stock without visible SKU text', () => {
  const mapped = layout();
  mapped.lines[0].identityBinding = {
    kind: 'embedded-json',
    rowSelector: '#line',
    scriptSelector: '#state',
    rowsPointer: '/rows',
    rowIndex: 0,
    itemIdPointer: '/itemId',
    skuIdPointer: '/skuId',
    rowKeyPointer: '/key',
    rowKeyAttribute: 'data-row-key',
    selection: { selector: '#selected', attribute: 'checked' },
  };
  mapped.lines[0].quantityBinding = {
    kind: 'embedded-json',
    pointer: '/quantity',
  };
  mapped.lines[0].stockBinding = { kind: 'embedded-json', pointer: '/stock' };
  mapped.lines[0].availabilityBinding = {
    kind: 'embedded-json',
    pointer: '/available',
  };
  mapped.lines[0].eligibilityBinding = {
    kind: 'embedded-json',
    pointer: '/allowedQuantity',
  };
  const result = discoverLazadaCheckoutSnapshot(original, source(), {
    layout: mapped,
    offers: [offer],
  });
  assert.equal(result.quote.lines[0].quantity, 2);
  assert.equal(result.quote.lines[0].sourceIdentity.kind, 'embedded-json');
  const wrong = original.replace(
    'data-row-key="cart-100"',
    'data-row-key="cart-other"'
  );
  assert.equal(
    discoverLazadaCheckoutSnapshot(wrong, source(wrong), {
      layout: mapped,
      offers: [offer],
    }).mapping,
    null
  );
});

for (const [name, change] of [
  [
    'wrong exact SKU',
    (html) => html.replace('data-sku-id="11"', 'data-sku-id="12"'),
  ],
  [
    'unselected source row',
    (html) => html.replace('type="checkbox" checked', 'type="checkbox"'),
  ],
  [
    'hidden source price',
    (html) => html.replace('id="unit"', 'id="unit" hidden'),
  ],
  [
    'wrong total',
    (html) => html.replace('id="total">200.000', 'id="total">199.000'),
  ],
  [
    'insufficient exact stock',
    (html) => html.replace('id="stock">3', 'id="stock">1'),
  ],
  [
    'unresolved dialog',
    (html) =>
      html.replace('<body>', '<body><div role="dialog">Confirm first</div>'),
  ],
  [
    'visible challenge',
    (html) =>
      html.replace(
        '<body>',
        '<body><div data-captcha>Verify to continue</div>'
      ),
  ],
  [
    'unresolved original loading',
    (html) => html.replace('<body>', '<body data-loading="true">'),
  ],
  [
    'duplicated original unit price',
    (html) =>
      html.replace('</body>', '<span id="unit">100.000 ₫</span></body>'),
  ],
  [
    'another row stock proof',
    (html) =>
      html
        .replace('<span id="stock">3</span>', '')
        .replace('</body>', '<span id="stock">3</span></body>'),
  ],
]) {
  test(`draft checkout withholds an accepted mapping for ${name}`, () => {
    const html = change(original);
    const result = discoverLazadaCheckoutSnapshot(html, source(html), {
      layout: layout(),
      offers: [offer],
    });
    assert.equal(result.mapping, null);
    assert.ok(result.gaps.length > 0);
  });
}

test('draft checkout rejects wrong original SHA and persists/replays private source gaps with invalidation', async (t) => {
  assert.throws(
    () =>
      discoverLazadaCheckoutSnapshot(original, {
        ...source(),
        sourceSha256: '0'.repeat(64),
      }),
    /digest/u
  );
  const directory = await mkdtemp(join(tmpdir(), 'lazada-checkout-draft-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  await store.put('offer', offer);
  const app = { store };
  const metadata = source();
  const imported = await importLazadaCheckoutSnapshot(app, {
    html: original,
    metadata,
    layout: layout(),
  });
  assert.ok(imported.quoteId);
  assert.equal(
    (await store.get('evidence', metadata.evidenceId)).visibility,
    'private'
  );
  assert.equal(
    (await lazadaCheckoutAdapterStatus(app, { observationId: imported.id }))
      .counts.mappingReady,
    1
  );
  await store.put('invalidation', {
    id: metadata.sourceUrl,
    url: metadata.sourceUrl,
    invalidatedAt: new Date().toISOString(),
  });
  const checked = await lazadaCheckoutAdapterStatus(app, {
    observationId: imported.id,
  });
  assert.equal(checked.counts.mappingReady, 0);
  assert.equal(checked.observations[0].mapping, null);
  assert.equal(checked.observations[0].quote, null);
});

test('draft prepared capture requires private visibility and honours global CAPTCHA before touching browser state', async () => {
  let touched = 0;
  const collector = {
    tail: Promise.resolve(),
    runtime: {
      page: {},
      touch: () => {
        touched += 1;
      },
    },
  };
  await assert.rejects(
    capturePreparedLazadaCheckout({
      collector,
      store: { visibility: 'public' },
    }),
    /private/u
  );
  await assert.rejects(
    capturePreparedLazadaCheckout({
      collector,
      store: { visibility: 'private', get: async () => ({ active: true }) },
    }),
    (error) => error.code === 'COLLECTION_STOPPED'
  );
  assert.equal(touched, 0);
});

// Exercise the production page-realm inspectors against an actual DOM, while
// modelling browser-only live properties separately from preserved attributes.
// A virtual clock accepts minute pacing without accessing any browser or site.
async function withVirtualClock(run) {
  const DateConstructor = globalThis.Date;
  const clock = { now: DateConstructor.now() };
  globalThis.Date = class extends DateConstructor {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  };
  try {
    return await run(clock);
  } finally {
    globalThis.Date = DateConstructor;
  }
}

function browserStyle(node) {
  return {
    display: /display\s*:\s*none/iu.test(node.getAttribute('style') || '')
      ? 'none'
      : 'block',
    visibility:
      node
        .getAttribute('style')
        ?.match(/visibility\s*:\s*(hidden|collapse)/iu)?.[1] || 'visible',
  };
}

function preparedPage(html, clock) {
  const { document } = parseHTML(html);
  // Browser-shaped original DOM includes HEAD before recording its baseline.
  if (!document.querySelector('head')) {
    document.documentElement.prepend(document.createElement('head'));
  }
  const liveValues = new Map();
  const liveChecked = new Map();
  const page = {
    document,
    sourceUrl: 'https://cart.lazada.vn/cart',
    mutations: [],
    keys: [],
    scrolls: [],
    waits: [],
    contentReads: 0,
    onWait: undefined,
    onMutation: undefined,
    onScroll: undefined,
    url: () => page.sourceUrl,
    isClosed: () => false,
    async content() {
      page.contentReads += 1;
      return document.toString();
    },
    async waitForTimeout(ms) {
      page.waits.push(ms);
      clock.now += ms;
      await page.onWait?.(page, clock);
    },
  };
  Object.defineProperty(document, 'readyState', { value: 'complete' });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: 1200,
  });
  for (const node of document.querySelectorAll('*')) {
    Object.defineProperty(node, 'innerText', { get: () => node.textContent });
    node.getClientRects = () =>
      node.hidden ? [] : [node.getBoundingClientRect()];
    node.getBoundingClientRect = () => ({
      top: 200,
      bottom: 230,
      left: 100,
      right: 400,
    });
    if (node.tagName === 'INPUT') {
      liveValues.set(node, node.getAttribute('value') || '');
      liveChecked.set(node, node.hasAttribute('checked'));
      Object.defineProperty(node, 'value', { get: () => liveValues.get(node) });
      Object.defineProperty(node, 'checked', {
        get: () => liveChecked.get(node),
      });
    }
  }
  const inRealm = async (fn, ...args) => {
    const globals = {
      document,
      location: new URL(page.sourceUrl),
      getComputedStyle: browserStyle,
      innerHeight: 800,
      innerWidth: 1400,
      scrollY: 0,
      performance: { now: () => clock.now },
      scrollTo: (options) => {
        page.scrolls.push(options);
        page.onScroll?.(page, options);
      },
      requestAnimationFrame: (callback) => {
        clock.now += 16;
        globalThis.queueMicrotask(() => callback(clock.now));
      },
    };
    const prior = new Map(
      Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ])
    );
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    }
    try {
      return await fn(...args);
    } finally {
      for (const [key, descriptor] of prior) {
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          delete globalThis[key];
        }
      }
    }
  };
  page.evaluate = (fn, arg) => inRealm(fn, arg);
  page.locator = (selector) => {
    const node = () => {
      const matches = document.querySelectorAll(selector);
      assert.equal(
        matches.length,
        1,
        `One original control expected for ${selector}`
      );
      return matches[0];
    };
    const mutate = async (kind, value) => {
      page.mutations.push({ kind, selector, value, at: clock.now });
      if (kind === 'fill') {
        liveValues.set(node(), value);
      } else {
        liveChecked.set(node(), value);
      }
      await page.onMutation?.(page, { kind, selector, value });
    };
    return {
      count: async () => document.querySelectorAll(selector).length,
      isVisible: async () => {
        for (let current = node(); current; current = current.parentElement) {
          if (
            current.hidden ||
            current.getAttribute('aria-hidden') === 'true' ||
            browserStyle(current).display === 'none' ||
            browserStyle(current).visibility !== 'visible'
          ) {
            return false;
          }
        }
        return true;
      },
      isEnabled: async () => !node().hasAttribute('disabled'),
      isChecked: async () => liveChecked.get(node()) === true,
      getAttribute: async (name) => node().getAttribute(name),
      inputValue: async () => liveValues.get(node()),
      evaluate: (fn, arg) => inRealm(fn, node(), arg),
      fill: (value) => mutate('fill', value),
      check: () => mutate('check', true),
      uncheck: () => mutate('uncheck', false),
      press: async (key) => {
        page.keys.push(key);
        assert.equal(key, 'Tab', 'Submission keys are forbidden');
      },
    };
  };
  return page;
}

async function privateFixture(t, clock, html = original, quantity = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-prepared-local-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory, visibility: 'private' });
  await store.put('offer', offer);
  await store.put('product', {
    id: offer.productId,
    url: offer.url,
    title: 'Chocolate whey protein',
    category: 'whey',
    selectedVariant: [{ text: 'Chocolate' }],
    claims: [],
    evidenceIds: [],
    observedAt: new Date().toISOString(),
  });
  const page = preparedPage(html, clock);
  const pacing = [];
  const app = {
    store,
    cache: { scheduler: { intervalMs: 60000 } },
    collector: {
      tail: Promise.resolve(),
      runtime: {
        page,
        touch: async () => {},
        pace: async (...args) => pacing.push(args),
      },
    },
  };
  const plan = await planCheckoutScenarios(app, {
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
    lines: [{ offerId: offer.id, sku: offer.sku, quantities: [quantity] }],
    voucherSelections: [{ text: 'MERCH20 applied', voucherIds: ['MERCH20'] }],
    paymentMethods: ['Cash on delivery'],
  });
  return { app, store, page, pacing, plan };
}

const actionHtml = original.replace(
  '</body>',
  `<input id="voucher-toggle" type="checkbox" value="MERCH20">
<input id="pay-cod" type="radio" value="cod"></body>`
);
function actionLayout() {
  return {
    ...layout(),
    actionBindings: {
      quantityInputs: [
        { offerId: offer.id, sku: offer.sku, selector: '#quantity' },
      ],
      vouchers: [
        {
          id: 'MERCH20',
          selector: '#voucher-toggle',
          identityAttribute: 'value',
          identityValue: 'MERCH20',
        },
      ],
      payments: [
        {
          text: 'Cash on delivery',
          selector: '#pay-cod',
          identityAttribute: 'value',
          identityValue: 'cod',
        },
      ],
    },
  };
}
function preparationInput(plan, overrides = {}) {
  return {
    planId: plan.plan.id,
    scenarioId: plan.scenarios[0].id,
    layout: actionLayout(),
    allowCartChanges: true,
    ...overrides,
  };
}

test('prepared checkout readiness waits for loading and stable totals, but never clicks a dialog or follows navigation', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, page } = await privateFixture(t, clock);
    page.document.body.setAttribute('data-loading', 'true');
    const started = clock.now;
    page.onWait = () => {
      if (clock.now - started >= 1000) {
        page.document.body.removeAttribute('data-loading');
      }
    };
    await waitPreparedCheckoutStable(app, page, { timeoutMs: 5000 });
    assert.ok(clock.now - started >= 3000);
    assert.equal(page.mutations.length, 0);
    page.document.body.setAttribute('role', 'dialog');
    await assert.rejects(waitPreparedCheckoutStable(app, page), /dialog/u);
    page.document.body.removeAttribute('role');
    page.sourceUrl = 'https://cart.lazada.vn/checkout';
    await assert.rejects(
      waitPreparedCheckoutStable(app, page, {
        sourceUrl: 'https://cart.lazada.vn/cart',
      }),
      /URL changed/u
    );
  });
});

test('prepared checkout capture preserves originals privately, enforces live properties and never scrolls', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, store, page, pacing } = await privateFixture(t, clock);
    const before = await page.content();
    const captured = await capturePreparedLazadaCheckout(app, {
      layout: layout(),
      deliveryArea: 'Nha Trang',
    });
    assert.ok(captured.quoteId);
    assert.equal(await page.content(), before);
    assert.equal((await store.list('evidence'))[0].visibility, 'private');
    assert.deepEqual(pacing, [['https://cart.lazada.vn/cart', 60000]]);
    assert.deepEqual(page.scrolls, []);
    assert.deepEqual(page.mutations, []);
    await page.locator('#quantity').fill('1');
    await assert.rejects(
      capturePreparedLazadaCheckout(app, {
        layout: layout(),
        deliveryArea: 'Nha Trang',
      }),
      /Live quantity property/u
    );
    assert.equal((await store.list('checkout-adapter')).length, 1);
  });
});

test('prepared checkout readonly sweep validates its exact saved scenario with zero cart changes', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, page, plan } = await privateFixture(t, clock);
    const result = await runPreparedLazadaCheckoutScenarios(app, {
      planId: plan.plan.id,
      layout: layout(),
      maxScenarios: 1,
    });
    assert.equal(result.results[0].preparation.readonly, true);
    assert.equal(result.results[0].capture.results[0].status, 'validated');
    assert.deepEqual(page.mutations, []);
    assert.deepEqual(page.keys, []);
    assert.equal(result.purchases, 0);
    await assert.rejects(
      prepareLazadaCheckoutScenario(
        app,
        preparationInput(plan, { allowCartChanges: false })
      ),
      /disabled by default/u
    );
  });
});

test('prepared scenario changes only reviewed quantity/voucher/payment controls with minute pacing and no submit keys', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, store, page, plan } = await privateFixture(
      t,
      clock,
      actionHtml,
      1
    );
    const started = clock.now;
    const result = await prepareLazadaCheckoutScenario(
      app,
      preparationInput(plan, { intervalMs: 1 })
    );
    assert.equal(result.cartMutations, 3);
    assert.deepEqual(
      page.mutations.map((entry) => [entry.kind, entry.selector, entry.value]),
      [
        ['fill', '#quantity', '1'],
        ['check', '#voucher-toggle', true],
        ['check', '#pay-cod', true],
      ]
    );
    assert.ok(page.mutations[0].at - started >= 60000);
    for (let index = 1; index < page.mutations.length; index += 1) {
      assert.ok(
        page.mutations[index].at - page.mutations[index - 1].at >= 60000
      );
    }
    assert.deepEqual(page.keys, ['Tab']);
    assert.equal(result.purchases, 0);
    assert.equal(result.payments, 0);
    assert.equal(result.navigation, 0);
    assert.equal(
      (await store.get('checkout-action-clock', 'lazada-vn')).visibility,
      'private'
    );
    assert.equal(
      page.document.querySelector('#quantity').getAttribute('value'),
      '2'
    );
  });
});

for (const [name, change, expected] of [
  [
    'different original item',
    (page) =>
      page.document.querySelector('#line').setAttribute('data-item-id', '101'),
    /item\/SKU changed/u,
  ],
  [
    'wrong delivery area',
    (page) => {
      page.document.querySelector('#address').textContent = 'Hồ Chí Minh';
    },
    /destination differs/u,
  ],
  [
    'insufficient stock',
    (page) => {
      page.document.querySelector('#stock').textContent = '0';
    },
    /stock/u,
  ],
  [
    'submission-shaped quantity input',
    (page) =>
      page.document
        .querySelector('#quantity')
        .setAttribute('name', 'place-order'),
    /submission controls/u,
  ],
]) {
  test(`prepared scenario rejects ${name} before the first mutation`, async (t) => {
    await withVirtualClock(async (clock) => {
      const { app, page, plan } = await privateFixture(t, clock, actionHtml, 1);
      change(page);
      await assert.rejects(
        prepareLazadaCheckoutScenario(app, preparationInput(plan)),
        expected
      );
      assert.deepEqual(page.mutations, []);
      assert.deepEqual(page.keys, []);
    });
  });
}

for (const blocker of ['dialog', 'destination', 'captcha']) {
  test(`prepared scenario stops later mutations when ${blocker} appears during paced waiting`, async (t) => {
    await withVirtualClock(async (clock) => {
      const { app, store, page, plan } = await privateFixture(
        t,
        clock,
        actionHtml,
        1
      );
      page.onWait = () => {
        if (page.mutations.length === 1) {
          if (blocker === 'dialog') {
            page.document.body.setAttribute('role', 'dialog');
          } else if (blocker === 'destination') {
            page.document.querySelector('#address').textContent = 'Hồ Chí Minh';
          } else {
            page.document.body.setAttribute('data-captcha', 'true');
          }
        }
      };
      await assert.rejects(
        prepareLazadaCheckoutScenario(app, preparationInput(plan)),
        /dialog|destination|Collection stopped/u
      );
      assert.equal(page.mutations.length, 1);
      if (blocker === 'captcha') {
        assert.equal(
          (await store.get('collection-stop', 'browser-collection')).active,
          true
        );
        await assert.rejects(
          capturePreparedLazadaCheckout(app),
          (error) => error.code === 'COLLECTION_STOPPED'
        );
      }
    });
  });
}

test('prepared scenario rejects soy, other flavours, shaker bundles and superseded exact offers before mutation', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, store, page, plan } = await privateFixture(
      t,
      clock,
      actionHtml,
      1
    );
    const product = await store.get('product', offer.productId);
    for (const [category, flavour] of [
      ['protein-powder', 'Soy isolate chocolate'],
      ['whey', 'Vanilla'],
      ['whey', 'Chocolate + Shaker'],
    ]) {
      await store.put('product', {
        ...product,
        category,
        title: flavour,
        selectedVariant: [{ text: flavour }],
      });
      await assert.rejects(
        prepareLazadaCheckoutScenario(app, preparationInput(plan)),
        /soy, unrelated foods, other flavours/u
      );
    }
    await store.put('product', product);
    await store.put('offer', { ...offer, supersededBy: 'new-original-offer' });
    await assert.rejects(
      prepareLazadaCheckoutScenario(app, preparationInput(plan)),
      /current exact available/u
    );
    assert.deepEqual(page.mutations, []);
    assert.deepEqual(page.keys, []);
  });
});

test('prepared checkout refuses a live unchecked selected control even while its original checked attribute remains', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, store, page } = await privateFixture(t, clock);
    await page.locator('#selected').uncheck();
    assert.equal(
      page.document.querySelector('#selected').hasAttribute('checked'),
      true
    );
    await assert.rejects(
      capturePreparedLazadaCheckout(app, {
        layout: layout(),
        deliveryArea: 'Nha Trang',
      }),
      /selected marker disagrees/u
    );
    assert.equal((await store.list('checkout-adapter')).length, 0);
  });
});

test('prepared checkout refuses a superseded exact offer and cannot borrow quantity from a different source row', () => {
  assert.equal(
    discoverLazadaCheckoutSnapshot(original, source(), {
      layout: layout(),
      offers: [{ ...offer, supersededBy: 'new-offer' }],
    }).mapping,
    null
  );
  const mapped = layout();
  delete mapped.lines[0].quantityBinding;
  mapped.lines[0].selectors.quantity = '#quantity-text';
  const html = original.replace(
    '</body>',
    '<span id="quantity-text">2</span></body>'
  );
  const result = discoverLazadaCheckoutSnapshot(html, source(html), {
    layout: mapped,
    offers: [offer],
  });
  assert.equal(result.mapping, null);
  assert.ok(
    result.gaps.some((gap) => /quantity belongs to another/u.test(gap.reason))
  );
});

test('prepared scenario revalidates destination after animation and refuses a different row stock proof', async (t) => {
  await withVirtualClock(async (clock) => {
    const { app, page, plan } = await privateFixture(t, clock, actionHtml, 1);
    page.onScroll = () => {
      page.document.querySelector('#address').textContent = 'Hồ Chí Minh';
    };
    await assert.rejects(
      prepareLazadaCheckoutScenario(app, preparationInput(plan)),
      /destination differs/u
    );
    assert.deepEqual(page.mutations, []);
    page.onScroll = undefined;
    page.document.querySelector('#address').textContent =
      'Khánh Hòa, Phường Nha Trang';
    page.document.body.append(page.document.querySelector('#stock'));
    await assert.rejects(
      prepareLazadaCheckoutScenario(app, preparationInput(plan)),
      /stock proof belongs to a different/u
    );
    assert.deepEqual(page.mutations, []);
  });
});
