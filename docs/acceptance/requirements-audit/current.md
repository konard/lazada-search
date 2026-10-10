# Current requirements and collection acceptance

**All requirements delivered: false. All target products collected: false. Production ready: false.**

Recalculated offline at 2026-10-10T20:19:26.796Z, from the published catalog observed at 2026-10-10T19:51:52.342Z. No marketplace requests are made by this audit.

The active chocolate/plain whey and chocolate ice-cream case has **1478 uncollected listings**, **169 unpriced SKU options**, and **6570 unresolved category observations**. 213 clearly identified hardware or plant-only listings are excluded with their original titles, reasons and source pointers retained. Unknown and other-flavour listing titles remain pending because they can contain relevant sibling options.

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

## GitHub issue inventory

This state is from the saved GitHub inventory, whose SHA-256 is recorded in [current.json](current.json). Re-run the inventory download before resolving an issue or interpreting a later state.

| Issue                                                  | Requirement                                                                                 | State  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------ |
| [#6](https://github.com/konard/lazada-search/issues/6) | Recognize ice-cream carton category and exact selling-unit package count                    | CLOSED |
| [#5](https://github.com/konard/lazada-search/issues/5) | Distinguish capture provenance metadata from stored blob references during archive export   | CLOSED |
| [#4](https://github.com/konard/lazada-search/issues/4) | Prefer selected metric selling-unit weights over imperial headline conversions              | CLOSED |
| [#3](https://github.com/konard/lazada-search/issues/3) | Protein category redirect and remaining SKU verification prevent complete bulk-buy coverage | OPEN   |
| [#2](https://github.com/konard/lazada-search/issues/2) | Failed persistent browser reconnect deletes another live worker descriptor                  | CLOSED |
| [#1](https://github.com/konard/lazada-search/issues/1) | Account workflow retains stale archive shards after re-export                               | CLOSED |

## Outstanding requirement acceptance

Implemented collection mechanics and passing fixture tests do not satisfy missing real product, label, translation or delivered-price evidence.

| ID   | Requirement                                                                               | Remaining acceptance                             |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| R001 | Vietnam, VND, delivery to Nha Trang                                                       | partial                                          |
| R002 | Plain/unflavoured or chocolate protein powder only                                        | partial                                          |
| R003 | Strict chocolate ice-cream core, no other flavours                                        | partial                                          |
| R006 | Relevant category filters and price sorting                                               | partial                                          |
| R008 | Every product and every selling option captured                                           | partial                                          |
| R009 | Verify exact selected SKU price and availability                                          | partial                                          |
| R010 | Extract every discount and its eligibility                                                | partial                                          |
| R011 | Before/after shipping cost per g, ml and protein g                                        | partial                                          |
| R012 | Exact bulk freight and best basket price                                                  | missing-live-acceptance                          |
| R013 | Frozen ice-cream delivery to Nha Trang                                                    | missing                                          |
| R014 | Manufacturer page/specification for every product                                         | partial                                          |
| R015 | Manufacturer corrections override Lazada errors                                           | partial                                          |
| R016 | OCR of original images and labels                                                         | partial                                          |
| R017 | Parse all Vietnamese marketplace text and provide proper English                          | missing-complete-translation                     |
| R018 | Manual extraction and completeness verification                                           | partial                                          |
| R022 | Entire public case reproducible from repository                                           | partial                                          |
| R023 | Library, CLI and HTTP interfaces                                                          | partial-operation-parity                         |
| R025 | Fully automated existing account / separate profile login                                 | credential-dependent-unconfirmed-current-session |
| R029 | No restore/translation/promotional browser chrome obstruction                             | upstream-state-not-live-rechecked                |
| R034 | At most2 agents for continued work, root also works                                       | historical-not-independently-replayed            |
| R035 | Publish top10 partial prices immediately                                                  | partial-buying-data                              |
| R036 | Commit/push code, tests and precached public evidence                                     | commit-push-not-independently-checked            |
| R037 | Production ready and exhaustive market winner                                             | missing                                          |
| R038 | Independent ice grams/ml/protein rankings and dual-unit details                           | partial                                          |
| R039 | Separate whey and soy categories in buying tables                                         | partial                                          |
| R040 | All submitted short-link options and exact top10 membership tracked                       | partial                                          |
| R041 | New requests stop globally on persisted CAPTCHA until explicit resume                     | partial                                          |
| R042 | Uncollected backlog precedes old recollection, with resumable failures                    | partial                                          |
| R043 | Protein type, ingredients and disclosed nutritional components for healthy-buy comparison | partial                                          |

[Full implementation review](implementation-review.md) · [Independent cached-list and SKU review](coverage-review.md) · [Buying tables](../../tables/top-10-partial.md) · [Requirements](../../REQUIREMENTS.md) · [Roadmap](../../ROADMAP.md)

The two saved ice routes repeat the same mixed 386-item list; they are not two independent strict chocolate inventories. Public search has no authoritative all-market SKU inventory. Exact bulk freight, frozen Nha Trang delivery and manufacturer revision matches remain evidence requirements.
