# Removed-product queue recovery

The collection worker stopped on item13439335807 because the page title says `Xin lỗi! Sản phẩm này không còn tồn tại` ("Sorry! This product no longer exists"), with no product price. The generic readiness check treated it as an unsettled page and stopped the entire queue.

The classifier recognizes explicit deletion notices in the page title or an unpriced body before entering product readiness. A priced product quoting an unavailable related item is retained. CAPTCHA, login and app-only guards take precedence. Genuine loaders and unresolved dialogs still stop navigation. Extractor version16 reclassifies cached original HTML without reloading it.

The real page was captured as unavailable, with no invented price. [Source observation](observation.json) records both the original and sanitized digests; [sanitized original HTML](original-redacted.html.gz) is retained. The failed listing remains deferred, so authoritative inventory and completeness gates stay open.

[Validation](validation.json) records90 focused passes, four final classification passes and seven distinct local E2E cases across the saved runs. The real-browser regression captures the deleted page, successfully loads the next product, then replays the deleted-page cache without another request. Existing CAPTCHA tests preserve hard stops across library, CLI, HTTP and Telegram.

This recovery fixes queue handling. It does not establish exhaustive coverage, manufacturer matching, or bulk/frozen delivery prices. [Current remaining requirements](../requirements-audit/current.md) remain authoritative for the published catalog.
