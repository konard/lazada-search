# Remaining requirements: code draft

This branch drafts the outstanding automation at the user's request on 2026-10-12. **They were initially saved without execution; the user then authorized local automated testing. [Current exact-source acceptance](../acceptance/challenge-window-retention/README.md) records the actual tests and repaired gaps.** The prior formatting/static-only checkpoint remains historical; [the static receipt](static-review.json) records their limited scope. The accepted `main` checkpoint is `cec067aaaa1cacabeb2d57d04bb753fdde83731b`; its earlier test receipts do not validate this draft.

[The historical draft recheck](draft-review.md) source-inspects all 49 requirements and reconciles its original 40 GitHub issues. [The current mapping](requirements.md) tracks 43 issues, including retained CAPTCHA targets and separate CodeQL acceptance. It repairs 17 concrete gaps and initially added five unit/E2E suites, a synthetic fixture and revised type usage. [The new static receipt](draft-review-static.json) describes this checkpoint; the earlier static receipt above belongs to the preceding draft. [The requirement registry](requirements.md) retains the code/acceptance mapping. Existing source originals, `.lino`, associative binary archives, cached OCR, published comparisons and accepted test fixtures remain in the repository. No source collection, report regeneration or price refresh was performed for this draft. The active manufacturer CAPTCHA stop remains in force.

## Drafted implementation

| Workflow                                        | Code                                                                                                                                                                                                                                         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable case plan and bounded resume            | [case-workflow.js](../../src/case-workflow.js), [case-worklist.js](../../src/case-worklist.js)                                                                                                                                               | Finish configured lists first; collect missing listings, exact SKUs and inventories; then sources, translations and destination quotes. Defer recollection until the initial pass is accounted for. Keep failures, attempts, blocked reviews and unavailable pages durable.                                                                                                                                                                                                                                                                     |
| Exact manufacturer and label research           | [manufacturer-workflow.js](../../src/manufacturer-workflow.js), [manufacturer-workflow-review.js](../../src/manufacturer-workflow-review.js), [ocr-evidence.js](../../src/ocr-evidence.js), [label-worklist.js](../../src/label-worklist.js) | Search trusted domains, reuse cached source requests and labels, check SHA-bound originals/OCR, extract proposed quantities/nutrients/ingredients, and prepare identity/formula reviews. [Detailed contract](manufacturer-workflow.md).                                                                                                                                                                                                                                                                                                         |
| Configurable source search                      | [manufacturer-workflow-search.js](../../src/manufacturer-workflow-search.js)                                                                                                                                                                 | Operator-configured JSON search endpoint with environment-only authentication, request/response bounds, cache reuse and minimum 60-second pacing. HTTP/Telegram requests cannot choose credential destinations.                                                                                                                                                                                                                                                                                                                                 |
| Original checkout and bulk scenario acquisition | [lazada-checkout-adapter.js](../../src/lazada-checkout-adapter.js), [lazada-checkout-capture.js](../../src/lazada-checkout-capture.js), [lazada-checkout-actions.js](../../src/lazada-checkout-actions.js)                                   | Reuse an already-open private checkout; wait for loading to settle, stop on dialogs/challenges, bind selected rows and reconcile discounts/freight. Reviewed quantity/voucher/payment-control changes require explicit `allowCartChanges`; never submit an order. [Detailed contract](checkout-adapter.md).                                                                                                                                                                                                                                     |
| Food gifts and promotion eligibility            | [lazada-checkout-gifts.js](../../src/lazada-checkout-gifts.js), [food-component-evidence.js](../../src/food-component-evidence.js)                                                                                                           | Keep advertised gifts potential until exact checkout, allocation, stock, current manufacturer identity and nutrition proofs pass. Shakers never add food quantities.                                                                                                                                                                                                                                                                                                                                                                            |
| Inventory and manual extraction review          | [case-coverage.js](../../src/case-coverage.js)                                                                                                                                                                                               | Bind declared inventory rows/totals/terminal markers to original JSON. Manual review binds the current scope fingerprint and originals; changed data withdraws its current acceptance. Public-list exhaustion alone does not establish all-market completeness.                                                                                                                                                                                                                                                                                 |
| Handpicked aliases and top membership           | [handpicked-links.js](../../src/handpicked-links.js)                                                                                                                                                                                         | Preserve all submitted URLs, reuse only intact original-bound resolutions, collect exact selected prices and retain unresolved entries. Listing-level and exact-SKU top membership remain distinct.                                                                                                                                                                                                                                                                                                                                             |
| Unified unit-price reports                      | [shopping-report.js](../../src/shopping-report.js)                                                                                                                                                                                           | Calculate and display both supported gram/ml amounts and before/after rates together; independently sort all six food/protein metrics, incorporating source-validated single-item checkout quotes. Keep mixed-basket freight in a separate full-basket table. Separate whey, soy, mixed protein and strict chocolate ice cream. Keep captured, manufacturer-verified and buyable lanes distinct, with reviewed English and original Vietnamese. Missing data remains pending; do not assume density, free freight or equivalent sibling prices. |
| Shared interfaces and readiness                 | [workflow-operations.js](../../src/workflow-operations.js), [workflow-commands.js](../../src/workflow-commands.js), [workflow-types.d.ts](../../src/workflow-types.d.ts), [case-readiness.js](../../src/case-readiness.js)                   | Library helpers/application methods, file-based CLI, HTTP JSON operations and allowlisted Telegram `/operation` share validation. Readiness reports retained external gates and deferred acceptance.                                                                                                                                                                                                                                                                                                                                            |

## Example operator workflow

These are examples for later acceptance, **examples rather than live collection commands executed for this checkpoint**. Use an offline application to enforce cache-only execution. Store checkout originals under a private account; publish only the existing reviewed public evidence/archives. Provider keys, phone codes, cookies and exact address originals must remain private.

```sh
node bin/lazada-search.js plan-case-workflow docs/drafts/case-plan.json --offline --no-ocr
node bin/lazada-search.js case-workflow-status WORKFLOW_ID --offline --no-ocr
node bin/lazada-search.js run-case-workflow WORKFLOW_ID docs/drafts/run-options.json --offline --no-ocr
node bin/lazada-search.js shopping-report docs/drafts/report-options.json --offline --no-ocr
node bin/lazada-search.js requirement-draft-status --offline --no-ocr
node bin/lazada-search.js case-readiness --offline --no-ocr
```

The result of `plan-case-workflow` includes `workflow.id`; substitute it for `WORKFLOW_ID`. The bounded runner creates a report checkpoint after each batch even when source tasks remain blocked. `shopping-report` returns report data; use `{"options":{"persist":true}}` to retain original JSON/Markdown report blobs in the associative store. Existing repository publication/export commands remain the path for committing reviewed public sources; do not export a private checkout store wholesale.

Library example:

```js
const app = new LazadaSearch({
  offline: true,
  market: 'vn',
  deliveryArea: 'Nha Trang',
});
const planned = await app.planCaseWorkflow({ quantities: [1, 10] });
const checkpoint = await app.runCaseWorkflow(planned.workflow.id, {
  maxTasks: 25,
});
const report = await app.shoppingReport({ quantities: [1, 10], limit: 10 });
```

Telegram uses the existing private-chat allowlist and shared structured interface:

```json
{
  "operation": "shopping-report",
  "options": { "quantities": [1, 10], "limit": 10 }
}
```

Send that JSON after `/operation`. HTTP uses the existing authenticated operation endpoint and the same request shape. Source search can be configured at application startup, or by the trusted local CLI `--manufacturer-search-config provider.json` / `LAZADA_MANUFACTURER_SEARCH_CONFIG`. `run-manufacturer-workflow ID runtime.json` also accepts a local `searchConfiguration`. A configured provider does not authorize clearing a collection stop.

## Automated acceptance and remaining real data

[The acceptance plan](acceptance-plan.md) links completed local tests and the remaining genuine-layout/source/provider/live checks. Every new workflow retains draft markers. `allRequirementsDelivered`, `allTargetProductsCollected`, `productionReady` and `purchaseReady` remain false.

Missing target listings/SKU prices, exact manufacturer/current formula verification, second ice-cream quantity units, full nutrients, reviewed English, live authentication/Telegram, current eligible discounts and exact Nha Trang bulk/frozen delivery require real evidence. Issue 32 additionally requires package-owner trusted-publisher configuration. Source collection can resume only after the original challenge has been cleared and the existing guarded explicit resume succeeds.

Existing buying results are still [the whey top tens](../tables/top-10-partial.md), [ice unit rankings](../tables/ice-unit-rankings.md) and [sorted handpicked table](../tables/handpicked.md). Their captured observation dates and remaining qualifications remain authoritative; the draft has collected no new prices.

## Exact factory review commands

These are drafted commands for later acceptance, not commands executed for this checkpoint. Prepare a review packet from retained originals, then supply explicit reviewer, product/source fingerprints and exact current formula identity. The second command applies guarded reviewed corrections; preview alone never approves data.

```sh
node bin/lazada-search.js prepare-manufacturer-workflow-review request.json --offline --no-ocr
node bin/lazada-search.js review-manufacturer-workflow review.json --offline --no-ocr
```

The same operation names are exposed through library methods and HTTP/Telegram structured requests. [The contract](manufacturer-workflow.md) describes the required review fields.
