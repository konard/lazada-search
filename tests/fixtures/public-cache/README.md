# Public cache fixtures

Four anonymous Lazada Vietnam captures from 9 October 2026, including original
nutrition-label images, cached Tesseract English/Vietnamese words and bounding
boxes, selected variants, prices and delivery estimates for Khánh Hòa, Phường
Nha Trang. Source URLs and observation times are in `manifest.json`.

The `.lino` records and digest-checked `.links` projections are committed so the
comparison and OCR cache can be replayed offline. This is a deliberately small
subset: snapshots omit browser scripts, session state and customer reviews.
Each subset records the SHA-256 of its original snapshot. Label image bytes are
unchanged and addressed by SHA-256. These historical prices are test data;
normal freshness checks still apply to buying comparisons.

Regenerate from actual local captures with:

```sh
node scripts/export-public-fixtures.mjs .lazada-search
node --test tests/public-cache.test.js
```

The two ice-cream captures have no confirmed Nha Trang frozen delivery or
protein label. Missing values remain unknown. A quote for one powder package
does not establish freight for ten packages.
