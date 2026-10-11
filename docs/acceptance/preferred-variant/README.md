# Scoped selection and source verification

The Scitec listing offered **Socola** and **Không Bình**, but generic collection captured **Zprotein Brownie5lbs + Bình Lắc** at 3,070,000 VND. This was a consumer selection defect, tracked in [issue 16](https://github.com/konard/lazada-search/issues/16).

The [live correction](live-check.json) reused the persistent window with 60-second action intervals. It confirmed **13427532777_VNAMZ-117192556069**, **Socola + Không Bình**, at **3,540,000 VND** on 2026-10-11T06:24:15Z. The earlier price remains evidence for the different SKU. Factory specifications and Nha Trang shipping remain unapproved for this new observation; image OCR is queued separately.

`src/variant-policy.js` now chooses complete observed combinations before capture, preferring purchasable chocolate, then unflavoured powder. Explicit selected shaker bundles and incompatible ice-cream cores are excluded. Explicit SKU requests retain their identity; unknown identity remains a review gap. `src/browser-variant.js` resolves dialogs, skips already selected options, paces changes, animates options into view, waits for loading/selection/stock/price stability and verifies the final SKU. Failed selection cannot save a price.

Correct selected captures are reused. A cached exact compatible sibling can satisfy a generic request without opening a browser or replacing the generic historical observation. Refresh, invalidated evidence and missing exact sources remain online work. The [selection audit](cached-selection-review.json) reviewed 94 affected records and added 73 corrections after the initial collection pass. Deferred recollection preserves the strict scope and configured Vietnamese/English OCR.

The [current original-source audit](../current-offer-source-audit.json) independently matched **338/338** current public prices to exact selected SKU, price and original HTML digest at its recorded date. Five superseded pointers were excluded. [Historical replay](../offline-reprocessing.json) accepted 342 of 376 candidates and rejected 34 wrongly attached historical originals with zero downloads. Those rejected associations do not support the audited current prices.

Replay is available as library `replayHistoricalCaptures`, CLI `replay-captures --offline`, HTTP structured operation and Telegram `/replay_captures --offline` or `/operation`. It preserves observation dates, manual reviews, newer current prices, URL caches and the CAPTCHA checkpoint. Rejected or invalidated originals stay unresolved.

Delivery costs now use the actual source destination. Hồ Chí Minh shipping cannot become Nha Trang delivered gram/ml/protein prices. Original HTML digest/address validation applies to full sources; explicitly marked legacy subset receipts require captured address, amount and provenance. The browser's visible default location is not confirmation of Nha Trang freight.

Other reproduced defects fixed in this checkpoint: per-100g protein cannot be relabelled as package protein; direct package claims require original basis/unit and exact single-inner-package identity. Equal-value vouchers retain distinct IDs/codes/sellers/terms/windows and observed states.

The rebuilt reports exposed a powder-category defect: the selected ProSupps **Chocolate Ice Cream** flavour overrode its explicit **Whey Isolate** title. `src/products.js` now retains the powder category for that flavour. The [original-source replay](powder-ice-flavour-replay.json) corrected it with unchanged **1,150,000 VND**, original observation date and **907 g** food mass, zero downloads and no new manufacturer approval. The frozen-food ranking excludes it; the original compressed HTML fixture verifies this behavior.

Verified public publication receipts bind original source/snapshot/price/date/image/context and parser/redaction dependencies. Unchanged proofs skip DOM parsing, sanitation and import. Source/code/context/output changes rebuild the proof. Legacy records require one rebuilding pass. The 739.39 ms versus 2.08 ms comparison is a controlled fixture result, not a full-profile benchmark.

The [actual profile replay](publication-profile-reuse.json) reused **279/279** validated product publications in **37,381 ms**, including the 821-record scope ledger. Three unsupported SKU-price inputs remained rejected. This measured pass made zero downloads and did not include search-page publication.

Search-page publication now has independently bound proofs as well. Unchanged original bytes, snapshots, observation context and output skip DOM extraction and output writes. Changed pagination/source/proof/output rebuilds or rejects; older sources cannot overwrite newer search/list/crawl metadata. Eight new source-bound regressions cover this path. The 305 ms versus 4.4 ms comparison is a controlled fixture, not a profile benchmark. Any relevant parser change requires one new proof-building pass; the earlier profile replay remains evidence for its recorded code version.

The [validation receipt](validation.json) records 1,006 distinct unit cases and 37 distinct E2E cases validated across full runs and successful affected-file retries. It preserves the initial timeout and fixture/source-receipt verification failures. Final cache/replay checks passed 26/26 and committed-source publication checks passed 7/7. The repository archive verified 27,248 records and 6,627 blobs with zero downloads. These checks do not constitute live whole-market or real Telegram acceptance.

[Requirements](../../REQUIREMENTS.md) · [Current acceptance](../requirements-audit/current.md) · [Buying reports](../../tables/top-10-partial.md). Full inventory, exact factory labels, bulk/frozen Nha Trang shipping and whole-catalog English remain unfinished acceptance work.
