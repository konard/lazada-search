# Lazada Vietnam catalog and comparison tables

**Collection and manufacturer verification are incomplete. This dataset is not ready to establish the cheapest available bulk purchase.** Captured at the dates in [catalog.json](catalog.json); destination Nha Trang, VND.

| Check                                      | Result                          |
| ------------------------------------------ | ------------------------------- |
| Visually checked selected-page prices      | 32                              |
| Complete exact manufacturer specifications | 0                               |
| Missing discovered product records         | 65                              |
| Missing individual SKU prices              | 193                             |
| Unfinished search scopes                   | 10                              |
| Unclassified discovery observations        | 191                             |
| Whole-market completeness                  | Unverifiable from public search |

- [All captured protein-powder offers](protein-powder.md)
- [All captured chocolate ice-cream candidates and quarantines](chocolate-ice-cream.md)
- [Manufacturer links, missing specifications and raw nutrition for every candidate](manufacturer-specifications.md)
- [Manufacturer-verified comparison](verified-comparison.md)
- [Every missing discovered listing](missing-listings.md)
- [Every known missing SKU price](missing-sku-prices.md)
- [All category-review observations](category-review.md)
- [Manual visual inspection with screenshots](../acceptance/visual-review/README.md)
- [Synthetic verified calculation example](synthetic-example.md)

## Reproduce without website requests

```sh
node scripts/audit-cached-catalog.mjs --offline
node scripts/export-catalog-tables.mjs --offline
node bin/lazada-search.js audit --strict --offline
```

The last command deliberately exits unsuccessfully while any completeness claim is unproven. For a new public collection use `crawl --exhaustive`; it visits observed pagination, records every discovered candidate and stops on challenges. Exhausting those searches establishes only a searched scope, not an authoritative whole-market catalog. No global cheapest guarantee is issued.

The attempted public backlog encountered an app-only page and Lazada security redirects. Further Lazada requests stopped. Official manufacturer sources are collected independently with caching and pacing. There is no confirmed logged-in Lazada access, and no purchase was placed. Known gaps remain explicitly unresolved.

Before/after unit costs use (price × quantity + quoted freight − confirmed fixed discount) divided by confirmed food mass, volume or protein mass. Unknown denominators and shipping stay unknown. One-package freight is never extrapolated to a bulk order. A standard ice-cream freight quote does not establish frozen delivery.
