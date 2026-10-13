# Collection, caching and CAPTCHA stop

The Vietnam/Nha Trang case collects the configured category/search lists first, then visits missing product and selected-SKU pages. Chocolate/plain whey and chocolate-core ice cream form the buying scope. Soy and other plant powders remain separate, and paid shaker selections are excluded. A marketing title such as “whey thực vật” does not establish dairy whey.

## Stop on CAPTCHA

A visible CAPTCHA, verification frame, challenge URL, or English/Vietnamese security instruction immediately stops collection. Checks run before navigation, after pacing, during loading, before variant or delivery actions, and before supported dialog confirmation. Login detection checks challenges before an account header. The stop checkpoint persists in the associative store across process restarts.

Once the stop is active, uncached page, image and manufacturer requests fail before loading. Cached evidence and offline comparisons remain available. No challenge solver, automatic retry or automatic resume is used. When a browser page detects the challenge, its exact existing target stays open through cleanup, capture timeout, idle waiting and collector restarts. A person clears that page and explicitly resumes. Resume checks the original target and challenged origin; it never opens a replacement window, creates a tab or navigates to recreate a challenge.

`collector.collectionStatus()`, CLI `collection-status`, Telegram `/collection_status` and HTTP `/api/collection-status` report current handoff availability alongside the durable stop. `awaiting-user` requires a confirmed open headed page. Headless pages, closed/unreachable windows and HTTP/archive-only evidence have distinct states. A missing original target stays stopped. A replacement supervisor may adopt the already running original browser/target after its previous supervisor exits, without creating a browser or page. [Issue 42 and retention acceptance](acceptance/challenge-window-retention/README.md) record the lifecycle fix.

An operator can explicitly review and dismiss a **non-browser HTTP/imported checkpoint** when it should no longer block unrelated collection. `reviewNonBrowserCollectionStop(store, review)`, CLI `review-collection-stop review.json`, structured HTTP `/api/operations`, and allowlisted private Telegram `/review_collection_stop JSON` share this action. The review must name `decision: "dismiss-non-browser-stop"`, a reason, and the exact `expectedStop` returned by inspection/status. `observedPageUrl` optionally records the origin of the page the operator reviewed; query parameters are discarded. The original challenged origin, signals and detection date remain intact. An independent durable `collection-stop-review` record preserves the requested decision; the successfully written checkpoint references its review ID. A failed stop write leaves only a requested intent, never proof of resumed collection.

This action rejects any browser binding, including incomplete metadata, and checks the expected checkpoint inside the writer lock. It performs no launch, navigation, login, CAPTCHA action or source download. Dismissal does not certify recovery of the challenged manufacturer source or authentication of a marketplace account. Fresh challenges remain detected and retained for the operator's decision. The 2026-10-13 operator explicitly requested dismissing the old Optimum HTTP checkpoint after the actual Lazada page was displayed without a CAPTCHA; ordinary public collection then resumed.

Manufacturer HTTP responses and imported originals receive the same visible challenge inspection. A corroborated Cloudflare interstitial is saved as failed evidence before the global stop is persisted; research plans preserve their partial receipt and stop immediately. Ordinary forbidden responses are cached failures rather than presumed CAPTCHA. The saved Optimum Nutrition interstitial was acquired by curl and imported offline; it has no retained browser page and does not mean the application is awaiting the user in an open window. No window is opened to turn HTTP evidence into a browser handoff. Resume requires a clear page on the saved challenged origin, so a clear marketplace page cannot silently clear a manufacturer challenge. See [issue 23 and the actual original receipt](acceptance/source-integrity/natural-chocolate-manufacturer/README.md).

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

The runner reuses completed configured lists when no replacement scopes or refresh are requested. It uses one persistent browser window and a minimum 60-second navigation interval. Supported educational disclosures express interest in learning; unsupported dialogs, unsettled loading, rate limits and CAPTCHA stop further collection. The window remains reusable between commands and closes after 30 minutes of inactivity. A retained CAPTCHA page is kept open while its hard stop awaits explicit clearance; normal idle closure resumes afterward. Manual closure never triggers automatic reopening.

Static images on genuine `lazcdn.com` and `slatic.net` hosts use a separate one-second scheduler in the application; page/API requests retain their configured interval. Each redirect uses its actual host, and non-CDN hosts keep ordinary pacing. `EvidenceCache` without an explicit `staticImageScheduler` retains its original pacing behavior. Browser capture bounds its asset-settling phase, records deferred image URLs, cancels queued requests before they acquire another pacing slot, and drains already started source inspections/writes. Required missing product labels remain retryable for separate OCR collection. Deferred work is not a negative source cache result. Persistent capture timeouts cancel Browser Commander's navigation signal, stop loading in the same page, and wait for the cancelled operation before reusing its target; they do not replace or close the tab. An operation that has not settled blocks its next capture for inspection.

Each detail batch publishes sanitized product sources, regenerated tables and the public associative archive locally. Attempt records survive restarts: unavailable early products cannot starve later unattempted URLs. A confirmed removed listing is an item outcome; later products continue. Its original HTML and observation time persist as availability evidence, and historical offers stay outside current buying comparisons. CAPTCHA, unsupported dialogs and unsettled loading still stop the batch. Explicit source invalidation or a later confirmed positive SKU observation reopens the listing. Ambiguous category cards retain their source references; food cues admit additional candidates without downloading obviously unrelated recommendations.

With `--commit-checkpoints`, each successful archive verification and fresh progress audit produces a Git commit and pushes the current branch to `origin`. Only `docs/tables`, `docs/acceptance` and `data/cases/vietnam-nha-trang` are staged. The continuous runner defers a checkpoint when unrelated work is staged and retries after the next batch; direct checkpoint publication keeps its strict default. Commits include only the validated public paths, including when unrelated work is staged concurrently. Private profiles stay local. Real Git, hook, push and archive failures still stop the runner. A failed push can be retried without downloading product pages again. The same offline checkpoint is published when a CAPTCHA interrupts a batch.

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

The locked Browser Commander version is **0.31.2**, updated after the official registry/release check. The saved [0.30.1 registry metadata](acceptance/source-integrity/browser-commander-registry.json) is a historical 2026-10-11 check. The previous zero-page headed Chrome reconnect defect was reported as [upstream issue 159](https://github.com/link-foundation/browser-commander/issues/159). Ordinary owned-browser recovery remains covered by regressions; exact challenge-target resume forbids its empty-context page-creation fallback. [Upstream issue174](https://github.com/link-foundation/browser-commander/issues/174) requests scoped interruption ownership. The dedicated consumer supervisor handles cancellation itself so Ctrl+C cannot forward a kill to a pending retained page.

Package-mass corrections reuse valid reviews only when original HTML digest, observation date, selected SKU and attached evidence still match. Multipack calculations require explicit per-inner-package evidence; a seller's total bundle weight must not be multiplied again. Automatic discovery retains potential food gifts without approving their mass, formula or purchase eligibility. [Source-integrity evidence](acceptance/source-integrity/README.md) records the parser fixes, original-label corrections and coordinated validation.

Regression coverage: `tests/page-challenge.test.js`, `tests/e2e/captcha-stop.test.js`, `tests/e2e/account-login.test.js`, `tests/e2e/delivery.test.js`, `tests/browser-connection.test.js`, `tests/account-collection-attempts.test.js`, `tests/account-case-workflow.test.js` and `tests/e2e/ice-selling-units.test.js`.
