# Binggrae export Samanco chocolate: core-flavour review

**Samanco should be quarantined from the strict chocolate-core ranking until the exact regional carton label is matched.** Binggrae's own export report describes the product family as vanilla ice cream with fillings inside a fish-shaped wafer. Its current Choco package photo shows a white ice-cream layer with separate dark filling. These are direct manufacturer sources, but they do not establish the exact formulation of Lazada listing **3040136213**. [Binggrae export product page](https://www.bing.co.kr/en/product/detail?PDT=55), [2025 sustainability report, page 18](https://eng.bing.co.kr/upload/esg/2025%20BINGGRAE%20SUSTAINABILITY%20REPORT.pdf#page=18), [manufacturer Choco photo](https://www.bing.co.kr/upload/product/2025/09/a516b929-a423-4ee4-b7eb-fccde90b725f.png).

The report's printed page 18 is PDF page 18, zero-based index 17. Its heading reads: “Samanco, vanilla ice cream with various fillings in fish-shaped waffle!” The same panel identifies Vietnam among its export markets. This confirms a product-family description; it establishes neither current Nha Trang stock nor frozen delivery. The [cached page render](targeted-labels/samanco-export-page-18.png) was visually checked against the extracted text. The [original manufacturer Choco photo](targeted-labels/samanco-choco-manufacturer-front.png) was also reviewed visually.

The manufacturer product page defaults to **Original**, with product-value ID **219** and a displayed **150 ml** serving. **Choco** is a separate variant, internal product ID **224**. Nutrition is loaded dynamically for the selected variant; the static HTML table contains commented example rows. Default or family-level nutrition, including a generic **3 g protein** claim, must not be attached to the Vietnam chocolate SKU. No manufacturer specification or protein value was written to the shared store.

| Root-observed search-card claim                                | Preliminary arithmetic                      | Verification status                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Listing 3040136213: chocolate carton, 24 × 150 ml, 768,000 VND | 3,600 ml; **213.33 VND/ml** before shipping | Selected carton option, exact package identity and frozen shipping unverified; excluded from purchase ranking |

The card observation came from the root collector. This review made **zero Lazada requests**. The carton count is a listing claim, not manufacturer verification. No mass conversion, protein denominator, discount or delivered price was inferred.

The unresolved evidence is specific: the Vietnam carton's original front/back label and GTIN; its current ingredients and Choco-specific nutrition; the exact selected selling option; and a destination-specific frozen-delivery quote to Nha Trang. [Structured review and source hashes](samanco-export-review.json) preserve these boundaries.

The original HTML, 14,399,676-byte PDF and package image are cached by SHA-256 in [targeted-source-cache.json](targeted-source-cache.json), with original compressed bytes under `sources/`. The initial PDF timeout is retained in the successful capture's history; a longer retry downloaded the original. The page render and text excerpt are derivatives of that cached PDF. [The isolated associative archive](targeted-evidence-archive/manifest.json) retains all sources and review artifacts; [validation](targeted-validation.json) checks source hashes and archive replay. Normal reruns perform no requests and write no shared product data.

```sh
node scripts/urgent-icecream-targeted-evidence.mjs
```
