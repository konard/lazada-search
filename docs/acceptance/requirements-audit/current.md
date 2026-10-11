# Current requirements and collection acceptance

**All requirements delivered: false. All target products collected: false. Production ready: false.**

Recalculated offline at 2026-10-11T18:34:50.850Z, from the published catalog observed at 2026-10-11T13:54:15.320Z. No marketplace requests are made by this audit.

The active chocolate/plain whey and chocolate ice-cream case has **1298 uncollected listings**, **373 unpriced SKU options**, and **6403 unresolved category observations**. 371 clearly identified hardware, animal-feed, non-frozen protein-bar or plant-only listings are excluded with their original titles, reasons and source pointers retained. Unknown and other-flavour listing titles remain pending because they can contain relevant sibling options.

| Acceptance gate                            | Result |
| ------------------------------------------ | ------ |
| authoritativeCategoryInventory             | Open   |
| visibleListsTerminal                       | Passed |
| allDiscoveredTargetListingsCaptured        | Open   |
| allRelevantSkuPricesCaptured               | Open   |
| allSkuInventoriesObserved                  | Passed |
| allCategoryReviewsResolved                 | Open   |
| allExactManufacturerSpecificationsVerified | Open   |
| iceMassVolumeAndProteinComplete            | Open   |
| allCapturedTargetDeliveryQuotesExact       | Open   |
| bulkDestinationQuotesCaptured              | Open   |
| frozenNhaTrangDeliveryConfirmed            | Open   |
| allRequirementsAccepted                    | Open   |
| allGithubIssuesClosed                      | Open   |

The SKU-inventory gate covers captured listing sources. Entire-market discovery remains a separate open gate; a passing captured-source inventory check does not establish exhaustive Lazada coverage.

## GitHub issue inventory

This state is from the saved GitHub inventory, whose SHA-256 is recorded in [current.json](current.json). Re-run the inventory download before resolving an issue or interpreting a later state.

| Issue                                                    | Requirement                                                                                                | State  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| [#40](https://github.com/konard/lazada-search/issues/40) | Documentation CI link probes bypass collection CAPTCHA stop and request pacing                             | CLOSED |
| [#39](https://github.com/konard/lazada-search/issues/39) | Default fresh CLI case preferences to target flavours and no paid shaker                                   | OPEN   |
| [#38](https://github.com/konard/lazada-search/issues/38) | Fingerprint trained-model bytes in OCR cache identity                                                      | OPEN   |
| [#37](https://github.com/konard/lazada-search/issues/37) | Preserve decimal pixels across native OCR engines and require actual matrix acceptance                     | OPEN   |
| [#36](https://github.com/konard/lazada-search/issues/36) | Preserve original source bytes on Windows checkout and bound transient cache lock recreation               | OPEN   |
| [#35](https://github.com/konard/lazada-search/issues/35) | Keep category E2E redirects local and drain every image producer before browser close                      | CLOSED |
| [#34](https://github.com/konard/lazada-search/issues/34) | Windows archive cleanup deletes live nested blobs; preserve CRLF preferences and cross-platform validation | OPEN   |
| [#33](https://github.com/konard/lazada-search/issues/33) | Run alternative-runtime CI against the reviewed locked dependency graph                                    | OPEN   |
| [#32](https://github.com/konard/lazada-search/issues/32) | Configure npm trusted publishing before enabling a successful release                                      | OPEN   |
| [#31](https://github.com/konard/lazada-search/issues/31) | Keep complete generated catalog Markdown within the architecture line limit                                | CLOSED |
| [#30](https://github.com/konard/lazada-search/issues/30) | Build previews without requiring an unconfigured Pages deployment                                          | CLOSED |
| [#29](https://github.com/konard/lazada-search/issues/29) | Run sandboxed Chromium E2E on the Ubuntu 24.04 CI image                                                    | CLOSED |
| [#28](https://github.com/konard/lazada-search/issues/28) | Keep full associative archive decode working for the 144MB saved notation                                  | CLOSED |
| [#27](https://github.com/konard/lazada-search/issues/27) | Inspect and pace every image redirect hop before following it                                              | CLOSED |
| [#26](https://github.com/konard/lazada-search/issues/26) | Detect and cache original image-endpoint challenges before OCR retries                                     | CLOSED |
| [#25](https://github.com/konard/lazada-search/issues/25) | Propagate collection stops from image and OCR workflows immediately                                        | CLOSED |
| [#24](https://github.com/konard/lazada-search/issues/24) | Bound reciprocal cross-host manufacturer redirect scheduling without deferred requests                     | CLOSED |
| [#23](https://github.com/konard/lazada-search/issues/23) | Persist a collection stop for original manufacturer Cloudflare challenge responses                         | CLOSED |
| [#22](https://github.com/konard/lazada-search/issues/22) | Batch chronological catalog imports to avoid full-case replay timeout                                      | CLOSED |
| [#21](https://github.com/konard/lazada-search/issues/21) | Selected package label conflicts create wrong gram prices in two cheapest powder rows                      | CLOSED |
| [#20](https://github.com/konard/lazada-search/issues/20) | Preserve reviewed paid package mass when replaying the identical original source                           | CLOSED |
| [#19](https://github.com/konard/lazada-search/issues/19) | Hold seller net mass when same-product protein and serving count contradict the package denominator        | CLOSED |
| [#18](https://github.com/konard/lazada-search/issues/18) | Defer automatic public checkpoints when unrelated changes are staged without stopping collection           | CLOSED |
| [#17](https://github.com/konard/lazada-search/issues/17) | Whey Chocolate Ice Cream flavour overrides powder category during original replay                          | CLOSED |
| [#16](https://github.com/konard/lazada-search/issues/16) | Select chocolate/no-shaker SKUs before capture and bind shipping to the actual destination                 | CLOSED |
| [#15](https://github.com/konard/lazada-search/issues/15) | Explicit container metric package mass loses to rounded pound headline                                     | CLOSED |
| [#14](https://github.com/konard/lazada-search/issues/14) | Verify and count food gifts in bulk selling options separately from accessory gifts                        | OPEN   |
| [#13](https://github.com/konard/lazada-search/issues/13) | Selected SKU manufacturer conflicts are hidden by the parent listing brand                                 | CLOSED |
| [#12](https://github.com/konard/lazada-search/issues/12) | Redact embedded manufacturer access tokens before committing original evidence                             | CLOSED |
| [#11](https://github.com/konard/lazada-search/issues/11) | Nutrition label OCR drops decimal points despite high confidence                                           | CLOSED |
| [#10](https://github.com/konard/lazada-search/issues/10) | Older cached observations overwrite newer SKU prices and package facts                                     | CLOSED |
| [#9](https://github.com/konard/lazada-search/issues/9)   | Ice rankings reuse withheld package weights and create unsupported gram prices                             | CLOSED |
| [#8](https://github.com/konard/lazada-search/issues/8)   | Human food filtering admits animal feed and non-frozen protein bars; cache exclusions                      | CLOSED |
| [#7](https://github.com/konard/lazada-search/issues/7)   | Removed Vietnamese product notice incorrectly stops the collection queue as a loading timeout              | CLOSED |
| [#6](https://github.com/konard/lazada-search/issues/6)   | Recognize ice-cream carton category and exact selling-unit package count                                   | CLOSED |
| [#5](https://github.com/konard/lazada-search/issues/5)   | Distinguish capture provenance metadata from stored blob references during archive export                  | CLOSED |
| [#4](https://github.com/konard/lazada-search/issues/4)   | Prefer selected metric selling-unit weights over imperial headline conversions                             | CLOSED |
| [#3](https://github.com/konard/lazada-search/issues/3)   | Protein category redirect and remaining SKU verification prevent complete bulk-buy coverage                | OPEN   |
| [#2](https://github.com/konard/lazada-search/issues/2)   | Failed persistent browser reconnect deletes another live worker descriptor                                 | CLOSED |
| [#1](https://github.com/konard/lazada-search/issues/1)   | Account workflow retains stale archive shards after re-export                                              | CLOSED |

## Outstanding requirement acceptance

Implemented collection mechanics and passing fixture tests do not satisfy missing real product, label, translation or delivered-price evidence.

| ID   | Requirement                                                                                         | Remaining acceptance                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R001 | Vietnam, VND, delivery to Nha Trang                                                                 | pending-exact-Nha-Trang-freight-for-all-selected-quantities                                                                                                                                   |
| R002 | Plain/unflavoured or chocolate protein powder only                                                  | partial                                                                                                                                                                                       |
| R003 | Strict chocolate ice-cream core, no other flavours                                                  | partial                                                                                                                                                                                       |
| R006 | Relevant category filters and price sorting                                                         | partial                                                                                                                                                                                       |
| R008 | Every product and every selling option captured                                                     | partial                                                                                                                                                                                       |
| R009 | Verify exact selected SKU price and availability                                                    | current-captured-prices-audited;uncollected-SKU-prices-pending                                                                                                                                |
| R010 | Extract every discount and its eligibility                                                          | pending-current-marketplace-voucher-eligibility-and-all-basket-combinations                                                                                                                   |
| R011 | Before/after shipping cost per g, ml and protein g                                                  | pending-all-exact-product-denominators-and-Nha-Trang-bulk-quotes                                                                                                                              |
| R012 | Exact bulk freight and best basket price                                                            | pending-live-exact-quantity-checkout-freight-and-full-basket-coverage                                                                                                                         |
| R013 | Frozen ice-cream delivery to Nha Trang                                                              | missing                                                                                                                                                                                       |
| R014 | Manufacturer page/specification for every product                                                   | partial-exact-current-factory-matches                                                                                                                                                         |
| R015 | Manufacturer corrections override Lazada errors                                                     | partial                                                                                                                                                                                       |
| R016 | OCR of original images and labels                                                                   | partial                                                                                                                                                                                       |
| R017 | Parse all Vietnamese marketplace text and provide proper English                                    | pending-configured-provider-and-whole-catalog-semantic-reviews                                                                                                                                |
| R018 | Manual extraction and completeness verification                                                     | partial                                                                                                                                                                                       |
| R022 | Entire public case reproducible from repository                                                     | partial                                                                                                                                                                                       |
| R023 | Library, CLI and HTTP interfaces                                                                    | local-fixture-parity-passed-live-acceptance-pending                                                                                                                                           |
| R024 | Telegram interface with E2E tests                                                                   | local-mock-e2e-passed-live-deployment-pending                                                                                                                                                 |
| R025 | Fully automated existing account / separate profile login                                           | credential-dependent-unconfirmed-current-session                                                                                                                                              |
| R029 | No restore/translation/promotional browser chrome obstruction                                       | upstream-state-not-live-rechecked                                                                                                                                                             |
| R035 | Publish top10 partial prices immediately                                                            | partial-buying-data                                                                                                                                                                           |
| R037 | Production ready and exhaustive market winner                                                       | missing                                                                                                                                                                                       |
| R038 | Independent ice grams/ml/protein rankings and dual-unit details                                     | 2-of14 captured selling units have both supported grams and millilitres;3 have a supported protein denominator; current usable rankings5gram/7ml/2protein, zero exact frozen delivered quotes |
| R039 | Separate whey and soy categories in buying tables                                                   | partial                                                                                                                                                                                       |
| R040 | All submitted short-link options and exact top10 membership tracked                                 | partial                                                                                                                                                                                       |
| R042 | Uncollected backlog precedes old recollection, with resumable failures                              | partial                                                                                                                                                                                       |
| R043 | Protein type, ingredients and disclosed nutritional components for healthy-buy comparison           | partial                                                                                                                                                                                       |
| R046 | Disputed package quantities and ambiguous OCR must not produce unit-price rankings                  | pending-exact-market-package-formula-label-identity                                                                                                                                           |
| R047 | Count confirmed food gifts separately from paid multipacks and accessory gifts in exact bulk orders | pending-exact-bonus-identity-formula-stock-and-order-eligibility-for-real-offers                                                                                                              |

[Full implementation review](implementation-review.md) · [Independent cached-list and SKU review](coverage-review.md) · [Buying tables](../../tables/top-10-partial.md) · [Requirements](../../REQUIREMENTS.md) · [Roadmap](../../ROADMAP.md)

The two saved ice routes repeat the same mixed 386-item list; they are not two independent strict chocolate inventories. Public search has no authoritative all-market SKU inventory. Exact bulk freight, frozen Nha Trang delivery and manufacturer revision matches remain evidence requirements.
