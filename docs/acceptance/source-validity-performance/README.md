# Lazy source-validity initialization

The focused follow-up passed **84/84 tests on Node.js 22.23.0, Bun 1.4.3 and frozen cached-only Deno 2.4.5**. Strict lint and formatting passed. [Commands, current code hashes and log digests](validation.json) preserve this checkpoint separately from the [historical source-validity and tag-browser receipt](../source-validity-regressions/README.md).

Catalog and comparison operations previously loaded every source-cache record before determining whether any product needed manufacturer-source validation. They now create one lazy operation-scoped loader. Claim-free products with no legacy manufacturer cross-check return before loading source metadata. Products receiving approved shared fallback corrections are checked after merging those facts. Legacy cross-check-only products still load metadata so existing source holds remain effective.

Five new regression controls prove zero source-cache scans for claim-free standalone catalogs, whole comparisons and selected-offer comparisons; one scan after approved shared fallback inheritance; and one scan shared by five concurrent eligible consumers. A subsequent operation reloads metadata and rejects a missing original blob. Existing selective invalidation, legacy hold, independent quantity and batch-read assertions remain enforced.

These are deterministic read-count checks. No wall-clock speedup or Windows suite-time improvement is claimed without a new full acceptance run.

- [Node: 84 passed](node.tap.gz)
- [Bun: 84 passed](bun.log.gz)
- [Deno: 84 passed](deno.log.gz)
- [Strict lint](lint.log.gz)
- [Formatting](format.log.gz)

No source website/API requests, real profiles, archived data or CAPTCHA state were changed. This follow-up does not assert that earlier native browser E2E evidence ran these new hashes; its recorded checkpoint remains intact.
