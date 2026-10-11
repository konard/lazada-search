# Exact basket quotes

Basket comparisons use captured Lazada Vietnam cart or checkout fields for the exact selected SKUs, quantities and delivery destination. Merchandise prices, shipping and already-applied discounts come from one original observation. A quote covers that basket only: changing a quantity, SKU or destination requires another quote.

The library, CLI, structured HTTP operations and Telegram expose saving, read-only capture and comparison. A fully automatic Lazada cart adapter and systematic quantity/voucher sweep remain unfinished. No live acceptance receipt currently establishes complete bulk-basket or frozen-delivery coverage for Nha Trang.

## Original-source mapping

`BasketSourceMapping` identifies the original HTML evidence, its SHA-256 digest and observation time, a reviewer, the exact destination, and one unique visible text selector for each quoted field. Each line contains an existing `offerId`, an exact `listing_VNAMZ-sku` identity, its integer quantity, and selectors for SKU, quantity, unit price and subtotal. Top-level selectors identify destination, shipping and total. Applied discounts have an ID, merchandise/shipping scope and their own source selector.

The implementation requires credential-free HTTPS Lazada Vietnam cart or checkout URLs, market `vn`, currency `VND`, matching source bytes and original evidence dates. Each selector must match exactly one field. Hidden controls and script/style/template content cannot establish amounts. Money fields must contain a single explicit VND amount; SKU and quantity must match the selected line, and `unitPrice × quantity` must equal its captured subtotal.

The full checkout arithmetic must reconcile:

```text
before delivery = merchandise subtotals − applied merchandise discounts
after delivery  = before delivery + shipping − applied shipping discounts
```

Merchandise and shipping discounts cannot exceed their corresponding subtotals. Duplicate voucher IDs or duplicate source fields cannot reduce the basket twice. Discount eligibility is recorded as `applied-in-captured-basket`; this proves application to this observation, rather than eligibility for other baskets, users, dates or payment methods. A quoted line price replaces its product-page price only inside that basket calculation; the original offer remains stored.

The [mapping fixture](../tests/fixtures/basket-mapping.json) and [HTML fixture](../tests/fixtures/basket-quote.html) show the complete schema. They are synthetic test data dated 2020, not current prices or a real Nha Trang checkout. Their three units cost 300,000 VND, with 10,000 VND shipping, a 20,000 VND merchandise discount and a 5,000 VND shipping discount: 280,000 VND before delivery and 285,000 VND after delivery. If those three units each have a verified 1,000 g selling mass, the delivered food cost is 95 VND/g.

## Library and CLI

```js
import { LazadaSearch, extractBasketQuote } from 'lazada-search';

const app = new LazadaSearch({
  store: accountStore,
  market: 'vn',
  deliveryArea: 'Nha Trang',
});

// Pure extraction validates bytes and fields; saving also validates stored evidence.
const extracted = extractBasketQuote(originalHtml, reviewedMapping);
const saved = await app.saveBasketQuote(reviewedMapping);
const report = await app.compareBaskets({
  minMassG: 3000,
  sort: 'costPerGramAfterDelivery',
});

// Read the current prepared cart/checkout in the persistent private browser.
const captured = await app.captureBasketQuote(preparedMapping);
```

`saveBasketQuote` reuses stored evidence and makes no browser or network request. `captureBasketQuote` requires a private account store and an already prepared cart or checkout in the owned persistent browser. It supplies the source URL, digest, observation time and evidence ID from capture. It resolves dialogs, waits for loading and visible mapped fields, and checks that the destination, line prices, shipping, discounts and total have settled. It neither prepares the cart nor changes its quantities, vouchers, address or payment state. CAPTCHA and persistent collection-stop guards apply before capture and while waiting. Original account checkout HTML stays in the private account overlay.

```sh
lazada-search save-basket-quote reviewed-basket.json --account default --offline
lazada-search capture-basket-quote prepared-basket.json --account default
lazada-search compare-baskets --account default --offline \
  --min-mass-g 3000 --sort costPerGramAfterDelivery
lazada-search compare-baskets --account default --offline \
  --min-volume-ml 3000 --sort costPerMlAfterDelivery
lazada-search compare-baskets --account default --offline \
  --min-protein-g 2000 --sort costPerProteinGramAfterDelivery
```

Saving requires the original evidence and exact selected offers to be present already. CLI JSON files contain the reviewed source mapping. The account option reuses public catalog data while keeping new account-specific evidence private. Capture input still needs reviewed selectors; there is no built-in live Lazada checkout-layout adapter.

## HTTP and Telegram

The bounded, same-origin structured endpoint is `POST /api/operations`. Use `operation: "save-basket-quote"` or `"capture-basket-quote"`, with the mapping at `input.quote`. Comparison accepts the same options as the library:

```json
{
  "operation": "compare-baskets",
  "options": {
    "minMassG": 3000,
    "sort": "costPerGramAfterDelivery"
  }
}
```

The configured HTTP application must use the intended account store for private capture. Telegram uses `/compare_baskets` with comparison flags, or `/operation` followed by structured JSON for saving, capture and comparison. Commands are restricted to configured allowed private chats. The structured mapping is supplied directly; Telegram does not read a user-specified local JSON file.

## Eligibility and ranking limits

Comparison rechecks the original HTML digest, evidence URL/date, invalidation state, stored extracted fields, exact offer/SKU identities and destination. It applies shared category/manufacturer reviews, specification holds, listing availability and source invalidations before calculating. Existing flavour, manufacturer-identity, package-count, stock, quantity-cap and nutrition filters remain effective. Reviewed cached English is added to each basket line through the same public product/commercial-field presentation used by individual-offer comparisons. Original Vietnamese, exact quote totals, metrics and ranking identities remain unchanged; comparison makes no translation requests. Confirmed food bonuses use the shared source-bound component accounting; an allocation cannot be counted on multiple basket lines.

Nha Trang rates require the actual captured destination to match Nha Trang. A generic page shipping estimate or a Ho Chi Minh City destination cannot supply that quote. Chocolate ice cream additionally needs an explicit positive, source-matched cold-chain statement; absent, negated or unsupported frozen delivery leaves the basket ineligible. A source statement is not live proof that every seller can currently dispatch the buyer's order.

Quotes older than `maxPriceAgeMs` are excluded by default; the default maximum age is 24 hours. `allowStale: true` is an explicit historical preview option and does not establish current buying availability. Missing, invalidated or altered evidence excludes the quote without downloading it again.

Mass, volume and protein totals require usable corresponding denominators on every included line. Missing denominators remain unavailable. Grams and millilitres stay separate, with no density conversion. Returned metrics include totals before/after delivery and separate food-gram, millilitre and protein-gram rates before/after delivery. Shipping and applied discounts count once for the basket; they are not allocated into invented per-SKU freight quotations.

The default ranking is `costPerProteinGramAfterDelivery`. Supported alternatives are `costPerGramBeforeDelivery`, `costPerGramAfterDelivery`, `costPerMlBeforeDelivery`, `costPerMlAfterDelivery`, `costPerProteinGramBeforeDelivery`, `costPerProteinGramAfterDelivery`, `totalBeforeDelivery` and `totalAfterDelivery`. A missing selected metric excludes that observation from the corresponding ranking. Problems and excluded observations remain visible.

Every report declares `quoteCoverage: "captured-exact-baskets-only"` and `allBasketCombinationsCollected: false`. A best captured basket is a subset result. Complete acceptance still requires a live checkout adapter, prepared-cart/source mappings for actual marketplace layouts, exact quantity/stock sweeps, applicable voucher and payment-condition exploration, fresh destination freight, frozen-delivery confirmation and comparison of all relevant basket combinations. No purchase is performed by these operations.

Source extraction and offline comparison regressions are in [unit tests](../tests/basket-quotes.test.js). [Interface and local browser fixtures](../tests/e2e/basket-quotes.test.js) exercise library/CLI/HTTP/Telegram parity, stable prepared-page capture and challenge stops. Fixture success does not close live checkout, full inventory or exact manufacturer acceptance.

## Durable quantity, voucher and payment scenarios

`plan-checkout-scenarios <JSON file>` creates an immutable bounded plan from existing exact selected offers, quantity choices, explicit voucher-state/ID sets and payment methods. `run-checkout-scenarios <JSON file>` validates saved prepared-checkout captures for those scenario IDs, and `checkout-scenario-status <plan ID>` reports pending, failed and validated cases. The library methods are `planCheckoutScenarios`, `runCheckoutScenarios` and `checkoutScenarioStatus`; HTTP and Telegram `/operation` use the same three operation names.

Each mapping must bind the original HTML hash, byte length, URL, timestamp and evidence ID. Actual source fields establish selected SKU, quantity, payment method, voucher state and applied voucher IDs; expected plan values only check those observations. Unchanged source/mapping/code/output proofs reuse a validated result. New source observations, invalidated originals and changed extraction/output hashes reopen work. Older attempts cannot replace a newer validated observation. Public failures cannot retain private or unproved mappings.

Plans contain at most512 cases, individual quantities at most10000 and capture batches at most100. These are read-only stored-source operations: they make no browser requests, cart mutations or payments, and cannot clear a security stop. [The committed local fixture and acceptance boundaries](acceptance/source-integrity/checkout-scenarios.json) cover scenario mechanics. Current real Lazada layout mapping, automatic scenario acquisition, full candidate coverage and Nha Trang bulk/frozen quote acceptance remain open.
