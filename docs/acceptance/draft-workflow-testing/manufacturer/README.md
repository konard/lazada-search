# Local manufacturer workflow acceptance

The targeted offline checks passed **112/112 tests on each of Node.js 22.23.0, Bun 1.4.3 and Deno 2.4.5** on macOS. The workflow suite contributes 40 tests. Strict ESLint and formatting checks also passed. [Exact commands, versions, tested file hashes, results and log digests](validation.json) preserve what was checked.

No source website or API was contacted. HTTP search tests replace `fetch` with in-process response fixtures; Deno received no network permission. Temporary associative stores, private fallback stores and model directories hold all test writes. The saved Optimum Nutrition CAPTCHA and archived collected evidence were not changed or resumed.

The checks prove that reviewed primary facts attach their exact preserved originals, survive associative storage restart and preserve offer prices. Private attachments and approval records remain private over public shared originals. Independent quantity review can establish both grams and millilitres without approving nutrition or manufacturer identity. Literal source quantities, units and excerpts are rechecked before staged writes. Corrupted originals, invalidations, stale or mismatched identities, changed candidates and newer product captures withdraw approval.

OCR checks verify stored original and derived image identities, real lossless crop bytes, raw TSV transcription, crop renderer/recipe and declared native model manifests. The new private transform integration uses fixture OCR; the existing crop regression also runs installed Tesseract against a committed manufacturer label and recovers its actual decimal protein value. Missing provenance and transformed images with forged original hashes remain rejected.

Search checks cover exact bounded cache identities, cache-only reuse, bounded JSON POST requests and responses, prohibited redirects, token echo removal and persistent global CAPTCHA stopping. Source targets remain constrained by the trusted manufacturer registry; none of these fixtures approve a live factory formula. A positive offline catalog plan-to-run test reuses a cached primary JSON original, retains separate source-bound quantity and nutrition drafts, requires human review and resumes with zero executed tasks and downloads.

Two real failures were repaired: an older manually constructed test OCR receipt omitted its original engine/language/segmentation and TSV-derived metadata, and Deno rejected the abbreviated Node `FileHandle.read(buffer)` overload. The fixture now contains complete provenance. Model streaming now supplies explicit offset, length and position while preserving SHA checks and byte limits. The source-bound quantity bridge also gained a shared original-value validator and exact quantity identity guard. Explicit structured source flavour and revision cannot be overridden by an operator packet. The original Häagen-Dazs negative-basis fixture now imports its complete archived OCR receipt and checks all TSV-derived metadata.

| Check                                              | Result                          | Preserved log        |
| -------------------------------------------------- | ------------------------------- | -------------------- |
| Node.js seven-file regression set                  | 112 passed, 0 failed, 0 skipped | [TAP](node.tap.gz)   |
| Bun seven-file regression set                      | 112 passed, 0 failed            | [Log](bun.log.gz)    |
| Deno frozen, cached-only seven-file regression set | 112 passed, 0 failed            | [Log](deno.log.gz)   |
| Strict ESLint                                      | Exit 0, maximum warnings 0      | [Log](lint.log.gz)   |
| Prettier                                           | All matched files formatted     | [Log](format.log.gz) |

The [initial OCR fixture failure](initial-legacy-fixture-failure.log.gz) and [initial Deno read-overload failures](initial-deno-read-overload-failure.log.gz) are retained for diagnosis. They precede the successful final runs.

These are local implementation checks. They do not establish Windows/Linux CI, live manufacturer identity, current stock, Nha Trang bulk or frozen delivery, complete marketplace coverage or a cheapest buying winner. Those acceptance conditions remain separate.
