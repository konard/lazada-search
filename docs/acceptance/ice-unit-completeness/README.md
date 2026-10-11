# Independent cached ice-cream quantity audit

The updated rankings show grams, millilitres and both unit prices together whenever supported. Source-bound package reviews now supply the same established quantities to library, CLI, HTTP and Telegram comparisons. The independent audit checked all 14 selected selling units in the earlier checkpoint report and all 84 before/after delivery unit-cost fields. No additional exact mass/volume pair was found in the reviewed cached evidence. There were zero website requests and zero downloads; the global CAPTCHA stop was respected.

This is a review of the checkpoint named and hashed in [independent-evidence-review.json](independent-evidence-review.json). Later report regeneration can change the report hash. The receipt preserves the reviewed input, individual arithmetic checks, 21 quantity-fact source checks and six additional original-artifact checks.

The [current report audit](report-audit.json) binds the regenerated rankings and verifies that both quantities and both prices appear in every sorted table wherever established. The [public-case application receipt](shared-quantity-review.json) records both durable reviews; [API usage and invalidation rules](../../package-quantities.md) describe future automated reuse.

The [fresh archive replay](fresh-archive-review.json) starts the actual CLI with an empty working store and only the exported public archive. For an order of two selling units it reproduces 262 g / 260 ml for the individual tube offer and 6,288 g / 6,240 ml for the carton offer. Both gram and millilitre rates remain unchanged; no source is downloaded and no delivery or manufacturer approval is added. The archive verifies all 34,257 records and 7,031 source blobs, including the two reviews' JSON, `.lino` and binary projections.

## Established pairs

| Exact selected offer                                      | Captured sale VND | Selling-unit grams | Selling-unit ml |  VND/g | VND/ml | Evidence and limits                                                                                                                                                |
| --------------------------------------------------------- | ----------------: | -----------------: | --------------: | -----: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2978009544_VNAMZ-14350953081`, PowerCap chocolate tube   |            27,000 |                131 |             130 | 206.11 | 207.69 | Exact matching factory wrapper printed mass, manufacturer export endpoint volume. Seller protein remains a reference, not verified factory nutrition.              |
| `3040048563_VNAMZ-14623760583`, PowerCap chocolate carton |           648,000 |              3,144 |           3,120 | 206.11 | 207.69 | Selected description establishes 24 tubes. Apply the individually declared 131 g and 130 ml once per tube. Frozen delivery to Nha Trang is explicitly unavailable. |

The unchanged [original PowerCap wrapper](../ice-dual-units/expanded-powercap-abc-front.png), SHA-256 `36b92b0233b8325abaee53fbb563ea92ab4a3383125ce403988f2a8901541819`, was manually viewed again. It plainly prints **130 mL** and **131 g**. The [manufacturer volume response](../ice-dual-units/bing-powercap-chocolate-volumes.json), SHA-256 `a0b425d5a1e777b116bd958c84c7ad04fb4f2075b1fd4ead0349b542d9359737`, identifies Chocolate product 774, variant 796, 130 ml. The carton description decoded original hash is `39f5a43f7e064f82736e983ae9e30c134490cd1061a6009bdc3378fa57f322e1`; its declared `Thùng24 chai` and `24 cây/ thùng` establish selling-unit count.

## Quantity claims held outside rankings

| Product                             | Established denominator                             | Unresolved or conflicting denominator | Reason                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iBerri chocolate 6 L                | 6,000 ml                                            | Exact grams                           | The seller's 3 kg title conflicts with its 3–3.3 kg flavour-dependent description; distributor prose ranges 3–3.6 kg. Cremo's manufacturer 6 L/3 kg family is not an exact iBerri export-SKU match. |
| Cremo chocolate white 6 L tub       | 6,000 ml                                            | Exact grams                           | Manufacturer 3 kg belongs to a yellow confection tub. The selected white tub cannot inherit its weight. Delivery to Nha Trang is explicitly unavailable.                                            |
| Lotte Fanfare chocolate cup         | 175 ml, seller package evidence                     | Exact grams                           | A registry family row's 175 g does not identify this chocolate export cup. Same-barcode 170 ml and other 195 ml revisions cannot establish this selected mass or formula.                           |
| Happy Gelato Belgian chocolate      | Selected 125 ml or 475 ml                           | Exact grams and current protein       | The original fronts were visually checked; they print volume only. Historical 2021 laboratory nutrition is not mapped to the current package/formula.                                               |
| Merino cocoa-crisp stick            | 40 g per stick; selected 40 g or 200 g selling unit | Exact ml and current protein          | No exact label volume is available. A 40-stick logistics carton is not the selected one-stick or five-stick selling option.                                                                         |
| Merino chocolate cone               | 60 g per cone; 300 g selected five-cone pack        | Exact ml and current protein          | No exact label volume is available. Retailer nutrition conflicts and untraced third-party food entries remain quarantined.                                                                          |
| WorldCone, Aice cone and Aice mochi | Retained historical/source claims only              | Requested chocolate-core eligibility  | Their existing scope rejections remain in force; a known amount does not make a rejected product eligible.                                                                                          |

The [Happy 475 ml original front](../ice-exact-label-followup/happy-belgian-chocolate-475ml-original.webp) has hash `6583224988823985367b40e065aa6617fcbf984e30e3b2b5b9f0994d75a77ec2`; the [125 ml original front](../ice-exact-label-followup/happy-belgian-chocolate-125ml-original.webp) has hash `74475122b45d0440381f91586bb697cf021f84c9dd87cf88e85866f58cd36bb6`. Neither supplies a gram declaration. Grams and millilitres remain independent measurements; no density or rounded nutrient-ratio conversion was used.

One Merino selected HTML contains private original state, so its public redacted derivative is verified through the committed [provenance mapping](../ice-exact-label-followup/public-source-provenance.json). The receipt distinguishes the original hash from the independently verified public derivative hash; it does not claim to have verified unpublished private bytes.

## Presentation corrections supported by this audit

- Show grams, millilitres, VND/g and VND/ml together for every row wherever independently established, even when the table is sorted by only one metric.
- Keep separate gram and millilitre sorting. One measured amount cannot supply the other through assumed density.
- Identify a missing or conflicting quantity at the relevant cell and preserve the reason beside the product.
- Distinguish current missing fields from superseded review gaps: the original Korean review still says PowerCap grams are absent, while its later review establishes 131 g.
- Preserve captured timestamps, source authority and delivery restrictions. These calculations do not establish current price, complete collection, verified factory nutrition or a deliverable bulk winner.

## Actual-original library, CLI, HTTP and Telegram verification

The dedicated [E2E test](../../../tests/e2e/ice-quantity-review.test.js) imports the saved 24-bottle selected HTML and unchanged 131 g/130 ml wrapper into an isolated temporary associative store. An explicit offline quantity-only review is exercised through the library, actual CLI, local HTTP operation and local Telegram operation. Comparisons through those interfaces and after store restart preserve 3,144 g, 3,120 ml, 206.11 VND/g and 207.69 VND/ml. A two-carton comparison multiplies measured quantities once, while keeping unit rates unchanged.

All **16 tests pass** and strict ESLint passes. The [E2E receipt](e2e-review.json) binds tested source hashes and compressed logs. The test confirms the original capture's unavailable Nha Trang delivery, zero downloads, unchanged raw product/offer and unchanged global challenge stop. Label evidence retains `manufacturer-label-secondary-host` authority; factory identity, protein nutrition and freight are not approved by quantity review.

Rejected inputs include unsupported nutrient fields, incorrect original digests, unattached labels, invalid amounts and mismatched units. Corrupt or missing label bytes, source invalidation, changed listing digest, a later observation and a tampered SKU all withdraw the reviewed gram amount while preserving the independently captured 130 ml amount. These controls are actual failed-input assertions, not synthetic completeness claims.

The initial failed test and lint outputs are preserved: the test harness initially searched the gram-ranked `observedPrices` for an offer whose mass had correctly been withheld, rather than inspecting the retained `comparisons`; lint required `globalThis.structuredClone`. The final passing run verifies both corrections. No external service was contacted; HTTP and Telegram servers bind only to loopback.

```sh
node --test tests/e2e/ice-quantity-review.test.js
node node_modules/eslint/bin/eslint.js tests/e2e/ice-quantity-review.test.js --max-warnings 0
```

## Browser launch observation

The initial full E2E run passed 63 of 64 tests. Its only failure was a Chrome startup timeout in the existing browser-recovery test, before the recovery step. The same test passed unchanged in an isolated 4.3-second retry. [Browser Commander #171](https://github.com/link-foundation/browser-commander/issues/171) records this intermittent observation; the [environment and release check](browser-startup-review.json) and [submitted report](browser-startup-issue.md) retain its limits. Browser Commander 0.31.1 remains the latest release. The cause is unconfirmed; display-link warnings are not proof of a cause, and the timeout is not hidden by an automatic relaunch.

## Full validation of this change

The [final validation receipt](validation.json) binds the current source files, regenerated reports, archive manifest and original logs. All **1,333 unit tests** and all **64 full E2E tests** pass, with zero failures, cancellations or skips. The full E2E confirmation includes the real Chromium, Tesseract and link-cli checks and the browser recovery that failed in the initial run. The initial failed run and successful isolated retry remain separately preserved.

The six changed calculation/catalog test files additionally pass **41 tests under Bun and 41 under Deno**, with Deno using only cached dependencies and loopback networking. `npm run check`, strict lint on changed JavaScript, formatting, the TypeScript public-API fixture and 255 local Markdown file targets pass. The initial handpicked JSON formatting failure is retained; the generator now formats that output consistently. This acceptance is local and source-bound; the earlier cross-platform GitHub receipts remain historical, and full catalog/manufacturer/frozen-freight acceptance is still incomplete.
