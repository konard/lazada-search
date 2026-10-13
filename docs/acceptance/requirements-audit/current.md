# Current requirements and collection acceptance

**All requirements delivered: false. All target products collected: false. Production ready: false.**

Recalculated offline at 2026-10-13T17:36:03.862Z, from the published catalog observed at 2026-10-13T17:28:56.249Z. No marketplace requests are made by this audit.

The active chocolate/plain whey and chocolate ice-cream case has **1187 uncollected listings**, **497 unpriced SKU options**, and **6403 unresolved category observations**. 371 clearly identified hardware, animal-feed, non-frozen protein-bar or plant-only listings are excluded with their original titles, reasons and source pointers retained. Unknown and other-flavour listing titles remain pending because they can contain relevant sibling options.

| Acceptance gate                            | Result |
| ------------------------------------------ | ------ |
| currentRequirementInventory                | Passed |
| authoritativeCategoryInventory             | Open   |
| visibleListsTerminal                       | Passed |
| allDiscoveredTargetListingsCaptured        | Open   |
| allRelevantSkuPricesCaptured               | Open   |
| allSkuInventoriesObserved                  | Passed |
| allCategoryReviewsResolved                 | Open   |
| allExactManufacturerSpecificationsVerified | Open   |
| iceMassVolumeAndProteinComplete            | Open   |
| allIceRowsStrictChocolateVerified          | Open   |
| allCapturedTargetPricesFresh               | Open   |
| allCapturedTargetDeliveryQuotesExact       | Open   |
| bulkDestinationQuotesCaptured              | Open   |
| frozenNhaTrangDeliveryConfirmed            | Open   |
| collectionStopCleared                      | Passed |
| allRequirementsAccepted                    | Open   |
| allGithubIssuesClosed                      | Open   |

The SKU-inventory gate covers captured listing sources. Entire-market discovery remains a separate open gate; a passing captured-source inventory check does not establish exhaustive Lazada coverage.

## GitHub issue inventory

This state is from the saved GitHub inventory, whose SHA-256 is recorded in [current.json](current.json). Re-run the inventory download before resolving an issue or interpreting a later state.

| Issue                                                    | Requirement                                                                                                | State  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| [#1](https://github.com/konard/lazada-search/issues/1)   | Account workflow retains stale archive shards after re-export                                              | CLOSED |
| [#2](https://github.com/konard/lazada-search/issues/2)   | Failed persistent browser reconnect deletes another live worker descriptor                                 | CLOSED |
| [#3](https://github.com/konard/lazada-search/issues/3)   | Protein category redirect and remaining SKU verification prevent complete bulk-buy coverage                | OPEN   |
| [#4](https://github.com/konard/lazada-search/issues/4)   | Prefer selected metric selling-unit weights over imperial headline conversions                             | CLOSED |
| [#5](https://github.com/konard/lazada-search/issues/5)   | Distinguish capture provenance metadata from stored blob references during archive export                  | CLOSED |
| [#6](https://github.com/konard/lazada-search/issues/6)   | Recognize ice-cream carton category and exact selling-unit package count                                   | CLOSED |
| [#7](https://github.com/konard/lazada-search/issues/7)   | Removed Vietnamese product notice incorrectly stops the collection queue as a loading timeout              | CLOSED |
| [#8](https://github.com/konard/lazada-search/issues/8)   | Human food filtering admits animal feed and non-frozen protein bars; cache exclusions                      | CLOSED |
| [#9](https://github.com/konard/lazada-search/issues/9)   | Ice rankings reuse withheld package weights and create unsupported gram prices                             | CLOSED |
| [#10](https://github.com/konard/lazada-search/issues/10) | Older cached observations overwrite newer SKU prices and package facts                                     | CLOSED |
| [#11](https://github.com/konard/lazada-search/issues/11) | Nutrition label OCR drops decimal points despite high confidence                                           | CLOSED |
| [#12](https://github.com/konard/lazada-search/issues/12) | Redact embedded manufacturer access tokens before committing original evidence                             | CLOSED |
| [#13](https://github.com/konard/lazada-search/issues/13) | Selected SKU manufacturer conflicts are hidden by the parent listing brand                                 | CLOSED |
| [#14](https://github.com/konard/lazada-search/issues/14) | Verify and count food gifts in bulk selling options separately from accessory gifts                        | OPEN   |
| [#15](https://github.com/konard/lazada-search/issues/15) | Explicit container metric package mass loses to rounded pound headline                                     | CLOSED |
| [#16](https://github.com/konard/lazada-search/issues/16) | Select chocolate/no-shaker SKUs before capture and bind shipping to the actual destination                 | CLOSED |
| [#17](https://github.com/konard/lazada-search/issues/17) | Whey Chocolate Ice Cream flavour overrides powder category during original replay                          | CLOSED |
| [#18](https://github.com/konard/lazada-search/issues/18) | Defer automatic public checkpoints when unrelated changes are staged without stopping collection           | CLOSED |
| [#19](https://github.com/konard/lazada-search/issues/19) | Hold seller net mass when same-product protein and serving count contradict the package denominator        | CLOSED |
| [#20](https://github.com/konard/lazada-search/issues/20) | Preserve reviewed paid package mass when replaying the identical original source                           | CLOSED |
| [#21](https://github.com/konard/lazada-search/issues/21) | Selected package label conflicts create wrong gram prices in two cheapest powder rows                      | CLOSED |
| [#22](https://github.com/konard/lazada-search/issues/22) | Batch chronological catalog imports to avoid full-case replay timeout                                      | CLOSED |
| [#23](https://github.com/konard/lazada-search/issues/23) | Persist a collection stop for original manufacturer Cloudflare challenge responses                         | CLOSED |
| [#24](https://github.com/konard/lazada-search/issues/24) | Bound reciprocal cross-host manufacturer redirect scheduling without deferred requests                     | CLOSED |
| [#25](https://github.com/konard/lazada-search/issues/25) | Propagate collection stops from image and OCR workflows immediately                                        | CLOSED |
| [#26](https://github.com/konard/lazada-search/issues/26) | Detect and cache original image-endpoint challenges before OCR retries                                     | CLOSED |
| [#27](https://github.com/konard/lazada-search/issues/27) | Inspect and pace every image redirect hop before following it                                              | CLOSED |
| [#28](https://github.com/konard/lazada-search/issues/28) | Keep full associative archive decode working for the 144MB saved notation                                  | CLOSED |
| [#29](https://github.com/konard/lazada-search/issues/29) | Run sandboxed Chromium E2E on the Ubuntu 24.04 CI image                                                    | CLOSED |
| [#30](https://github.com/konard/lazada-search/issues/30) | Build previews without requiring an unconfigured Pages deployment                                          | CLOSED |
| [#31](https://github.com/konard/lazada-search/issues/31) | Keep complete generated catalog Markdown within the architecture line limit                                | CLOSED |
| [#32](https://github.com/konard/lazada-search/issues/32) | Configure npm trusted publishing before enabling a successful release                                      | OPEN   |
| [#33](https://github.com/konard/lazada-search/issues/33) | Run alternative-runtime CI against the reviewed locked dependency graph                                    | CLOSED |
| [#34](https://github.com/konard/lazada-search/issues/34) | Windows archive cleanup deletes live nested blobs; preserve CRLF preferences and cross-platform validation | CLOSED |
| [#35](https://github.com/konard/lazada-search/issues/35) | Keep category E2E redirects local and drain every image producer before browser close                      | CLOSED |
| [#36](https://github.com/konard/lazada-search/issues/36) | Preserve original source bytes on Windows checkout and bound transient cache lock recreation               | OPEN   |
| [#37](https://github.com/konard/lazada-search/issues/37) | Preserve decimal pixels across native OCR engines and require actual matrix acceptance                     | CLOSED |
| [#38](https://github.com/konard/lazada-search/issues/38) | Fingerprint trained-model bytes in OCR cache identity                                                      | CLOSED |
| [#39](https://github.com/konard/lazada-search/issues/39) | Default fresh CLI case preferences to target flavours and no paid shaker                                   | CLOSED |
| [#40](https://github.com/konard/lazada-search/issues/40) | Documentation CI link probes bypass collection CAPTCHA stop and request pacing                             | CLOSED |
| [#42](https://github.com/konard/lazada-search/issues/42) | Retain the detected CAPTCHA tab and never reopen a window to claim human waiting                           | OPEN   |
| [#43](https://github.com/konard/lazada-search/issues/43) | Bound mass extraction on adversarial numeric input and verify the separate CodeQL PR gate                  | OPEN   |
| [#44](https://github.com/konard/lazada-search/issues/44) | Exclude nonempty telemetry pixels and pseudonymous tracking identifiers from public case exports           | OPEN   |
| [#45](https://github.com/konard/lazada-search/issues/45) | Replay cached checkout originals safely and evaluate readiness from current evidence                       | OPEN   |

## Complete requirement inventory

All 49 requirements are mapped against 44 issues. Prior acceptance is a dated implementation baseline; the independent recheck below distinguishes delivered checkpoint behavior from missing real data/live outcomes. Implemented collection mechanics and passing fixture tests do not satisfy missing real product, label, translation or delivered-price evidence.

| ID   | Requirement                                                                                         | Prior baseline                 | External acceptance or ongoing maintenance                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R001 | Vietnam, VND, delivery to Nha Trang                                                                 | Data/live outcome incomplete   | Vietnam/VND and destination guards work; accepted current destination/quantity shipping for all target offers is absent.                                               |
| R002 | Plain/unflavoured or chocolate protein powder only                                                  | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R003 | Strict chocolate ice-cream core, no other flavours                                                  | Data/live outcome incomplete   | Strict rejection mechanics work; only 2 of 14 ice SKUs have manufacturer chocolate identity, with unknown candidates retained as conditional references.               |
| R004 | Never select protein plus shaker; buyer already owns one                                            | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R005 | List discovery before individual product collection                                                 | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R006 | Relevant category filters and price sorting                                                         | Data/live outcome incomplete   | Relevant discovery/sort mechanics work; obsolete protein category redirect and authoritative whole-market inventory remain unresolved.                                 |
| R007 | No maximum/minimum package-price filter                                                             | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R008 | Every product and every selling option captured                                                     | Data/live outcome incomplete   | Dated active scope retains 1298 missing target listings, 373 unpriced relevant SKU options and 6403 category reviews; public search cannot establish global inventory. |
| R009 | Verify exact selected SKU price and availability                                                    | Data/live outcome incomplete   | Captured selected-price/source guards work; all 14 ice prices retain October 9–10 timestamps and are not present stock/price acceptance.                               |
| R010 | Extract every discount and its eligibility                                                          | Data/live outcome incomplete   | Promotion/eligibility extraction is implemented and tested; all current applicable voucher/payment/expiry/stacking combinations remain uncaptured.                     |
| R011 | Before/after shipping cost per g, ml and protein g                                                  | Data/live outcome incomplete   | All existing ice arithmetic and known dual metrics match; all delivered rates are null because exact frozen freight is missing.                                        |
| R012 | Exact bulk freight and best basket price                                                            | Data/live outcome incomplete   | Exact basket/scenario mechanics work; no complete current quantity/address-specific bulk basket sweep has been accepted.                                               |
| R013 | Frozen ice-cream delivery to Nha Trang                                                              | Data/live outcome incomplete   | No confirmed frozen delivery or exact cold-chain freight to Nha Trang for any of the 14 ice candidates.                                                                |
| R014 | Manufacturer page/specification for every product                                                   | Data/live outcome incomplete   | Trusted-source discovery/review workflow works; exact current factory/market/package/formula evidence is missing for most products.                                    |
| R015 | Manufacturer corrections override Lazada errors                                                     | Data/live outcome incomplete   | Source precedence and correction mechanics work; every recorded marketplace discrepancy is not yet resolved by exact factory evidence.                                 |
| R016 | OCR of original images and labels                                                                   | Data/live outcome incomplete   | Original/model/TSV/transform provenance and OCR mechanics work; label coverage and uncertain readings still need exact-product review.                                 |
| R017 | Parse all Vietnamese marketplace text and provide proper English                                    | Data/live outcome incomplete   | Cached original-bound translation and reviewed English interfaces work; complete actual-provider semantic English coverage is not accepted.                            |
| R018 | Manual extraction and completeness verification                                                     | Data/live outcome incomplete   | Manual review records and extraction checks exist; all target pages/listings/options have not been reviewed.                                                           |
| R019 | Associative binary store and .lino links                                                            | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R020 | Maximum cache reuse, reload only invalid/missing data                                               | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R021 | Public/private collection shares correct data without duplication                                   | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R022 | Entire public case reproducible from repository                                                     | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R023 | Library, CLI and HTTP interfaces                                                                    | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R024 | Telegram interface with E2E tests                                                                   | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R025 | Fully automated existing account / separate profile login                                           | Data/live outcome incomplete   | Separate-profile/Zalo/SMS and handoff mechanics work; there is no acceptance of a current authenticated account session in this read-only audit.                       |
| R026 | Slow collection and stop on dialogs/challenges                                                      | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R027 | Educational disclosure default, not healthcare-worker claim                                         | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R028 | Persistent browser window across restarts,30-minute idle close                                      | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R029 | No restore/translation/promotional browser chrome obstruction                                       | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R030 | Fluid scrolling, products plus pager visible, avoid footer                                          | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R031 | Screenshots do not jump/resize the page                                                             | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R032 | Report dependency and implementation defects upstream                                               | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R033 | Update Browser Commander when newer version available                                               | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R034 | At most2 agents for continued work, root also works                                                 | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R035 | Publish top10 partial prices immediately                                                            | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R036 | Commit/push code, tests and precached public evidence                                               | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R037 | Production ready and exhaustive market winner                                                       | Data/live outcome incomplete   | Full source tests pass; inventory/factory/nutrition/English/bulk/frozen/live-bot/npm-owner acceptance prevents production and purchase readiness.                      |
| R038 | Independent ice grams/ml/protein rankings and dual-unit details                                     | Data/live outcome incomplete   | Both rates appear for both independently evidenced quantities; 12 of 14 ice SKUs lack at least one denominator and all lack exact frozen freight.                      |
| R039 | Separate whey and soy categories in buying tables                                                   | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R040 | All submitted short-link options and exact top10 membership tracked                                 | Data/live outcome incomplete   | All 6 submitted links resolve to and track exact captured SKUs; only 5 have supported gram amounts, so complete handpicked gram comparison is not fulfilled.           |
| R041 | New requests stop globally on persisted CAPTCHA until explicit resume                               | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R042 | Uncollected backlog precedes old recollection, with resumable failures                              | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R043 | Protein type, ingredients and disclosed nutritional components for healthy-buy comparison           | Data/live outcome incomplete   | Nutrition/type/ingredient mechanics work; exact current factory nutrition/ingredients and protein basis are not complete for all products.                             |
| R044 | Record every nonmatching search result and reuse evidence-backed exclusions                         | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R045 | Confirmed removed listings must not stop the queue or remain current buying offers                  | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R046 | Disputed package quantities and ambiguous OCR must not produce unit-price rankings                  | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R047 | Count confirmed food gifts separately from paid multipacks and accessory gifts in exact bulk orders | Data/live outcome incomplete   | Paid/bonus/accessory accounting mechanics work; issue14's real gift formula/mass/stock/order eligibility remains unresolved.                                           |
| R048 | Native OCR model bytes and actual platform recipes bind cache provenance                            | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |
| R049 | Documentation publication and CI must not bypass collector CAPTCHA stops, pacing and caches         | Fulfilled at tested checkpoint | Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.                                             |

[Full implementation review](implementation-review.md) · [Independent cached-list and SKU review](coverage-review.md) · [Buying tables](../../tables/top-10-partial.md) · [Requirements](../../REQUIREMENTS.md) · [Roadmap](../../ROADMAP.md)

The two saved ice routes repeat the same mixed 386-item list; they are not two independent strict chocolate inventories. Public search has no authoritative all-market SKU inventory. Exact bulk freight, frozen Nha Trang delivery and manufacturer revision matches remain evidence requirements.
