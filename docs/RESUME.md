# Saved partial results and resume checklist

[CAPTCHA lifecycle correction](acceptance/challenge-window-retention/README.md) retains an already detected browser page without opening or reopening a window. The current requirement registry maps 49 requirements and [42 GitHub issues](acceptance/challenge-window-retention/github-issues.json), including [issue 42](https://github.com/konard/lazada-search/issues/42). The saved Optimum Nutrition stop came from curl and offline import, so its accurate handoff state is `no-browser-page`. It remains an active global stop; it is not waiting for the user in a visible browser.

Source `0ee45dc` passes 1,490 local unit and 84 local E2E tests, all nine complete CI runtime suites, all six workflows and all 84 CI E2E cases. Bounded storage scheduling and intended runner temporary directories preserve complete fixtures, durable writes and deadlines. The separate CodeQL gate still reports two high source parsing findings, so overall source acceptance remains false. [Current acceptance](acceptance/challenge-window-retention/README.md) records their bounded-reader and report-escaping draft fixes, passing focused controls and pending full-source validation. Issues 36, 42 and 43 remain open until complete acceptance and merge; live collection, manufacturer/nutrition, bulk/frozen shipping, bot and release acceptance remain separate.

The [remaining automation draft](drafts/README.md) maps all 49 requirements and 40 GitHub issues to existing or newly drafted code. The [source-inspected recheck](drafts/draft-review.md) repairs 17 draft gaps and adds five meaningful unrun unit/E2E suites with a synthetic fixture. The user subsequently authorized testing; [workflow acceptance](acceptance/draft-workflow-testing/README.md) records actual local unit, interface, browser and native OCR checks. Live data/release acceptance and the saved CAPTCHA stop remain outstanding. Existing comparison tables retain their original observation dates.

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

The [current requirements audit](acceptance/requirements-audit/current.md) retains 29 open requirements, including 1,298 uncollected listings, 373 unpriced selling options, exact manufacturer/formula verification, discounts and bulk/frozen freight. [Requirements](REQUIREMENTS.md) and [roadmap](ROADMAP.md) retain the complete scope. GitHub issues [3](https://github.com/konard/lazada-search/issues/3), [14](https://github.com/konard/lazada-search/issues/14), [32](https://github.com/konard/lazada-search/issues/32), [36](https://github.com/konard/lazada-search/issues/36) and [42](https://github.com/konard/lazada-search/issues/42) remain open; issues 36 and 42 have the lock-owner and retained-page corrections in draft PR 41. Genuine prepared-checkout layout acquisition, whole-catalog English/provider configuration and live allowlisted Telegram acceptance also remain outstanding.

The [persisted manufacturer challenge](acceptance/source-integrity/natural-chocolate-manufacturer/collection-stop.json) remains active for the saved Optimum Nutrition origin. No original browser challenge page was retained for that HTTP receipt, and status/resume do not create one. For a later actual browser challenge, clear its retained original page manually and use the guarded explicit resume described in [collection operations](COLLECTION.md). A clear Lazada page cannot clear the manufacturer stop. The current authenticated session remains unconfirmed.

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
