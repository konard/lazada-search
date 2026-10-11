---
'lazada-search': patch
---

Launch Node CI with eight filesystem workers to match the bounded catalog operations, preserving all original fixtures, fsync writes and deadlines. Drain an in-flight catalog import before temporary fixture removal after cancellation.
