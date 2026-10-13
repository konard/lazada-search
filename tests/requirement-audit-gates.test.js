import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capturedPriceFresh,
  exactCapturedDelivery,
  currentRequirementInventory,
  collectionAcceptanceGates,
} from '../scripts/requirement-audit-gates.mjs';
import { requirementDraftStatus } from '../src/requirement-registry.js';

const now = Date.parse('2026-10-13T05:00:00Z');
function offer() {
  return {
    product: { category: 'whey' },
    offer: {
      price: 1000,
      evidenceId: 'original-selected-sku',
      variantConfirmed: true,
      available: true,
      observedAt: '2026-10-13T04:00:00Z',
      shipping: 25,
      shippingQuantity: 2,
      shippingDestination: 'Khánh Hòa, Phường Nha Trang',
      deliveryArea: 'Nha Trang',
      quoteEvidenceId: 'exact-original-quote',
      quoteObservedAt: '2026-10-13T04:00:00Z',
    },
    metrics: {
      quantity: 2,
      shipping: 25,
      totalBeforeDelivery: 2000,
      totalAfterDelivery: 2025,
    },
  };
}

test('current inventory rejects the old forty-issue snapshot, duplicate issues and state drift', () => {
  const registry = requirementDraftStatus();
  assert.equal(
    currentRequirementInventory(registry, registry.githubIssues),
    true
  );
  assert.equal(
    currentRequirementInventory(registry, registry.githubIssues.slice(0, 40)),
    false
  );
  const issues = globalThis.structuredClone(registry.githubIssues);
  issues.find((row) => row.number === 36).state = 'CLOSED';
  assert.equal(currentRequirementInventory(registry, issues), false);
  assert.equal(
    currentRequirementInventory(registry, [
      ...registry.githubIssues,
      registry.githubIssues[0],
    ]),
    false
  );
});

test('only fresh original-bound selected prices satisfy current price acceptance', () => {
  assert.equal(capturedPriceFresh(offer(), now), true);
  for (const change of [
    { observedAt: '2026-10-09T04:00:00Z' },
    { observedAt: '2026-10-14T04:00:00Z' },
    { observedAt: 'invalid' },
    { price: null },
    { price: Infinity },
    { evidenceId: '' },
    { variantConfirmed: false },
    { priceInvalidated: true },
  ]) {
    const row = offer();
    Object.assign(row.offer, change);
    assert.equal(capturedPriceFresh(row, now), false, JSON.stringify(change));
  }
});

test('undefined and nonfinite delivery totals do not count as captured shipping', () => {
  assert.equal(exactCapturedDelivery(offer()), true);
  for (const total of [undefined, null, NaN, Infinity, -1, 0]) {
    const row = offer();
    row.metrics.totalAfterDelivery = total;
    assert.equal(exactCapturedDelivery(row), false);
  }
});

test('wrong destination, quantity, availability, invalidation and missing quote provenance fail closed', () => {
  for (const change of [
    { shippingDestination: 'Thành phố Hồ Chí Minh, Phường Bến Thành' },
    { shippingDestination: '' },
    { shippingDestination: undefined },
    { deliveryArea: 'Ho Chi Minh' },
    { shippingQuantity: 1 },
    { available: false },
    { deliveryAvailable: false },
    { priceInvalidated: true },
    { shippingInvalidated: true },
    { quoteEvidenceId: '' },
    { quoteObservedAt: 'invalid' },
    { stock: 1 },
    { maxQuantity: 1 },
    { minQuantity: 3 },
    { shipping: null },
    { shipping: -1 },
  ]) {
    const row = offer();
    Object.assign(row.offer, change);
    assert.equal(exactCapturedDelivery(row), false, JSON.stringify(change));
  }
  const wrongTotal = offer();
  wrongTotal.metrics.totalAfterDelivery = 2050;
  assert.equal(exactCapturedDelivery(wrongTotal), false);
});

test('confirmed zero shipping stays exact, but ambient freight cannot certify frozen delivery', () => {
  const row = offer();
  row.offer.shipping = row.metrics.shipping = 0;
  row.metrics.totalAfterDelivery = row.metrics.totalBeforeDelivery;
  assert.equal(exactCapturedDelivery(row), true);
  row.product.category = 'chocolate-ice-cream';
  assert.equal(exactCapturedDelivery(row), false);
  row.offer.coldChainConfirmed = true;
  assert.equal(exactCapturedDelivery(row), true);
});

function inputs() {
  const registry = requirementDraftStatus();
  return {
    registry,
    issues: registry.githubIssues,
    coverage: { authoritativeCategoryInventoryCollected: true },
    broad: { sourceListsComplete: true },
    active: {
      missingListings: [],
      missingSkuPrices: [],
      missingPrices: [],
      unknownSkuInventories: [],
      categoryReview: [],
      specifications: [{ problems: [] }],
    },
    ice: {
      rows: [
        {
          massG: 131,
          volumeMl: 130,
          proteinG: 1,
          strictChocolateEligible: true,
          manufacturerIdentityMatched: true,
        },
      ],
    },
    targetComparisons: [offer()],
    stop: { active: false },
    now,
  };
}

test('passing captured arithmetic and fixture coverage never accept the full case on behalf of the requirement registry', () => {
  const gates = collectionAcceptanceGates(inputs());
  assert.equal(gates.allCapturedTargetDeliveryQuotesExact, true);
  assert.equal(gates.bulkDestinationQuotesCaptured, true);
  assert.equal(gates.allRequirementsAccepted, false);
  assert.equal(gates.allGithubIssuesClosed, false);
  assert.equal(gates.frozenNhaTrangDeliveryConfirmed, false);
});

test('empty or incomplete evidence cannot pass all-product acceptance by vacuous truth', () => {
  const value = inputs();
  value.active.specifications = [];
  value.ice.rows = [];
  value.targetComparisons = [];
  value.stop = null;
  const gates = collectionAcceptanceGates(value);
  for (const key of [
    'allExactManufacturerSpecificationsVerified',
    'iceMassVolumeAndProteinComplete',
    'allIceRowsStrictChocolateVerified',
    'allCapturedTargetPricesFresh',
    'allCapturedTargetDeliveryQuotesExact',
    'bulkDestinationQuotesCaptured',
    'frozenNhaTrangDeliveryConfirmed',
    'collectionStopCleared',
  ]) {
    assert.equal(gates[key], false, key);
  }
});

test('unknown chocolate identity and negative protein cannot masquerade as completed ice specifications', () => {
  const value = inputs();
  value.ice.rows[0].strictChocolateEligible = null;
  value.ice.rows[0].proteinG = -1;
  value.stop.active = true;
  const gates = collectionAcceptanceGates(value);
  assert.equal(gates.allIceRowsStrictChocolateVerified, false);
  assert.equal(gates.iceMassVolumeAndProteinComplete, false);
  assert.equal(gates.collectionStopCleared, false);
  value.ice.rows[0].proteinG = 0;
  assert.equal(
    collectionAcceptanceGates(value).iceMassVolumeAndProteinComplete,
    true,
    'an explicit zero-protein measurement is still complete nutrition'
  );
});

test('recorded other-flavour exclusions do not become required chocolate specifications', () => {
  const value = inputs();
  value.ice.rows.push({ strictChocolateEligible: false });
  assert.equal(
    collectionAcceptanceGates(value).allIceRowsStrictChocolateVerified,
    true
  );
  assert.equal(
    collectionAcceptanceGates(value).iceMassVolumeAndProteinComplete,
    true
  );
  value.ice.rows = [{ strictChocolateEligible: false }];
  assert.equal(
    collectionAcceptanceGates(value).allIceRowsStrictChocolateVerified,
    false
  );
});
