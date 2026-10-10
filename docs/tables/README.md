# Lazada Vietnam catalog and comparison tables

[Strict-flavour shopping table: unflavoured/chocolate powders and chocolate-core ice cream](shopping-shortlist.md) · [Reviewed sale discounts and bulk projections](../acceptance/urgent-discounts/README.md)

**Collection and manufacturer verification are incomplete. This dataset is not ready to establish the cheapest available bulk purchase.** Captured at the dates in [catalog.json](catalog.json); destination Nha Trang, VND.

| Check                                      | Result                          |
| ------------------------------------------ | ------------------------------- |
| Captured confirmed food SKU prices         | 161                             |
| Visually checked selected-page prices      | 52                              |
| Complete exact manufacturer specifications | 16                              |
| Missing discovered product records         | 1650                            |
| Missing individual SKU prices              | 252                             |
| Unfinished search scopes                   | 0                               |
| Unclassified discovery observations        | 7107                            |
| Whole-market completeness                  | Unverifiable from public search |

- [Separate preliminary listing inventory](discovered-listings.md)
- [Sale discounts and promotion conditions](discounts.md)
- [Captured selected-SKU prices, sorted cheapest first](known-prices.md)
- [Authenticated product-capture publication report](../acceptance/account-publication.json)
- [Complete committed case archive](../../data/cases/vietnam-nha-trang/README.md)
- [All captured protein-powder offers](protein-powder.md)
- [All captured chocolate ice-cream candidates and quarantines](chocolate-ice-cream.md)
- [Manufacturer links, missing specifications and raw nutrition for every candidate](manufacturer-specifications.md)
- [Manufacturer-verified comparison](verified-comparison.md)
- [Every missing discovered listing](missing-listings.md)
- [Every known missing SKU price](missing-sku-prices.md)
- [All category-review observations](category-review.md)
- [Manual visual inspection with screenshots](../acceptance/visual-review/README.md)
- [Additional SKU screenshots and rejected selections](../acceptance/browser-sku-review/README.md)
- [Factory label reviews and corrected values](../acceptance/manufacturer-labels/README.md)
- [Synthetic verified calculation example](synthetic-example.md)

## Reproduce without website requests

```sh
node bin/lazada-search.js archive-verify --offline --no-ocr
node scripts/export-catalog-tables.mjs --offline
node bin/lazada-search.js audit --strict --offline --no-ocr
```

The last command deliberately exits unsuccessfully while any completeness claim is unproven. Start with `discover --exhaustive` to collect and preliminarily classify search lists without visiting product details. Search progress is saved after every page. `crawl --exhaustive` can enter its product phase only after every configured search has reached an observed terminal page. Unknown and quarantined cards remain available for review. Both commands stop on challenges, unresolved dialogs, pagination mismatches or loading timeouts. Exhausting those searches establishes only a searched scope, not an authoritative whole-market catalog. No global cheapest guarantee is issued.

Public requests previously encountered app-only pages and security redirects. 151 product captures from the authenticated browser are now published as redacted product HTML and derived records. Account-collected price observations are marked as signed-in observations; they retain their capture times and are not manual visual reviews. [Publication report](../acceptance/account-publication.json) records published sources and rejected SKU selections. The account successfully signed in during collection; this snapshot does not attest to the current session state. Exact manufacturer verification, current stock, Nha Trang freight, frozen delivery and complete search pagination remain unresolved. One-package quotes cannot establish bulk freight.

Before/after unit costs use (price × quantity + quoted freight − confirmed fixed discount) divided by confirmed food mass, volume or protein mass. Unknown denominators and shipping stay unknown. One-package freight is never extrapolated to a bulk order. A standard ice-cream freight quote does not establish frozen delivery.
