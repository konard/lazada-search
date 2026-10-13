# Saved results and continuing collection

Collection resumed on 2026-10-13 after the user explicitly reviewed and dismissed the old non-browser HTTP/imported manufacturer checkpoint. The existing Lazada window was shown without a visible CAPTCHA. [Operator decision, fixes and validation](acceptance/operator-collection-resume/README.md) retain the original failed manufacturer evidence and current inactive checkpoint. New actual browser challenges preserve their existing visible target for the user. The collector profile currently supports public browsing; authentication in another browser has not been confirmed or transferred.

## Published comparisons

- [Chocolate/plain whey top tens](tables/top-10-partial.md): separate ascending prices per gram of powder and per gram of verified protein. Soy has its own category; paid shaker selections are excluded.
- [Chocolate ice cream](tables/ice-unit-rankings.md): independent gram, millilitre and protein-reference rankings, with both gram/ml rates shown whenever both original quantities are supported.
- [Six handpicked links](tables/handpicked.md): supported gram prices sorted ascending, exact-SKU and listing-level top-ten membership reported separately.
- [Eleven fresh captures](acceptance/operator-collection-resume/captures.md): observed selected SKUs, prices, source pointers and OCR coverage from 2026-10-13.
- [Source-price audit](acceptance/current-offer-source-audit.json) and [independent arithmetic audit](acceptance/top10-check/unit-cost-audit.md).

Both whey rankings contain ten rows. Ice cream retains fourteen captured candidates, five eligible gram rows, seven millilitre rows and two eligible protein-reference rows. Two ice selling units have both supported grams and millilitres. Actual frozen delivery to Nha Trang remains unconfirmed. Six handpicked SKUs are captured; five have supported gram denominators. Rankings retain each price's original observation date and do not establish a current market-wide or delivered-price winner.

## Current work

The active-source audit has **1,287 uncollected listings, 369 unpriced target-scope options and 6,403 unresolved category observations**. The [current requirement audit](acceptance/requirements-audit/current.md) maps all 49 requirements and 44 GitHub issues. Twenty data/live outcomes remain incomplete; no old collection stop is a reason to leave them unfinished. [Requirements](REQUIREMENTS.md) and [roadmap](ROADMAP.md) preserve the complete scope.

Continue from cached terminal lists and pending exact-SKU work. Retain original search cards and exact evidence-backed exclusions. Confirm chocolate or unflavoured/no-paid-shaker options, resolve dialogs, and wait for stable SKU, price and stock before capture. Complete missing collection before revisiting earlier observations. Verify exact manufacturer flavour, market, package and formula before approving corrections or OCR facts. Capture actual destination/quantity-specific discounts and bulk/frozen freight before declaring a delivered winner.

```sh
node scripts/collect-account-case.mjs --account default --exhaustive \
  --flavour-scope chocolate-or-unflavoured --interval-ms 60000 \
  --batch-size 25 --max-images 40 --ocr-languages eng+vie \
  --ocr-data-dir .lazada-search/tessdata --commit-checkpoints
```

[Collection operations](COLLECTION.md) describe caching, persistent-window reuse, retained challenge pages and explicit operator review. Private profiles, credentials, OTPs and account viewport screenshots remain in the local overlay. Verified public product-image OCR originals and raw TSV can be published with their exact pixels, model hashes and reproducible transformations; they do not approve inferred nutrition.

## Offline reproduction

```sh
node scripts/export-catalog-tables.mjs --offline --no-ocr
node scripts/export-deadline-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr
node scripts/export-ice-unit-report.mjs
node scripts/export-handpicked-report.mjs --configuration data/cases/vietnam-nha-trang/preferences.lenv --offline --no-ocr
node scripts/audit-deadline-unit-costs.mjs
node scripts/audit-current-offer-sources.mjs --strict
node scripts/audit-ice-unit-completeness.mjs
node scripts/audit-case-requirements.mjs
node bin/lazada-search.js archive-verify --offline --no-ocr
```

The [repository case](../data/cases/vietnam-nha-trang/) stores reusable public HTML/JSON, images, Links Notation and binary conversions. Invalidated sources require selective refresh; unchanged correct sources and transformations are reused. Strict requirement acceptance deliberately fails while real evidence is missing.

Historical receipts remain under [offline progress](acceptance/offline-completion-progress/README.md), [result recheck](acceptance/result-recheck/README.md), [workflow tests](acceptance/draft-workflow-testing/README.md), [challenge retention](acceptance/challenge-window-retention/README.md), and [source integrity](acceptance/source-integrity/README.md). Their stop states, prices and CI counts belong to their recorded dates and source commits.
