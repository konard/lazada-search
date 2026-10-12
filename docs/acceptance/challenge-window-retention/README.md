# CAPTCHA page retention

The user requires preserving the already detected challenge page, without opening or reopening a browser window to create a waiting state. [Issue 42](https://github.com/konard/lazada-search/issues/42) records the consumer lifecycle and status bug. The fix is in [draft PR 41](https://github.com/konard/lazada-search/pull/41).

Browser Commander was updated from0.31.1 to the verified latest0.31.2 release, with its reviewed npm/Deno lock metadata. [Upstream issue174](https://github.com/link-foundation/browser-commander/issues/174) requests scoped interruption ownership for embedded supervisors. The consumer removes only launch-installed SIGINT forwarding in its dedicated worker, preserves the browser on graceful supervisor interruption, and retains normal explicit close behavior.

Detected browser challenges retain their exact CDP target through collector cleanup, capture timeouts, client restarts and supervisor recovery. A pending retained challenge stays open until explicit guarded resume or manual closure. Ordinary 30-minute inactivity closure applies after resume. Missing targets remain stopped; status and resume never create a replacement browser, page or navigation.

Library `collector.collectionStatus()`, CLI `collection-status`, Telegram `/collection_status` and HTTP `/api/collection-status` report a live handoff separately from the durable stop. Only a confirmed open headed page is `awaiting-user`. Headless pages, closed/unreachable windows and HTTP/archive-only evidence have distinct states.

The real saved Optimum Nutrition receipt was acquired by curl and imported offline. It never established a visible browser page. Its existing hard stop remains active, and its status is `no-browser-page`; no manufacturer request, challenge bypass, automatic resume or user-browser reopening was performed during this correction.

Validation receipts and exact original logs are saved here when each run completes. Historical failures are retained separately. Existing buying tables and original source observation dates are unchanged.

Local validation: **1,470 full Node tests**, followed by **113 focused final regressions** and **10 final close controls**; **112 focused tests each on Bun and Deno**; **12 isolated native retention cases** on Browser Commander0.31.2. The full Node run precedes the final additional close guard; final full-source CI is tracked separately in [validation.json](validation.json). Strict public API types, lint, formatting and duplication checks passed. [Native receipt](native-receipt.json) and compressed original logs include preserved failures, source hashes and exact counts. Final full-source acceptance remains pending until its complete run finishes.
