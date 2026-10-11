# Browser Commander 0.31.0 acceptance

The authoritative npm registry was checked after the release appeared. The installed package is upgraded from 0.30.1 to 0.31.0; the npm integrity-locked dependency graph changes only that package. The guarded large-document codec patch remains unchanged and enabled.

The complete local suite passes **1,291 unit tests and 48 native/browser E2E tests**, with no skips, failures or cancellations. [The receipt](review.json) preserves exact raw-log hashes, frozen code and installed dependency digests. The quality check also passes. The two subsequent native OCR fixture and Windows Git-attribute corrections have separate focused and actual CI acceptance.

Static review finds the capture, interaction and persistent-session implementation unchanged. Recording is now disabled by default upstream; the collector also retains its explicit setting. The earlier launch-panel, capture and reconnect reports remain linked from the roadmap. This upgrade does not establish marketplace completeness or clear the existing manufacturer security challenge.
