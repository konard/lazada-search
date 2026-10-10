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
  --ocr-data-dir .lazada-search/tessdata
```

The runner reuses completed configured lists when no replacement scopes or refresh are requested. It uses one persistent browser window and a minimum 60-second navigation interval. Supported educational disclosures express interest in learning; unsupported dialogs, unsettled loading, rate limits and CAPTCHA stop further collection. The window remains reusable between commands and closes after 30 minutes without a lease.

Each detail batch publishes sanitized product sources, regenerated tables and the public associative archive locally. Attempt records survive restarts: unavailable early products cannot starve later unattempted URLs. Their errors and pending specification/category tasks remain unresolved in the audit. Explicit source invalidation or `--refresh` reopens affected attempts. Ambiguous category cards retain their source references; food cues admit additional candidates without downloading obviously unrelated recommendations.

An exhausted task queue does not prove that all marketplace inventory or manufacturers are verified. Remaining category reviews, exact factory labels, stock, bulk freight and frozen Nha Trang delivery remain required acceptance work. Old captures are not recollected while those initial collection gaps remain.

## Correct derived extraction offline

```sh
node scripts/reprocess-public-captures.mjs --offline --no-ocr
node scripts/export-catalog-tables.mjs --offline --no-ocr
node scripts/export-whey-verification-worklist.mjs docs/tables/catalog.json
node scripts/archive-case.mjs --offline --no-ocr
node bin/lazada-search.js archive-verify --offline --no-ocr
```

Parser corrections reuse original HTML and image hashes, capture times and reviewed manufacturer facts. Incorrect original data requires a selective source invalidation and online reload. Private account pages, credentials, OTPs and screenshots stay in the private overlay; redacted product HTML and reproducible public data belong in Git. A private browser profile alone never proves that a captured price was authenticated.

Browser Commander 0.28.0 was the latest checked version for this pass. A zero-page headed Chrome reconnect defect is reported as [upstream issue 159](https://github.com/link-foundation/browser-commander/issues/159). The local workaround creates a page only when the existing default context has none, then reconnects through Browser Commander.

Regression coverage: `tests/page-challenge.test.js`, `tests/e2e/captcha-stop.test.js`, `tests/e2e/account-login.test.js`, `tests/e2e/delivery.test.js`, `tests/browser-connection.test.js`, `tests/account-collection-attempts.test.js`, `tests/account-case-workflow.test.js` and `tests/e2e/ice-selling-units.test.js`.
