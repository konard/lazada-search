# Collection, caching and CAPTCHA stop

The Vietnam/Nha Trang case collects the configured category/search lists first, then visits missing product and selected-SKU pages. Chocolate/plain whey and chocolate-core ice cream form the buying scope. Soy and other plant powders remain separate, and paid shaker selections are excluded. A marketing title such as “whey thực vật” does not establish dairy whey.

## Stop on CAPTCHA

A visible CAPTCHA, verification frame, challenge URL, or English/Vietnamese security instruction immediately stops collection. Checks run before navigation, after pacing, during loading, before variant or delivery actions, and before supported dialog confirmation. Login detection checks challenges before an account header. The stop checkpoint persists in the associative store across process restarts.

Once the stop is active, uncached page, image and manufacturer requests fail before loading. Cached evidence and offline comparisons remain available. No challenge solver, automatic retry or automatic resume is used. A person must clear the challenge in the persistent window and explicitly resume; the resume command checks that the current page is clear.

```sh
node bin/lazada-search.js collection-status --account default --no-ocr
node bin/lazada-search.js resume-collection --account default --no-ocr
```

Telegram uses `/collection_status` and `/resume_collection` with the same application and stop checkpoint. The read-only HTTP endpoint `/api/collection-status` exposes that checkpoint; cached HTTP comparisons remain available while stopped. Tests use a local mock Telegram API and intercepted browser pages, never real CAPTCHA solving or live messages.

## Continue the case

```sh
node scripts/collect-account-case.mjs --account default --exhaustive \
  --flavour-scope chocolate-or-unflavoured --interval-ms 60000 \
  --batch-size 25 --max-images 40 --ocr-languages eng+vie \
  --ocr-data-dir .lazada-search/tessdata --commit-checkpoints
```

The runner reuses completed configured lists when no replacement scopes or refresh are requested. It uses one persistent browser window and a minimum 60-second navigation interval. Supported educational disclosures express interest in learning; unsupported dialogs, unsettled loading, rate limits and CAPTCHA stop further collection. The window remains reusable between commands and closes after 30 minutes without a lease.

Each detail batch publishes sanitized product sources, regenerated tables and the public associative archive locally. Attempt records survive restarts: unavailable early products cannot starve later unattempted URLs. A confirmed removed listing is an item outcome; later products continue. Its original HTML and observation time persist as availability evidence, and historical offers stay outside current buying comparisons. CAPTCHA, unsupported dialogs and unsettled loading still stop the batch. Explicit source invalidation or a later confirmed positive SKU observation reopens the listing. Ambiguous category cards retain their source references; food cues admit additional candidates without downloading obviously unrelated recommendations.

With `--commit-checkpoints`, each successful archive verification and fresh progress audit produces a Git commit and pushes the current branch to `origin`. Only `docs/tables`, `docs/acceptance` and `data/cases/vietnam-nha-trang` are staged. Private profiles and unrelated working files are excluded; an existing staged change blocks publication so it can be resolved separately. A failed push can be retried without downloading product pages again. The same offline checkpoint is published when a CAPTCHA interrupts a batch.

Every search card, including nonmatching cards, is recorded before filtering. The case excludes clearly identified standalone shaker/blender hardware, animal feed, protein bars and plant-only/soy protein using cached title evidence. Versioned `scope-decision` records retain the original titles, reasons, source URLs and source record IDs. Unchanged decisions are reused; contradictory new evidence or a changed scope revokes stale exclusions. Redacted decisions are published into the public associative archive. Uncertain titles and listings advertised with another flavour remain candidates because their exact SKU inventory may include chocolate/plain whey. Frozen chocolate protein ice-cream bars remain ice-cream candidates. Preliminary classification does not verify a manufacturer or package.

Regenerate the full requirement/GitHub-issue acceptance report without marketplace requests:

```sh
node scripts/audit-case-requirements.mjs
node scripts/audit-case-requirements.mjs --strict
```

The strict command exits unsuccessfully while any recorded acceptance gate remains open. See [current acceptance](acceptance/requirements-audit/current.md). The saved independent reviews are dated baselines; current backlog counts are recalculated from the latest published catalog. Both observed ice routes returned the same mixed 386-item set, so terminal pagination alone does not prove category completeness.

An exhausted task queue does not prove that all marketplace inventory or manufacturers are verified. Remaining category reviews, exact factory labels, stock, bulk freight and frozen Nha Trang delivery remain required acceptance work. Old captures are not recollected while those initial collection gaps remain.

## Correct derived extraction offline

```sh
node bin/lazada-search.js replay-captures --offline --no-ocr
node scripts/reprocess-public-captures.mjs --offline --no-ocr
node scripts/export-catalog-tables.mjs --offline --no-ocr
node scripts/export-whey-verification-worklist.mjs docs/tables/catalog.json
node scripts/archive-case.mjs --offline --no-ocr
node bin/lazada-search.js archive-verify --offline --no-ocr
```

Parser corrections reuse original HTML and image hashes, capture times and reviewed manufacturer facts. Older observations cannot replace newer selected-SKU prices or package identities; price history retains every original observation. Undated legacy product imports are supported, but cannot replace dated package observations. A correction of the same observation can update its derived interpretation. Incorrect original data requires a selective source invalidation and online reload. Private account pages, credentials, OTPs and screenshots stay in the private overlay; redacted product HTML and reproducible public data belong in Git. A private browser profile alone never proves that a captured price was authenticated.

Disputed mass and volume claims persist as `specification-hold` records with original review hashes. Derived catalog, library comparisons and ice rankings withhold those fields until a later exact manufacturer match resolves them. The raw seller claim remains available for review. Family labels and grams inferred from litres cannot resolve a hold.

Browser Commander 0.29.0 is the latest npm release checked for this continuation and is pinned by the updated lockfile. The previous zero-page headed Chrome reconnect defect was reported as [upstream issue 159](https://github.com/link-foundation/browser-commander/issues/159); 0.29.0 release notes include a reconnect fix. The local consumer workaround remains covered by regressions and creates a page only when the existing default context has none.

Regression coverage: `tests/page-challenge.test.js`, `tests/e2e/captcha-stop.test.js`, `tests/e2e/account-login.test.js`, `tests/e2e/delivery.test.js`, `tests/browser-connection.test.js`, `tests/account-collection-attempts.test.js`, `tests/account-case-workflow.test.js` and `tests/e2e/ice-selling-units.test.js`.
