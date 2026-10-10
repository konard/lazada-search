# 10.10 strict chocolate ice-cream review

The cached selected-SKU inventory contains five preliminary pure-chocolate candidates: two Merino cocoa-stick single offers, one five-stick Merino option, and two Happy Gelato Belgian chocolate sizes. No candidate has confirmed frozen delivery to Nha Trang or an exact manufacturer nutrition panel sufficient for protein-cost ranking. [All 24 captured selling options and exclusions](captured-options.md) remain reviewable.

The lowest observed sticker costs among those five candidates are **39,000 VND for five stated 40g Merino cocoa sticks (195 VND/g)** and **150,000 VND for stated 475ml Happy Gelato Belgian chocolate (315.79 VND/ml)**. These quantities remain marketplace claims, and neither offer has a confirmed Nha Trang frozen-delivery quote. They are preliminary arithmetic, not purchase winners. No discounts or quantity-dependent freight are invented.

The manufacturer's original Aice labels resolve two misleading product names. Miki-Miki is vanilla ice milk with chocolate coating, **25g/35ml per stick**. Chocolate Crispy is vanilla and milk ice milk coated with two chocolate layers, **60g per stick**. They do not satisfy strict chocolate ice-cream flavour. OCR missed important text; the values were verified visually in the original images. See [manual label review](manufacturer-label-review.json) and [cached originals/OCR](label-cache.json), sourced from [Aice Miki-Miki](https://aicevietnam.vn/san-pham/kem-que-miki-miki/) and [Aice Chocolate Crispy](https://aicevietnam.vn/san-pham/kem-que-socola-gion/).

Listing **13430497758**, titled “Kem Sô-cô-la Giòn Que,” is a crunchy chocolate confectionery snack. Its breadcrumb and description explicitly identify chocolate bags and cocoa-butter-substitute snacks. It should be quarantined for every selling option, with prices retained in the audit. The [exact recommendation and cached HTML provenance](category-quarantine-recommendation.json) permit an offline durable category correction.

The public associative store now contains durable listing-wide `unknown` category reviews for this snack and the five vanilla-core Aice listings. Every action used attached evidence from the same Lazada listing; all offer records and product names were checked unchanged. [Action receipt](category-quarantine-receipt.json) records review IDs, source evidence, product corrections and zero downloads. Existing future-SKU imports apply these stored listing reviews.

Cached Nha Trang delivery captures explicitly reject Merino banana-cup listing 497330157 and Celano mixed-tub listing 338968082. Two other mixed-flavour listings show 37,700 VND standard freight with 15–17 October arrival; they contain no frozen-chain promise and are excluded from the strict flavour scope. [review.json](review.json) records the exact evidence IDs and arithmetic without claiming cold delivery.

Official Celano sources themselves contain conflicts: the chocolate-stick URL says 70ml, current title says 53g, and description says 66g; the three-flavour tub URL says 500g while its description gives 508g/860ml. These pages must not overwrite marketplace denominators without a matching package label. The [Nutifood shipping policy](https://ngoinhadinhduong.com/pages/chinh-sach-giao-hang) describes national delivery generally, separate arrangements for bulk orders, and special handling/acceptance for cold goods. That policy establishes no specific frozen service to Nha Trang.

Public manufacturer HTML and original label images are cached in this directory; [source-cache.json](source-cache.json) records successful downloads and the Happy Gelato official site's DNS failure. Rerunning the source and label scripts reuses successes and recorded failures. No Lazada requests or browser actions were used for this review.

Further cached-gallery review found a chocolate-specific Happy Gelato laboratory report with **4.60g protein, 4.80g fat, 24.0g carbohydrate and 158kcal per 100g**. Its 2021 tested-sample identity does not establish current selling-SKU weight or formulation. [The targeted evidence report](targeted-evidence.md) links original report images, the partial review, local availability leads and concrete manufacturer-access failures; its isolated associative archive is excluded from purchase ranking.

[New-category candidate conflicts](new-candidate-conflicts.md) record the King's five-bite/60 ml quantity trap, contradictory Merino 68 g formulas and unresolved bear-package identity. The Bliss hazelnut product remains an excluded manufacturer-documented lead under the strict chocolate scope.

[Binggrae export Samanco review](samanco-export-evidence.md) preserves primary evidence that the manufacturer describes a vanilla core with fillings. Its 24 × 150 ml chocolate-labelled carton remains outside the strict chocolate-core ranking until the exact regional label is matched; default Original-variant nutrition is not promoted to the chocolate SKU.

```sh
node scripts/urgent-icecream-report.mjs
node scripts/urgent-icecream-sources.mjs
node scripts/urgent-icecream-labels.mjs
node scripts/urgent-icecream-apply-quarantine.mjs
node scripts/urgent-icecream-targeted-evidence.mjs
```
