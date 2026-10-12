# Gift and real Chromium action coverage

The focused checkout audit identified two local coverage gaps. Both now have executed acceptance on Node 22.23.0. Complete commands, source SHA-256 values and log hashes are in the [receipt](receipt.json).

| Check                                                                  | Result                         |
| ---------------------------------------------------------------------- | ------------------------------ |
| New gift suite plus existing component-source and checkout regressions | 52 passed, 0 failed, 0 skipped |
| Actual isolated Chromium checkout capture/action E2E                   | 2 passed, 0 failed, 0 skipped  |
| ESLint both changed suites                                             | Exit 0, no warnings or errors  |

[Seven new gift tests](../../../../tests/lazada-checkout-gifts.test.js) exercise discovery, private import, idempotent re-import and acquisition using both exact original item/SKU attributes with row-associated visible excerpts and original selected JSON-row count pointers. Confirmed factory/source proofs produce exactly 3,000 g and 2,400 g protein for two paid 1 kg bags plus one bonus bag; 200,000 VND merchandise gives 66.6667 VND/g before delivery. Another item, another row's excerpt, a wrong JSON count pointer or an unattached digest retain the 2,000 g paid denominator and 100 VND/g. Source invalidation and non-food accessories remain excluded. All manufacturer and checkout originals are synthetic local test data.

The [actual Chromium suite](../../../../tests/e2e/prepared-checkout-adapter.test.js) now includes quantity input/blur, voucher checkbox and payment radio events followed by original capture and existing scenario validation. The resulting quote has quantity 2, merchandise 200,000 VND, shipping 20,000 VND, applied voucher 20,000 VND and payable total 200,000 VND. It asserts one intercepted navigation, three mutations spaced at least 60 seconds on the virtual scheduling clock, zero form submissions and private original evidence. Browser events, serialization and frame animation run in real Chromium. Only Node's Date and pacing waits are accelerated; real accounts, persistent user profiles and sites are unused, and every browser request is intercepted or aborted.

Complete logs: [affected Node tests](affected-node.log.gz), [Chromium E2E](chromium-e2e.log.gz) and [lint](lint.log.gz). The [first arithmetic-assertion failure](initial-test-assertion-failure.log.gz) used an incorrect metric property in new test assertions, corrected to `costPerGramBeforeDelivery`. The [initial sandbox failure](initial-sandbox-browser-failure.log.gz) records macOS denying Chromium launch; the authorized isolated E2E then passed outside the process sandbox. No production source changes were needed.

These checks close local test gaps. Acceptance of genuine current Lazada layouts, inventory, manufacturer labels, delivery quotes and live bot deployment remains separate. The saved global CAPTCHA stop was not cleared.
