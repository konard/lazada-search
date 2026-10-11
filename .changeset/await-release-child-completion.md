---
'lazada-search': patch
---

Wait asynchronously for the real release-versioning and formatter processes to close, rather than imposing a separate 20-second subprocess watchdog. Tie cancellation to the existing test signal and terminate its owned formatter process tree and drain both the tree termination and child close before removing its temporary package. Use a dedicated process group on POSIX and await Windows taskkill /T /F before parent cleanup; retain the fixture if tree termination fails. Preserve real patch versioning, Deno-absent PATH and independent formatting assertions, add actual completion-output/nonzero/cancellation and live-grandchild controls, and exercise the current permitted Deno runtime instead of retaining its obsolete read-only early return. The 450-second test and 600-second suite budgets stay unchanged; fresh full-platform CI must establish acceptance.
