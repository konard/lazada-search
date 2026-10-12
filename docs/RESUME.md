# Saved partial results and resume checklist

The [remaining automation draft](drafts/README.md) maps all 49 requirements and 40 GitHub issues to existing or newly drafted code. The [source-inspected recheck](drafts/draft-review.md) repairs 17 draft gaps and adds five meaningful unrun unit/E2E suites with a synthetic fixture. The user subsequently authorized testing; [current automated acceptance](acceptance/draft-workflow-testing/README.md) records actual local unit, interface, browser and native OCR checks. Live data/release acceptance and the saved CAPTCHA stop remain outstanding. Existing comparison tables retain their original observation dates.

The user requested the saved checkpoint on 2026-10-12 (Vietnam time), then resumed requirement delivery. Ice-cream quantities and both gram/ml rates are now shown together, with source-bound package reviews shared across the library, CLI, HTTP and Telegram. [Current correction and evidence](acceptance/ice-unit-completeness/) retain the implementation and remaining label gaps. All reports are recalculated from the existing public cache with zero website downloads while the saved manufacturer challenge remains active. Prices, stock and shipping retain their original observation dates; report regeneration does not refresh them.

## Published comparisons

- [Chocolate/plain whey top tens](tables/top-10-partial.md): separate ascending prices per gram of powder and per gram of specification-verified protein. Soy has its own reference category; paid shaker selections are excluded.
- [Chocolate ice-cream rankings](tables/ice-unit-rankings.md): independent ascending gram, millilitre and protein-reference rankings, with exact stock, quantity and source qualifications.
- [Six handpicked links](tables/handpicked.md): ascending supported gram prices, unresolved denominators last, exact-SKU and listing-level top-ten membership reported separately.
- [Source and arithmetic audit](acceptance/top10-check/unit-cost-audit.md): 54 report rows independently checked against original cached HTML and source digests.
- [Publication receipt](acceptance/partial-report-checkpoint/review.json): original logs, report hashes and focused test results for this checkpoint.
- [Dual-unit correction and independent review](acceptance/ice-unit-completeness/): source-bound package reviews, interface checks and regenerated report checks for the resumed work.

Both whey rankings contain ten rows. Ice cream has fourteen captured selected prices, with five eligible gram rows, seven millilitre rows and two protein-reference rows. Only two ice selling units have both supported grams and millilitres; no exact Nha Trang frozen-delivery quote is captured. The handpicked list has six captured SKUs and five supported gram denominators. These remain partial results.

## Current unfinished work

The [current requirements audit](acceptance/requirements-audit/current.md) retains 29 open requirements, including 1,298 uncollected listings, 373 unpriced selling options, exact manufacturer/formula verification, discounts and bulk/frozen freight. [Requirements](REQUIREMENTS.md) and [roadmap](ROADMAP.md) retain the complete scope. GitHub issues [3](https://github.com/konard/lazada-search/issues/3), [14](https://github.com/konard/lazada-search/issues/14) and [32](https://github.com/konard/lazada-search/issues/32) remain open. Genuine prepared-checkout layout acquisition, whole-catalog English/provider configuration and live allowlisted Telegram acceptance also remain outstanding.

The [persisted manufacturer challenge](acceptance/source-integrity/natural-chocolate-manufacturer/collection-stop.json) remains active for the saved Optimum Nutrition origin. No request, browser restart or report generation clears it. On return, inspect the saved stop, clear the challenge at that origin, then use the guarded explicit resume described in [collection operations](COLLECTION.md). A clear Lazada page cannot clear the manufacturer stop. The current authenticated session remains unconfirmed.

Continue from cached terminal lists and pending exact-SKU work. Save every original search card and evidence-backed exclusion; complete missing collection before revisiting older captures. Select the complete chocolate or unflavoured/no-shaker option, resolve dialogs and wait for stable SKU, price and stock before capture. Verify exact factory flavour, market, package and formula before promoting corrections or OCR facts. Acquire actual quantity/address-specific checkout discounts and freight, including frozen delivery, before naming a bulk-buy winner. Recheck captured price and stock freshness before an order.

## Offline reproduction

Run these in order from the repository root. They use the shared public cache and perform no website requests:

```sh
node scripts/export-deadline-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr
node scripts/export-ice-unit-report.mjs
node scripts/export-handpicked-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr
node scripts/audit-deadline-unit-costs.mjs
node scripts/audit-ice-unit-completeness.mjs
node scripts/audit-case-requirements.mjs
node bin/lazada-search.js archive-verify --offline --no-ocr
```

The original public case, HTML/JSON sources, Links Notation and binary conversions are committed under [data/cases/vietnam-nha-trang](../data/cases/vietnam-nha-trang/). Preserve historical failed controls and validation receipts. Private credentials, OTPs, profiles and account checkout sources stay in the local overlay.
