# CAPTCHA page retention

The user requires preserving the already detected challenge page, without opening or reopening a browser window to create a waiting state. [Issue 42](https://github.com/konard/lazada-search/issues/42) records the consumer lifecycle and status bug. The fix is in [draft PR 41](https://github.com/konard/lazada-search/pull/41).

Browser Commander was updated from 0.31.1 to the verified latest 0.31.2 release, with its reviewed npm/Deno lock metadata. [Upstream issue 174](https://github.com/link-foundation/browser-commander/issues/174) requests scoped interruption ownership for embedded supervisors. The consumer removes only launch-installed SIGINT forwarding in its dedicated worker, preserves the browser on graceful supervisor interruption, and retains normal explicit close behavior.

Detected browser challenges retain their exact CDP target through collector cleanup, capture timeouts, client restarts and supervisor recovery. A pending retained challenge stays open until explicit guarded resume or manual closure. Ordinary 30-minute inactivity closure applies after resume. Missing targets remain stopped; status and resume never create a replacement browser, page or navigation.

Library `collector.collectionStatus()`, CLI `collection-status`, Telegram `/collection_status` and HTTP `/api/collection-status` report a live handoff separately from the durable stop. Only a confirmed open headed page is `awaiting-user`. Headless pages, closed/unreachable windows and HTTP/archive-only evidence have distinct states.

The real saved Optimum Nutrition receipt was acquired by curl and imported offline. It never established a visible browser page. Its existing hard stop remains active, and its status is `no-browser-page`; no manufacturer request, challenge bypass, automatic resume or user-browser reopening was performed during this correction.

Validation receipts and exact original logs are saved here when each run completes. Historical failures are retained separately. Existing buying tables and original source observation dates are unchanged.

The [exact source 6280 review](source-6280-review.json) preserves **1,471/1,471 local Node tests**, an **82/83 local E2E run**, seven passing CI runtime jobs, a Windows Bun catalog timeout and a Windows Node job cancellation. That source is not accepted. The E2E failure exposed a partially published browser status file during supervisor replacement.

The correction publishes supervisor metadata atomically and commits recovery before readiness. A deterministic native regression holds real writes partially complete while status and reconnect verify the original browser, exact target and unchanged navigation. Source `7d43fb7` passes **1,471/1,471 local unit tests and 84/84 complete local E2E tests**, including all thirteen native retention cases, with zero failures, cancellations or skips. Strict API types, lint, formatting, duplication and 23 CI policy/budget controls pass. [Validation](validation.json), the [complete source/fixture hash manifest](source-7d43-manifest.json) and compressed logs retain exact evidence.

The Windows matrix job backstop is now 20 minutes after measured cold setup consumed 357.57 seconds; the 600-second suite and 450-second test deadlines remain fixed. All complete fixtures and failed logs are preserved. Source `7d43fb7` passes eight CI runtime jobs and the separate 84-case E2E workflow, but Windows Deno fails a lock-owner read during concurrent writer cleanup. Its complete catalog import succeeds. [Reopened issue 36](https://github.com/konard/lazada-search/issues/36#issuecomment-6128356537) records this separate storage gap.

The follow-up retries only transient Windows `EPERM` reads of the lock owner, at most four attempts with 25ms spacing. Persistent permissions and other errors still fail; a permission error never establishes a missing/dead owner or grants write access. Six lock controls pass locally on Node, Bun and Deno. Fresh full-source unit, native and CI acceptance is required for this last correction.

[Earlier native receipt](native-receipt.json) and compressed original logs retain the initial twelve-case acceptance and preceding failures. The first atomic-correction unit rerun hit sandbox restrictions on local fixture servers and process inspection; its 23 failures remain recorded, and the subsequent complete run with the required local test access passes all 1,471 tests.
