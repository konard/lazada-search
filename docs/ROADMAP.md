# Remaining work and recorded defects

The complete [requirement tracker](REQUIREMENTS.md) records every requested capability and its current evidence/status. [Partial buying report](tables/top-10-partial.md) · [Full captured catalog](tables/README.md) · [Defect register](acceptance/issue-reports.json).

| Priority | Remaining outcome                                    | Acceptance condition                                                                                                                                                                  |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Confirm cheaper Hydropure Extreme Chocolate lead     | Seller supplies the exact factory Extreme Chocolate 2,050 g package/revision shown in the cached manufacturer label; recompute protein costs and exact bulk freight.                  |
| P0       | Establish chocolate ice cream delivered to Nha Trang | Exact selected chocolate-core product, frozen delivery capability, destination price and manufacturer nutrition; reject unsupported HCM-only/ambient shipping.                        |
| P0       | Price the buyer's actual bulk basket                 | Quantity caps/stock, address-specific freight, eligible vouchers/10.10 discounts, before/after per-g/ml/protein-g costs and quote timestamps.                                         |
| P1       | Complete remaining listing and SKU details           | Resume pending tasks from cached terminal lists, exclude explicit other flavours/shaker bundles, preserve unknown options, collect selected prices before refreshing old captures.    |
| P1       | Verify every factory identity and correction         | Exact brand/flavour/package/batch/formula, original authoritative sources, OCR/visual checks and source-attributed conflict resolution.                                               |
| P1       | Reliable English representation of Vietnamese data   | Preserve original text; translate descriptions, labels, variants, shipping and discount conditions using a cached layer with units/numbers/entity safeguards and Vietnamese fixtures. |
| P1       | Prove bounded category completeness                  | Handle obsolete protein-category redirects, record active filters/terminal pages and manually check list coverage; no all-market guarantee until supported.                           |
| P2       | Recheck loading and old extraction flags             | After initial collection completes, invalidate only affected sources and rebuild JSON/HTML/YAML plus associative conversions.                                                         |
| P2       | Refresh buyable price/availability before orders     | Respect minimum 60-second intervals, stop/resolve dialogs, use same signed-in window, cache unchanged sources and retain old observations.                                            |
| P2       | Production acceptance                                | All required comparisons have source-backed facts, shipping and exact variant eligibility; interface E2E tests pass with reproducible precached data.                                 |

Reported local defects: [archive refresh #1](https://github.com/konard/lazada-search/issues/1), [persistent supervisor ownership/recovery #2](https://github.com/konard/lazada-search/issues/2), and [coverage/manufacturer/bulk delivery gaps #3](https://github.com/konard/lazada-search/issues/3). Fixes for archive refresh and persistent recovery are included with unit/browser regressions. The remaining coverage issue stays open.

Reported Browser Commander observations: [dependency audit #136](https://github.com/link-foundation/browser-commander/issues/136#issuecomment-6098863210), [launch defaults #141](https://github.com/link-foundation/browser-commander/issues/141), and [capture geometry #142](https://github.com/link-foundation/browser-commander/issues/142). Version 0.28.0 is installed. The dependency resolution warning remains open until a compatible patched graph is verified. The actual Lazada footer selector defect was fixed locally and has a browser regression.

All original public/redacted evidence and reproducible source producers belong in Git. Cookies, OTPs, private browser profiles and account-specific checkout content remain in the local private overlay. No order has been placed.

Urgent follow-up: [handpicked list](tables/handpicked.md) records all six submitted links and exact-SKU/listing top-ten intersections. Collect any unpriced resolved SKU before refreshing already-correct observations. Keep whey, soy and mixed protein separate; paid Vietnamese BÌNH BỘT selections are now excluded. Manufacturer/core matching and actual frozen destination freight remain pending despite correct seller unit arithmetic. [Original source audit](acceptance/top10-check/unit-cost-audit.md).

Metric weight parsing still needs a general fix: the case now corrects ON to its selected900g repack, ProSupps to printed907g, and Levels to printed2560g using original-label/source reviews. Add package-identity-aware metric priority and OCR regressions before relying on unreviewed imports; preserve conflicts and selectively invalidate affected derived fields.

[Metric selling-unit parser defect#4](https://github.com/konard/lazada-search/issues/4) contains exact original/redacted source digests and reproduction cases.
