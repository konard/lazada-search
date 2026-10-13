# Operator review and resumed collection

On 2026-10-13 the user instructed us to display the browser and let them decide about collection. The existing Browser Commander window was brought to the front and inspected without navigation or a replacement tab. Its Lazada product page had no visible CAPTCHA. The previously active checkpoint referred to an Optimum Nutrition HTTP/imported interstitial, with no retained browser target.

The user's explicit decision was applied through `reviewNonBrowserCollectionStop`. [The durable decision receipt](operator-decision.json) preserves the original origin, signals and detection date, the independent review ID, and the resulting inactive checkpoint. It does not assert that the challenged manufacturer source recovered. New actual browser challenges still retain their exact original visible tab and require the user's intervention.

The collector's current profile showed **Đăng nhập / Sign in**. Authentication in another browser was not disproved or transferred; the available Chrome extension connection returned no browsers. Collection therefore continues with public product pages in the owned persistent window. Private profiles, credentials and viewport screenshots remain local.

## Implemented corrections

- Library, CLI, structured HTTP operations and allowlisted private Telegram share the explicit review action. Exact checkpoint comparison and a store writer lock reject stale reviews; browser-bound checkpoints cannot use this action. The review intent is stored before the checkpoint update, so a failed write cannot falsely report successful resume.
- Product/API navigation keeps its 60-second interval. Genuine Lazada static image hosts have a separate one-second scheduler; other hosts and each redirect retain normal host pacing and security checks. Existing original image hashes and OCR results are reused.
- A stable product capture no longer waits indefinitely for unrelated decorative image queues. Bounded asset acquisition cancels work that has not started and drains original writes. Timeouts cancel navigation in the existing persistent target; they do not close or replace that target. An unsettled cancellation prevents overlapping page actions.
- Captured berry and milk-tea options now produce durable exact-SKU exclusions, including already priced options. Original title, option text, price observation, source and evidence pointers are retained. Chocolate siblings and unknown inventories remain pending. Scope policy 4 archives and revokes older decisions; unchanged decisions reuse their fingerprints.

The original capture timeout and earlier fixture/test failures are retained in the validation evidence. These are consumer fixes in lazada-search; no unverified Browser Commander defect is asserted.

## Data and acceptance

Newly captured rows and their public source pointers are recorded in [eleven resumed captures](captures.md). Published HTML/JSON, images, Links Notation and binary projections belong to the [repository case](../../../data/cases/vietnam-nha-trang/). All publication and report regeneration use the saved sources offline. Cached product-image OCR, raw TSV and reproducible transformed images are published only when their original pixels match the actual public product images. Private viewport hashes and their derived chains are excluded; OCR artifacts remain subject to review and do not approve product facts.

[Chocolate/plain whey](../../tables/top-10-partial.md), [chocolate ice cream with gram/ml/protein rankings](../../tables/ice-unit-rankings.md), and [handpicked comparisons](../../tables/handpicked.md) remain partial, dated comparisons. Exact manufacturer matching, unsupported package quantities, full marketplace inventory, complete option coverage and actual Nha Trang bulk/frozen delivery remain acceptance work. No market-wide or delivered-price winner is claimed from missing evidence.

[Validation receipt](validation.json) records actual test outcomes and original log hashes. [Current requirements audit](../requirements-audit/current.md) tracks all requirements and issues. Source-bound label holds and failed controls remain intact; report regeneration never turns an old observation into a fresh quote.

The latest active-source audit has **1,287 uncollected listings and 369 unpriced target-scope options**. Eleven new listings do not establish complete market inventory. Both whey rankings still contain ten supported rows; ice cream retains five gram, seven millilitre and two eligible protein-reference rows. Every ice ranking shows both unit rates wherever both independently supported quantities exist.

Final local source validation passes **1,649/1,649 unit tests and 89/89 end-to-end tests**, with zero failures, cancellations or skips. The E2E run activates the real native binary store and local OCR/browser fixtures. Cold offline publication saved **1,142 verified product-image OCR records and 1,127 raw TSV artifacts**, with zero OCR rejections and zero downloads; private account viewport OCR was excluded. Three older product captures remain rejected for their recorded source/selection problems.
