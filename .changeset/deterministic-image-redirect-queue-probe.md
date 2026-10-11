---
'lazada-search': patch
---

Replace four redirect-chain tests' three-second deadlock watchdogs with a test-only asynchronous-context check that rejects nested scheduling before another host queue is acquired. Preserve the real durable store, source bytes, pacing, redirect limits and replay assertions, with same-host and cross-host negative controls. The unrelated browser page-host probes and the existing 450-second test and 600-second suite budgets remain unchanged; complete Windows Bun acceptance still requires actual CI.
