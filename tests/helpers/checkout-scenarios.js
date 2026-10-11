import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch } from '../../src/index.js';
import { sha256 } from '../../src/util.js';

export const scenarioPlan = () => ({
  market: 'vn',
  currency: 'VND',
  deliveryArea: 'Nha Trang',
  lines: [{ offerId: 'offer-a', sku: '100_VNAMZ-11', quantities: [1, 3] }],
  voucherSelections: [
    { text: 'No vouchers applied', voucherIds: [] },
    { text: 'MERCH20 + SHIP5 applied', voucherIds: ['MERCH20', 'SHIP5'] },
  ],
  paymentMethods: ['Cash on delivery', 'Bank transfer'],
});

export async function scenarioFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-scenarios-'));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const html = await readFile(
    new URL('../fixtures/checkout-scenarios.html', import.meta.url)
  );
  const mapping = {
    market: 'vn',
    currency: 'VND',
    deliveryArea: 'Nha Trang',
    destination: 'Khánh Hòa, Phường Nha Trang',
    sourceUrl: 'https://cart.lazada.vn/cart',
    sourceSha256: sha256(html),
    observedAt: '2026-10-10T05:00:00.000Z',
    evidenceId: 'checkout-fixture',
    mappingReviewedBy: 'fixture-reviewer',
    selectors: {
      destination: '#destination',
      shipping: '#shipping',
      total: '#total',
      coldChain: '#cold-chain',
    },
    coldChainText: 'Frozen delivery supported',
    lines: [
      {
        offerId: 'offer-a',
        sku: '100_VNAMZ-11',
        quantity: 3,
        selectors: {
          sku: '#line-a .sku',
          quantity: '#line-a .quantity',
          unitPrice: '#line-a .unit-price',
          subtotal: '#line-a .subtotal',
        },
      },
    ],
    appliedDiscounts: [
      {
        id: 'MERCH20',
        scope: 'merchandise',
        selector: '#merchandise-voucher',
        identitySelector: '#merchandise-voucher-id',
      },
      {
        id: 'SHIP5',
        scope: 'shipping',
        selector: '#shipping-voucher',
        identitySelector: '#shipping-voucher-id',
      },
    ],
    checkoutConditions: {
      paymentMethod: { selector: '#payment-method', text: 'Cash on delivery' },
      voucherState: {
        selector: '#voucher-state',
        text: 'MERCH20 + SHIP5 applied',
      },
    },
  };
  await store.put('evidence', {
    id: mapping.evidenceId,
    sourceUrl: mapping.sourceUrl,
    observedAt: mapping.observedAt,
    html: await store.putBlob(html),
    role: 'checkout',
  });
  await store.put('product', {
    id: 'product-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    title: 'Chocolate whey1kg',
    category: 'whey',
    sku: '100_VNAMZ-11',
    netMassG: 1000,
    proteinPer100g: 80,
    packCount: 1,
  });
  await store.put('offer', {
    id: 'offer-a',
    url: 'https://www.lazada.vn/products/pdp-i100.html',
    productId: 'product-a',
    sku: '100_VNAMZ-11',
    currency: 'VND',
    price: 110000,
    observedAt: mapping.observedAt,
    variantConfirmed: true,
    available: true,
  });
  app.collector.start = () => {
    throw new Error('Scenario validation must not start browser');
  };
  app.cache.get = () => {
    throw new Error('Scenario validation must not download');
  };
  return { app, store, directory, html, mapping };
}

export function capturedScenario(report) {
  return report.scenarios.find(
    (row) =>
      row.definition.lines[0].quantity === 3 &&
      row.definition.vouchers.voucherIds.length === 2 &&
      row.definition.paymentMethod === 'Cash on delivery'
  );
}
