# Offline source audit of ten whey selling units

Reviewed 2026-10-10T16:22:16.792Z. All ten original HTML hashes, exact selected SKU IDs and selected prices match. All ten reported pre-delivery calculations match their reported denominators. No website requests were made. Formula, delivery and current availability checks remain separate.

**Correction:** ProSupps Chocolate Ice Cream SKU6552645102 prints **907 g** on the selected-flavor gallery front, not the mathematically converted 907.18474 g. Its corrected before-delivery value is **1267.916207 VND/g**. The original public image is [retained unchanged](prosupps-chocolate-front-original.webp), SHA-256 6457762f856a208124d749d99382704f2e2877e49ace3fa75bed73dc9e37502c. Older gallery photos depict a different 24-serving L-carnitine revision; that conflict prevents exact formula/delivered-revision verification.

**Conditional denominator:** Hydropure 2050 g is the current official Extreme Chocolate label weight. The seller description says 2.04 kg and title says 4.5 lb, while gallery labels depict other flavors. Keep its 2050 g result explicitly conditional until the actual seller package is matched. At the seller-described 2040 g, its 999,997 VND price would be 490.194608 VND/g before delivery.

| Exact selected SKU             | Saved price VND | Food g per selling unit | Before-delivery VND/g | Evidence status                                    |
| ------------------------------ | --------------: | ----------------------: | --------------------: | -------------------------------------------------- |
| 3095127497_VNAMZ-14849213302   |         999,997 |                    2050 |            487.803415 | conditional-factory-label-not-exact-seller-package |
| 13430219487_VNAMZ-117214356196 |         566,555 |                     907 |            624.647189 | seller-printed-mass                                |
| 3154800181_VNAMZ-116802296150  |       2,574,000 |                    3000 |            858.000000 | selected-seller-repack-claim                       |
| 3264177806_VNAMZ-15757073905   |         429,730 |                     450 |            954.955556 | seller-printed-mass                                |
| 3154800181_VNAMZ-16289192125   |       2,300,000 |                    2000 |           1150.000000 | selected-seller-repack-claim                       |
| 3154800181_VNAMZ-15034562404   |       1,164,000 |                    1000 |           1164.000000 | selected-seller-repack-claim                       |
| 1553990700_VNAMZ-6552645102    |       1,150,000 |                     907 |           1267.916207 | correction-required-seller-printed-mass            |
| 3300919067_VNAMZ-16058119853   |       2,952,300 |                    2268 |           1301.719577 | manufacturer-printed-mass                          |
| 3326267977_VNAMZ-116172054031  |         658,000 |                     500 |           1316.000000 | manufacturer-printed-mass                          |
| 2326481300_VNAMZ-15339529115   |       3,024,000 |                    2268 |           1333.333333 | manufacturer-printed-mass                          |

The three ON-labelled share options are separate 1, 2 and 3 kg seller repacks. Their selected total selling-unit masses override unrelated shared 2 lb/500 g descriptions, but do not establish factory packaging or authenticity. Musa King is one 500 g chocolate package with selected gloves: accessories and a headline shaker capacity of 600 ml contribute no food mass or food volume. IT’S JUST uses its manufacturer-printed 2268 g, not the seller-rounded 2.3 kg or rounded serving count.

Original source digests, selected option text, arithmetic and individual caveats are in [the machine-readable receipt](whey-source-review.json). Prices retain their original observation timestamps; this audit does not establish an exhaustive market minimum or refresh any data.

## Separate whey and soy categories

The original specification-verified top ten mixes **nine whey offers and one soy offer**. MusaKing Soy SKU3326435113_VNAMZ-16271820615 has reviewed soy protein isolate ingredients; it belongs in a separate soy table. The offline dataset contains **12 verified whey offers**, or **11 after excluding the selected paid BÌNH BỘT option**. A genuine ten-row whey/protein-gram table can therefore be produced without soy: its tenth row is MusaKing chocolate with selected gloves, SKU13335359191_VNAMZ-116522825390, at 768,000 VND and 2,150.4 VND/g protein before delivery. CGN Dark Chocolate follows outside the ten.

| Exact selected SKU             | Protein source | Flavor      | Saved price VND | VND/protein g before | Eligibility                  |
| ------------------------------ | -------------- | ----------- | --------------: | -------------------: | ---------------------------- |
| 3326435113_VNAMZ-16271820615   | soy            | chocolate   |          380000 |           542.857143 | Eligible source-specific row |
| 3300919067_VNAMZ-16058119853   | whey           | unflavoured |         2952300 |          1431.891534 | Eligible source-specific row |
| 2326481300_VNAMZ-15339529115   | whey           | unflavoured |         3024000 |          1466.666667 | Eligible source-specific row |
| 3201573592_VNAMZ-15280912681   | whey           | unflavoured |         3100000 |          1503.527337 | Eligible source-specific row |
| 3261102356_VNAMZ-15736009588   | whey           | unflavoured |         3100000 |          1503.527337 | Eligible source-specific row |
| 3326267977_VNAMZ-116172054031  | whey           | chocolate   |          658000 |          1842.400000 | Eligible source-specific row |
| 13355217357_VNAMZ-116813625324 | whey           | chocolate   |          678000 |          1898.400000 | Eligible source-specific row |
| 13384018556_VNAMZ-116984256859 | whey           | chocolate   |         3950000 |          2007.793968 | Eligible source-specific row |
| 13355217357_VNAMZ-116813625322 | whey           | chocolate   |          728000 |          2038.400000 | Eligible source-specific row |
| 13335359191_VNAMZ-116522825392 | whey           | chocolate   |          728000 |          2038.400000 | Eligible source-specific row |
| 13335359191_VNAMZ-116522825388 | whey           | chocolate   |          768000 |          2150.400000 | Exclude: paid BÌNH BỘT       |
| 13335359191_VNAMZ-116522825390 | whey           | chocolate   |          768000 |          2150.400000 | Eligible source-specific row |
| 2582378529_VNAMZ-12587822048   | whey           | chocolate   |         1600000 |          2613.418269 | Eligible source-specific row |

Classify reviewed protein source from the manufacturer ingredient names, not a broad protein-powder category or a marketing headline. Soy protein is a soy-source marker; soy lecithin is not. Whey plus soy protein mixtures require their own mixed category. Unreviewed explicit marketplace source claims remain provisional. Require exact chocolate or unflavoured scope for every row, including manufacturer-verified rows. Keep whey and soy ranks separate. Original titles, exact selected options, reviewed ingredients and recommended whey order are retained in the JSON receipt.
