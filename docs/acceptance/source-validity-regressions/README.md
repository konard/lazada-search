# Source validity and redirected search readiness

Targeted local checks passed **80/80 unit regressions and 3/3 native browser E2E tests**, with no skipped tests. Strict lint and formatting passed. [Commands, source hashes and preserved log digests](validation.json) record the checked scope.

Two concrete defects were repaired. Approved manufacturer nutrition could remain available after a leaf label or exact source was invalidated because consumers only checked cached anchor URLs. Catalog and comparison consumers now withdraw affected fields on explicit evidence/source/cache/URL invalidation, changed original source hashes, missing original bytes or invalidated approval records. Independent quantities and actual offer prices remain available, original stored observations remain intact, and source-dependent manufacturer work reopens.

Legacy source holds remain effective. A broad hold is replaced with granular handling only when the complete stored review has corresponding source evidence and SHA bindings for every relevant fact. One unrelated granular fact cannot waive uncertain legacy nutrition. Source-validity caches are shared within each operation, including selected-offer comparisons, and are refreshed for the next operation; the existing batch-read regression remains enforced.

Keyword searches can redirect to Lazada `/tag/` pages. Readiness previously accepted such pages without requiring product cards. The intercepted native browser regression supplies a terminal pager first and injects cards later; discovery now waits for stable cards or an explicit empty state before accepting that terminal page.

The new coverage consists of 11 source-validity tests, one tag-readiness unit test and one native tag-search E2E. Existing manufacturer workflow, catalog, quantity-review, shopping, review-replay and loading regressions accompany them.

- [80 passing unit regressions](unit.tap.gz)
- [3 passing native browser E2E tests](native-e2e.tap.gz)
- [Strict lint](lint.log.gz)
- [Formatting](format.log.gz)

Native Chromium used an isolated temporary profile with every page request intercepted. Default-sandbox browser launch failed before any navigation; approved isolated execution completed the tests. No real user profile, website/API request, archived product data or saved CAPTCHA state was changed.

These checks do not establish current live layouts, complete marketplace inventory, current manufacturer formulas, stock or usable bulk/frozen delivery to Nha Trang. Those acceptance conditions remain separate.
