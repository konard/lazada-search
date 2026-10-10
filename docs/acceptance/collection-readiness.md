# Collection readiness checkpoint

Checked at **2026-10-10T18:49:20.182Z** for Lazada Vietnam, delivery to Nha Trang. Collection and exact manufacturer/delivery verification remain incomplete. The published tables compare captured observations, with original timestamps and source authority retained.

| Check                                                                     | Observed state                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Active configured lists                                                   | 5 / 5 terminal-confirmed                                                         |
| Cached active list pages                                                  | 238: whey protein 61, whey isolate 80, protein powder 77, ice categories 10 + 10 |
| Missing listings in the active private/public case                        | 1616                                                                             |
| Missing SKU prices after explicit other flavours/shakers are excluded     | 143                                                                              |
| Distinct unattempted detail URLs, including relevant ambiguous food cards | 1948                                                                             |
| Unresolved category observations in the active case                       | 6714                                                                             |
| Missing listings in the broader published audit                           | 1629                                                                             |
| Missing SKU prices in the broader published audit                         | 406                                                                              |
| Current dedicated-profile product/SKU publications                        | 177                                                                              |
| Cumulative current and historical publications                            | 182                                                                              |
| Priced selected-SKU observations                                          | 222                                                                              |
| Exact manufacturer-verified captured SKUs                                 | 16                                                                               |
| Confirmed bulk shipping / Nha Trang frozen quotes                         | 0 / 0                                                                            |
| Persisted CAPTCHA stop at this checkpoint                                 | Inactive                                                                         |
| Whole-market completeness                                                 | Unproven; public searches have no authoritative inventory                        |

The latest live batch saved 24 product/SKU captures and retained one app-only failure as an unresolved task. Its browser session state was unconfirmed; those prices are marked as private-profile observations, not newly asserted authenticated prices. Publication reused cached sources with zero downloads. A separate parser correction replayed 212 original public captures offline, retaining their original bytes and timestamps.

The continuing runner uses one persistent Browser Commander window, English/Vietnamese OCR, and at least 60 seconds between navigations. It reuses terminal lists, processes unattempted products before old recollections, and retains deferred errors. CAPTCHA detection persists a hard stop across restarts and blocks new page, image and manufacturer requests. Offline reports remain available. Clearing the page does not automatically resume collection; [explicit resume](../COLLECTION.md) is required.

Two manufacturer research agents completed frozen evidence bundles: [whey sources](whey-source-expansion/README.md) cover all 26 gaps in their input snapshot, while [ice sources](ice-source-followup/review.md) cover all 14 selected ice SKUs. These sources preserve exact formula/package conflicts; they do not automatically approve unmatched seller revisions. The regenerated [current whey worklist](whey-verification/requirements.md) includes subsequent captures and their remaining gaps.

[Progress JSON](collection-progress.json) · [Top whey and handpicked prices](../tables/top-10-partial.md) · [Ice gram/ml/protein rankings](../tables/ice-unit-rankings.md) · [All published prices](../tables/known-prices.md) · [Requirements](../REQUIREMENTS.md) · [Validation](validation.json)
