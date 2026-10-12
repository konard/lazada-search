# Draft prepared-checkout adapter and food-gift acquisition

This code is drafted at the user's explicit request without running tests, imports, collectors, browser sessions or website requests. It has no real Lazada layout acceptance, no new captured checkout, and no purchase-ready claim. The saved CAPTCHA stop remains active. Previously accepted basket, scenario and component gates are reused; this draft adds source mapping and preparation code rather than treating missing original data as approved facts.

## Code and public contracts

- `discoverLazadaCheckoutSnapshot(html, metadata, { layout, offers })` in [`src/lazada-checkout-adapter.js`](../../src/lazada-checkout-adapter.js) reads an original prepared checkout and returns labels, bounded original JSON observations, selected rows, an exact candidate mapping and explicit unresolved gaps. `mapping` is null unless reviewed identities, visible prices, exact stock, eligibility, address, payment and voucher conditions reconcile through `extractBasketQuote`.
- `importLazadaCheckoutSnapshot(application, { html, metadata, layout })` stores original HTML plus a `checkout-adapter` record in the private account store. It saves a basket quote only after the existing original-evidence and exact existing offer gates pass. `lazadaCheckoutAdapterStatus(application, { observationId? })` reads the resulting observations and gap counts.
- `capturePreparedLazadaCheckout(application, { layout, deliveryArea, readiness? })` in [`src/lazada-checkout-capture.js`](../../src/lazada-checkout-capture.js) queues a read of the already-open persistent checkout. It never launches a window, navigates, clicks, scrolls or screenshots. Loading must stabilize; any dialog stops capture; every quoted DOM field must be unique and rendered visible. Current quantity properties and selection controls must agree with preserved HTML. A CAPTCHA activates the existing persistent global stop.
- `discoverLazadaCheckoutFoodGifts(html, mapping, { giftMappings, products, offers })` in [`src/lazada-checkout-gifts.js`](../../src/lazada-checkout-gifts.js) retains original selected-row gift statements as potential observations. `importLazadaCheckoutFoodGiftDiscovery(application, { observationId, giftMappings })` persists those observations and appends previously unseen potential components without overwriting reviewed components.
- `acquireLazadaCheckoutFoodGifts(application, { observationId, offerId, components, reviewedBy, maxPromotionAgeMs? })` accepts complete review payloads through the existing manufacturer, identity, quantity, source-integrity and eligibility gates. The six allocation/count claims must come from this exact original checkout, identify its selected SKU and order quantity, and be no more than one day old. Missing or conflicting facts remain potential. Non-food accessories never increase grams, millilitres or protein.
- `prepareLazadaCheckoutScenario(application, { planId, scenarioId, layout, allowCartChanges: true, intervalMs? })` and `runPreparedLazadaCheckoutScenarios(application, { planId, scenarioIds?, maxScenarios?, layout, allowCartChanges?, intervalMs? })` in [`src/lazada-checkout-actions.js`](../../src/lazada-checkout-actions.js) connect explicit quantity, voucher-checkbox and payment-radio changes to existing immutable scenario plans. The runner is readonly by default, has a bounded scenario limit, captures original outcomes and uses `runCheckoutScenarios` to validate them. It never submits payment, navigates, buys or places an order. Each actual mutation is paced by at least 60 seconds, with the last action time retained in the private store. Dialogs, changing identities, insufficient exact stock or challenges stop preparation.

`metadata` requires `sourceUrl`, SHA-256 `sourceSha256`, original ISO `observedAt`, `evidenceId`, `market: 'vn'`, `currency: 'VND'`, and comparison `deliveryArea`. Account HTML, address, voucher and payment mappings remain private and must not be exported to GitHub. Public code and this contract can be committed; a separate reviewed redaction is required for shareable original-derived fixtures.

## Reviewed layout contract

A layout requires `{ id, reviewed: true, reviewedBy, reviewedAt, selectors, lines, appliedDiscounts }`. `selectors` has destination, shipping, total, paymentMethod and voucherState; optional coldChain records a separately stated frozen-service confirmation. All amounts are exact visible VND fields. Each applied discount supplies original ID, merchandise/shipping scope, amount selector and exact original identity selector. Optional `amountSign: 'negative-reduction'` reads a displayed negative VND reduction while applying the discount once. Ordinary amount fields never infer zero shipping or turn a displayed voucher advertisement into an applied discount.

Existing visible-text SKU and quantity selectors continue to work. A normal checkout that keeps item/SKU IDs in attributes or original JSON can instead use explicit reviewed bindings added to [`src/basket-quote.js`](../../src/basket-quote.js), through [`src/lazada-checkout-line-bindings.js`](../../src/lazada-checkout-line-bindings.js):

```js
{
  offerId: 'offer:existing-exact-selected-offer',
  sku: '2978009544_VNAMZ-14350953081',
  identityBinding: {
    kind: 'attributes',
    rowSelector: '#exact-selected-cart-row',
    itemId: { selector: '#exact-selected-cart-row', attribute: 'data-item-id' },
    skuId: { selector: '#exact-selected-cart-row', attribute: 'data-sku-id' },
    selection: {
      selector: '#exact-selected-cart-row input[type="checkbox"]',
      attribute: 'checked'
    }
  },
  quantityBinding: {
    selector: '#exact-selected-cart-row input[type="number"]',
    attribute: 'value'
  },
  selectors: {
    unitPrice: '#exact-selected-cart-row .reviewed-unit-price',
    subtotal: '#exact-selected-cart-row .reviewed-subtotal',
    stock: '#exact-selected-cart-row .reviewed-stock-count',
    availability: '#exact-selected-cart-row .reviewed-availability',
    eligibility: '#exact-selected-cart-row .reviewed-quantity-eligibility'
  }
}
```

These selectors illustrate the contract; they are not claims about Lazada's current classes or attributes. Replace them only after reviewing the actual original page. A checkout row must be unique, visible and explicitly selected. Item and SKU are numeric and must compose the exact existing `_VNAMZ-` offer identity. Unit price and subtotal belong to that row. A source row cannot be allocated twice. The entire HTML document cannot serve as one row. Input properties that disagree with source HTML are rejected; the adapter never sets attributes or fabricates HTML to make them match.

An embedded JSON identity binding uses `{ kind: 'embedded-json', rowSelector, selection, scriptSelector, rowsPointer, rowIndex, itemIdPointer, skuIdPointer, rowKeyPointer, rowKeyAttribute }`. The script must be original bounded `application/json` or `application/ld+json`; no JavaScript expressions are evaluated. RFC 6901 pointers identify its exact row. A unique row key must equal the visible DOM row's original data attribute. `quantityBinding: { kind: 'embedded-json', pointer }` then reads the same identity-bound row. `stockBinding`, `availabilityBinding` and `eligibilityBinding` use the same shape; their values must be exact available stock, boolean true availability, and the same explicitly eligible order quantity. Arbitrary state elsewhere on a page cannot approve the selected row. Optional `layout.state` provides an independent JSON script/rows/fields mapping and must agree with original selected SKU and quantity.

The draft also extends [`src/food-component-evidence.js`](../../src/food-component-evidence.js) for normal checkout layouts whose exact SKU is an original attribute or JSON field. Each reviewed eligibility proof may provide `checkoutIdentityBinding` plus `checkoutContextSelector`; the selected original item/SKU must equal the paid offer and the exact original excerpt/count field must belong to that visible row. The original visible-SKU text path remains intact. A state-only count instead supplies `checkoutValuePointer` into the same uniquely identity-bound original JSON row; its positive integer must equal both the reviewed proof and the component's exact eligibility field, and its excerpt must be retained in the original JSON script. This source compatibility grants no manufacturer, formula, nutrition, gift-stock or allocation approval by itself. All prior original-hash, observation-time, invalidation and manufacturer gates still apply. This extension is drafted and untested along with the adapter.

Vietnamese and English label observations include delivery address, shipping fee, merchandise subtotal, payable total, payment, applied vouchers and frozen service. They are retained for review and do not silently grant a layout approval. Full original Vietnamese text remains source evidence; normalized English interface descriptions do not replace it.

## Explicit action bindings

Preparation remains disabled unless `allowCartChanges: true`. A reviewed layout may add:

```js
actionBindings: {
  quantityInputs: [{ offerId, sku, selector: '#exact-selected-cart-row input[type="number"]' }],
  vouchers: [{
    id: 'EXACT-OBSERVED-VOUCHER-ID',
    selector: '#exact-voucher-checkbox',
    identityAttribute: 'data-voucher-id',
    identityValue: 'EXACT-OBSERVED-VOUCHER-ID'
  }],
  payments: [{
    text: 'Exact original payment-method text from the immutable plan',
    selector: '#exact-payment-radio',
    identityAttribute: 'value',
    identityValue: 'Exact original reviewed payment control value'
  }]
}
```

All planned quantities must identify exact previously stored offers and the same selected row; the action input must belong to that row and have enough explicit stock. Current shared product reviews must match chocolate/plain whey or strict chocolate ice cream; soy, unrelated foods, wrong flavours and selected shaker combinations are rejected before changes. All planned voucher identities must have reviewed original checkboxes. Every payment choice must have one reviewed original radio. Every target is checked before the first action and smoothly animated into view with another guarded stable-state check before mutation. Buttons, links, submit inputs and purchase/payment submission controls are forbidden. Changes use quantity fill and Tab blur or explicit checkbox/radio state; no Enter key submits a form. Captured applied IDs, destination, totals, quantity, payment and voucher state are independently checked against the immutable plan afterward.

This draft does not bypass Lazada confirmations or security verification. Unknown dialogs require resolution before continuation. It does not clear a saved CAPTCHA stop, fetch manufacturer sources, assert frozen Nha Trang coverage, assume free freight, guess density, count a shaker as food or claim that every market scenario was collected.

## Required acceptance before production

The static requirements audit additionally drafted executable tests in [`tests/case-workflow-draft.test.js`](../../tests/case-workflow-draft.test.js) and [`tests/lazada-checkout-draft.test.js`](../../tests/lazada-checkout-draft.test.js). These cover original attribute/JSON row identities, signed-discount reconciliation, private-only capture, source invalidation and unchanged CAPTCHA state; case tests cover retained per-card decisions, changed-source reopening, unknown SKU retention, strict flavours/accessories and current manual-review consumption. They have not been run and do not constitute acceptance evidence.

For the case runner, manual classification is individual and source-bound. `recordCaseManualReview` accepts optional `categoryDecisions` entries containing `recordId`, `recordFingerprint` (SHA-256 of the exact current discovery JSON), `decision: 'included' | 'excluded'`, an included target `category`, `reason`, and original `evidence` bindings. A blanket `classificationReviewed: true` cannot waive an unreviewed card. An unchanged negative decision is retained with its sources; a changed card or invalidated original withdraws it. Included previously unknown listings enter collection work; unknown SKU options remain pending rather than excluded. After classification, pass the saved current manual review ID through `runCaseWorkflow(..., { manualReviewId })`; the queue validates all extraction/pagination flags and the current dataset fingerprint instead of unconditionally blocking a manual-review task. Correct classification alone does not approve manufacturer specs, prices, shipping or whole-market completeness.

The code was not executed or tested in this drafting turn. Before enabling live use, retain an actual reviewed account checkout layout privately; collect reviewed redacted original fixtures where publication is appropriate; check both visible text and item/SKU attributes or JSON paths; verify selected/unselected rows, stale input properties, changing quantities/totals, missing stock, negative discount signs, duplicate allocations, vouchers/payment conditions, source invalidation, source-byte corruption, unresolved dialogs and CAPTCHA stops. Verify native browser runtime reuse and queue behavior after restart. Exercise preparation against a safe actual prepared checkout and verify no forbidden submit/navigation actions. Real frozen delivery to Nha Trang, current stock and manufacturer-backed gift specs require independently captured exact originals. Existing historical test receipts cannot serve as validation for these new draft files.
