# Cached catalog coverage audit

Audited catalog timestamp **2026-10-10T19:03:27.837Z** and collection-progress timestamp **2026-10-10T19:04:38.776Z**. The catalog SHA-256 is `819c577c2312b97953d9f07121fe6843356393f78706a390a8e9f9cf9e1a6c26`. Full source timestamps, hashes, original page receipts and count definitions are in [coverage-review.json](coverage-review.json). No browser, Lazada request, shared-store write or Git operation was used.

**The saved data does not establish collection of every required product or a market-wide cheapest price.** Five configured visible result sets reached their terminal pagers. That is supported by complete cached page sequences, but the whey sources are three broad keyword searches; the attempted `/protein/` category redirected to `/` and was removed from the later crawl. Neither a terminal keyword search nor caller-assigned `type: category` proves an authoritative inventory.

| Visible source                                                                                      | Pages present | Cached card observations | Distinct listings | Last reported total |
| --------------------------------------------------------------------------------------------------- | ------------: | -----------------------: | ----------------: | ------------------: |
| [whey protein](https://www.lazada.vn/catalog/?q=whey+protein)                                       |       61 / 61 |                    2,416 |             2,416 |                2413 |
| [whey isolate](https://www.lazada.vn/catalog/?q=whey+isolate)                                       |       80 / 80 |                    3,200 |             3,200 |                3176 |
| [protein powder](https://www.lazada.vn/catalog/?q=protein+powder)                                   |       77 / 77 |                    3,080 |             3,080 |                3080 |
| [/bach-hoa-online-kem-cac-loai/](https://www.lazada.vn/bach-hoa-online-kem-cac-loai/?sort=priceasc) |       10 / 10 |                      386 |               386 |         Not exposed |
| [/bach-hoa-online-kem-daua/](https://www.lazada.vn/bach-hoa-online-kem-daua/?sort=priceasc)         |       10 / 10 |                      386 |               386 |         Not exposed |

The two ice routes have **identical sets of 386 listings**: intersection 386, union 386. Their page titles differ: “Kem Đá, Kem Ngon, Nhiều Hương Vị” and “Bột Làm Kem”. Each has 40 cards on pages 1–9 and 26 on page 10. Neither exposes a total inventory count. The shared list includes skincare, decorations, candy and fruit variants; only 32 saved cards per route currently classify as chocolate ice cream. These routes duplicate one mixed visible list. They do not establish independent or strict chocolate-category coverage.

The five current cached lists contain **9,468 card observations but 5,949 distinct listing IDs**. Across all saved historical discovery records, there are **10,237 observations, 6,493 distinct listings and 6,498 distinct listing/SKU pairs**. Repeated source observations, historical selected cards and overlapping queries are retained evidence; they are not additional products. The current whey card counts also differ from two displayed totals, so those totals cannot identify a stable closed inventory.

All category page URLs preserve `sort=priceasc`; none of the inspected current-page URLs applies a minimum/maximum-price cutoff. Keyword sources use their default order. Expensive cartons remain in the observed lists, including 24-bottle and 64-stick packages. These listing observations do not verify every selling option or denominator.

| Selected-SKU coverage                                                              | Observed count |
| ---------------------------------------------------------------------------------- | -------------: |
| Captured product records / distinct listings                                       |      240 / 110 |
| Positive confirmed selected-SKU prices                                             |            236 |
| Inventory option observations / distinct listing-SKU pairs                         |    2,118 / 642 |
| Known inventory pairs without a confirmed price, all flavours                      |            406 |
| Remaining selected-SKU prices after current active-source and exact-option filters |            140 |
| Missing distinct listings after current runtime relevance triage                   |          1,498 |
| Unclassified active-source observations / distinct listings                        |  6,570 / 4,159 |

`missingPrices=0` and `unknownSkuInventories=0` refer to already captured active offers. They do not mean unseen listings or their SKU siblings have prices or inventories. Current runtime title triage was updated during this audit, reducing queued hardware and plant-only tasks; stored catalog classifications remain the hashed snapshot.

Pure USB electric shakers were saved as whey because their titles mention whey; examples are items `3285738311` and `3331880839`. Vegan AFIT `3101290314` and plant powder `2453678681` also entered the whey queue. Chocolate soy isolate SKU `3326435113_VNAMZ-16271820615` still passes the general `protein-powder` flavour predicate in the stored catalog. General protein-powder support must be distinguished from this buyer’s whey requirement. Free shaker gifts, ambiguous blends and unknown ingredients need conservative review.

A vanilla or fruit listing title must **not** discard the entire item: chocolate/plain siblings may exist. The exact-option filter correctly tests selected SKU options with an empty listing title. Unknown flavour options remain a collection worklist. Title cue counts in the JSON are review candidates, not automatic exclusions.

| Comparison coverage after flavour filtering | Whey | General protein powder | Chocolate ice cream |
| ------------------------------------------- | ---: | ---------------------: | ------------------: |
| Rows matching preliminary flavour scope     |   42 |                      1 |                  14 |
| Manufacturer identity verified              |   11 |                      1 |                   0 |
| Fully eligible comparisons                  |    8 |                      0 |                   0 |
| Food-gram metric before delivery            |   38 |                      1 |                   6 |
| Millilitre metric before delivery           |    0 |                      0 |                   8 |
| Protein-gram metric before delivery         |   12 |                      1 |                   0 |
| Food-gram metric after delivery             |   13 |                      0 |                   1 |
| Millilitre metric after delivery            |    0 |                      0 |                   1 |
| Protein-gram metric after delivery          |    9 |                      0 |                   0 |

Only **16 of 188** captured relevant specification rows satisfy the existing complete manufacturer verifier. Seller measurements or promotional nutrition panels can support provisional arithmetic but do not establish current exact manufacturer formula verification. Missing mass and volume remain separate gaps; no density conversion was inferred.

There are **37 numeric shipping quotes, all for quantity one, and zero confirmed bulk-quantity quotes**. Consequently, the bulk delivered-price requirement is unmet. 121 active offers preserve a sale price below a displayed original price, but only 3 have promotion records; universal voucher eligibility and stacking are not verified.

The older [catalog-audit.json](../catalog-audit.json) is stale: it reports 13 scopes and 12 unfinished searches, while the catalog and collection-progress reflect the later five terminal scopes. The discovery-publication receipt reports 230 current pages while the archive retains 252 cumulative receipts. Current and historical publication counts must be labelled separately and historical originals preserved.

Required next steps are to validate the food taxonomy and full seller/SKU discovery scope, finish relevant item and option collection, reprocess proven category errors without losing possible flavour siblings, complete exact manufacturer specifications, and capture quantity-specific Nha Trang freight and discount eligibility. Detailed prioritized actions and source evidence are in the JSON.
