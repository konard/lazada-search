# Lazada Vietnam / Nha Trang collection case

The buying objective is to compare all protein-powder and chocolate-ice-cream offers that can be delivered to Nha Trang, find low prices per gram of food, millilitre and gram of protein, and account for bulk quantity and freight. Exact manufacturer specifications take priority over seller descriptions. OCR, manual label review and correction history must preserve the evidence for every value.

The application provides a library, CLI, Telegram bot and local online calculator. Browser Commander captures public pages. Requests are paced per domain. An associative record store holds `.lino`, binary doublets and content-addressed evidence. The repository now contains the collected case itself, rather than only the resulting tables or a small test subset.

## Collected evidence and current limitations

The repository archive includes 8,136 records and 3,023 evidence blobs. Thirty-two initial candidate screenshots and seven additional SKU inspection sheets were manually reviewed. The price table contains 57 confirmed selected food-SKU observations. Seven requested variants rendered a different default SKU and were rejected; their original sources remain archived.

Public search observations identify 76 missing product records, 168 SKU prices without their own confirmed capture and ten unfinished search scopes. Manual title review found 11 additional food candidates and retained five ambiguous titles for page inspection. Eleven captured SKUs now have complete exact manufacturer specifications: two It's Just listings, seven MusaKing chocolate 500 g options and two Perfect Sports Diesel flavours. Their field evidence and corrections include printed metric weights, isolate/concentrate classification and flavour-specific protein and calorie values.

Public collection encountered app-only pages and security redirects. Existing Chrome access supplied further selected-SKU captures, then Lazada presented a reCAPTCHA. The cart is anonymous, and the attempted existing Google sign-in did not establish authentication. Further failing Lazada requests stopped. Bulk cart freight, stock and frozen delivery remain unconfirmed. Factory sources are independently cached, including exact labels and documented package/formula conflicts. Exhausting public search would establish those observed search scopes, not an authoritative whole-market inventory.

Confirmed captured prices are now sortable independently of missing nutrition or shipping. Delivered totals remain absent where freight is unconfirmed. Protein unit costs require both package mass and protein density. `observedPrices` exposes sortable captures; `ranked` remains the stricter purchase-eligible subset. Missing data never becomes a zero price or zero freight.

## Reproducibility and correction workflow

The [committed case archive](../../data/cases/vietnam-nha-trang/README.md) contains every stored public record namespace and its referenced evidence. JSON snapshots, HTML and imported JSON/YAML source files remain available alongside Links Notation and binary conversions. The [manifest](../../data/cases/vietnam-nha-trang/manifest.json) records file digests, source rewrites and conversion fingerprints.

Fresh checkouts use the committed case as a read-only fallback. New or corrected records are written to the private working store and override the snapshot. Unseen URLs are collected normally; seen archived sources stay reusable until explicit refresh or invalidation. Price freshness remains a separate comparison condition.

Extraction fixes can reprocess saved HTML. Incorrect external sources are invalidated with a recorded reason, refreshed individually and checked again. Corrected JSON/YAML is re-imported with its original bytes retained. Re-exporting the case rebuilds changed conversions and preserves unchanged evidence. The original claims and correction ledger remain available. Offline integrity verification checks every source, `.lino` conversion and binary graph.

## Repository deliverables

- [Captured prices, cheapest first](../tables/known-prices.md)
- [Protein powder: package, food/protein unit costs and delivery](../tables/protein-powder.md)
- [Chocolate ice cream: package, volume/mass unit costs and delivery](../tables/chocolate-ice-cream.md)
- [Manufacturer sources and specification gaps](../tables/manufacturer-specifications.md)
- [Missing listings, SKU prices and category review](../tables/README.md)
- [Manual screenshot inspections](../acceptance/visual-review/README.md)
- [Unit, E2E and archive verification evidence](../acceptance/validation.json)
- [Reported upstream associative-stack issues and workarounds](../upstream-issues.md)

This case is reproducible from the repository. Its collection and verification gaps are still open; the captured prices alone do not establish the cheapest currently deliverable bulk buy across the whole marketplace.
