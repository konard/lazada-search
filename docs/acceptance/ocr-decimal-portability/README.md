# Decimal OCR and Windows CLI portability

The actual Ubuntu CI engine read `45` instead of `4.5` from the original two-times Lanczos crop. The same crop on macOS read `4.5`. This failure remains preserved; it was not repaired by guessing a number or changing an assertion.

An isolated experiment replayed twenty pixel transforms under each of Tesseract 5.3.4 on Ubuntu 24.04 and Tesseract 5.5.2 on macOS. Both engines used the identical English model digest. The two-times nearest-neighbour crops produce literal `4.5` and `4.0` on both engines. The final native test now requests this existing transform while retaining the original crop rectangles, dimensions, grayscale, segmentation mode and exact assertions. Historical cached and mocked Lanczos controls remain unchanged.

The [complete original experiment](experiment.tar.gz) retains the original image, generation script, twenty derived images, forty raw TSV outputs, versions, commands and digest manifest. [The review](review.json) records both positive and negative controls. The winning crops and their original TSVs are also individually committed. These readings remain review-only: the exact Lazada package and formula are unmatched, and no nutrition facts are approved.

The Windows matrix separately exposed a CRLF CLI shebang. `.gitattributes` now keeps `bin/**` as LF. The real checkout regression includes the actual CLI and preserves original OCR, Links Notation and mixed-line-ending HTML bytes. An ordinary control file must become CRLF, proving that conversion is active rather than bypassed.

Focused Node, Bun and Deno checks and fresh actual CI results are recorded alongside these originals. A revised-recipe Windows result must come from the real Windows matrix. Complete local acceptance with Browser Commander 0.31.0 is recorded in [the dependency receipt](../browser-commander-031/review.json); its frozen library/browser code and installed dependency hashes remain unchanged by these test and Git-attribute corrections.

The experiment also records a separate cache-identity follow-up: replacing trained-model bytes under an unchanged engine version, language and path does not currently change the OCR cache key. This was not the cause of the decimal failure because both tested model digests match. Such replacements require explicit cache invalidation until model-byte fingerprinting is implemented.
