# Case and prepared-checkout local acceptance

Executed on macOS with Node **22.23.0**, Bun **1.4.3** and Deno **2.4.5**. All originals are synthetic fixtures stored in the test code. Tests use isolated temporary associative stores, a DOM page double, a virtual clock and independent local Node lease workers. No external requests, real account access, Chrome profile access or CAPTCHA resume occurred.

| Check                                                       | Observed result                 |
| ----------------------------------------------------------- | ------------------------------- |
| Node case and checkout suites                               | 45 passed, 0 failed, 0 skipped  |
| Bun same suites                                             | 45 passed, 0 failed, 0 skipped  |
| Deno frozen/cache-only same suites                          | 45 passed, 0 failed, 0 skipped  |
| Node same suites plus 16 existing relevant regression files | 143 passed, 0 failed, 0 skipped |
| ESLint owned case/checkout modules and both new suites      | Exit 0; no errors or warnings   |

The [machine receipt](receipt.json) records exact commands, runtime versions, source SHA-256 values and original/compressed log hashes. Complete logs are [Node](node.log.gz), [Bun](bun.log.gz), [Deno](deno.log.gz), [combined regressions](regressions.log.gz) and [lint](lint.log.gz). Gzip preserves the full output; decompress with `gzip -dc PATH`. The regression run includes both new suites, so its 143 cases overlap with the separate 45-case runtime checks.

The [case suite](../../../../tests/case-workflow-draft.test.js) has 16 cases covering source-bound classification, unknown/detailed-category barriers, review fingerprint withdrawal, strict chocolate/plain whey and chocolate ice scope, retained unmatched SKU work, global CAPTCHA, exact item/SKU pairing, terminal list discovery, bounded retry and explicit interruption recovery, missing-first recollection, independent worker leases, malformed orphan retention, dead-owner races, source-confirmed removed inventory, unique rows/totals/terminal markers and immutable review approvals.

The [checkout suite](../../../../tests/lazada-checkout-draft.test.js) has 29 cases covering original attribute/JSON identities, row association, quantity and stock, unsigned prices and signed applied reductions, totals, private source persistence and invalidation, duplicate/hidden/loading/dialog/challenge failures, stable loading waits, immutable destinations, live property/attribute disagreement, readonly scenario capture, exact quantity/voucher/payment controls, minute pacing, no submission, post-animation revalidation and stopping later mutations after blockers. The DOM double executes production page inspectors, with live input properties independent from original HTML attributes.

These checks found and fixed concrete gaps: inventory URLs could match a longer item prefix; a stale reaper could delete a replacement lease; interrupted tasks resumed without explicit recovery; failed discovery attempts were omitted from attempt counts; review approvals could be altered without matching their immutable ID; original loading and another row's stock/quantity could reach checkout mapping; superseded offers and a changed destination could reach preparation. The first expanded checkout run also exposed a fixture-only Linkedom HEAD insertion difference. The baseline now materializes browser-shaped HEAD before capture. Its [full failed log](initial-fixture-failure.log.gz) is retained.

The suites use the repository's existing `node:test` format and are included by the Node, Bun and Deno `tests/*.test.js` manifests. Independent lease workers use Node, which CI installs before every runtime job. Real Lazada layout acceptance, actual cold-chain/bulk quotes, complete market inventory and purchase readiness remain external acceptance requirements. Local fixture success does not establish them; see the [prepared-checkout contract](../../../drafts/checkout-adapter.md) and [remaining acceptance plan](../../../drafts/acceptance-plan.md).
