---
'lazada-search': patch
---

Run the complete Bun unit manifest with two built-in isolated test-file workers so the full catalog import overlaps independent files. Preserve every fixture and assertion, the 450-second per-test limit, the 600-second suite budget and durable writes. Add a policy regression that forbids narrowing the manifest, disabling isolation or masking failures with retries. Actual Windows CI must establish complete-suite acceptance; local three-file isolation and failure-propagation proofs are not a whole-catalog result.
