# Seller container package-mass correction

The selected Hydropure Extreme Chocolate original explicitly declares `Đóng gói: Hộp2.04kg`. The parser now treats a named package/container declaration as selling mass, so2,040g takes precedence over the rounded4.5lb headline. At999,997VND, the price is490.19VND/g before delivery. The old imperial claim remains preserved; current factory2,050g/package revision and protein remain unverified.

[Validation](validation.json) records47 affected unit and7 browser/interface E2E tests passing without skips. The regression hashes and extracts the original exact SKU HTML. Additional cases reject serving, accessory, gift and shipping context, preserve selected-size priority and keep conflicting package sizes ineligible. All322 cached capture aliases replayed with0 errors and0 downloads before regenerating the reports.

Original evidence and the remaining bonus/formula contradictions are in the [source audit](../bonus-hydropure-evidence/README.md). [Issue15](https://github.com/konard/lazada-search/issues/15) records the extraction defect.

The general URL-alias replay is followed by an exact original-evidence correction for the historical selected SKU, because a newer sibling selection owns the listing cache. The correction preserves the original observation date and price, retains the old mass claim, and approves neither factory identity nor protein. [Reproducible source review](../../../scripts/review-cached-container-mass.mjs) · [Review receipt](review-replay.json).

The food ranking also stops replacing seller2,040g with an unmatched factory2,050g profile. An additional24 affected tests pass; missing or disputed mass cannot be filled from stale comparison metrics. Factory protein arithmetic remains explicitly conditional in its separate report section.
