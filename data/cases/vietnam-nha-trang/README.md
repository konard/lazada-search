# Vietnam / Nha Trang protein and ice-cream case

This directory contains the collected public research evidence for bulk buying protein powder and chocolate ice cream from Lazada Vietnam, with prices in VND and delivery to Nha Trang. It is part of the repository, independent of the private browser profile and working folder.

The snapshot contains **8,705 records and 3,135 evidence blobs**. It includes captured listing/search/manufacturer HTML, structured JSON snapshots, original label/gallery images, public screenshots, OCR text with word boxes, individual SKU inventories, discovery records, selected-SKU price observations, one-package delivery quotes, manufacturer cross-checks, field reviews and correction/offer histories. Ninety-four authenticated product captures are published as redacted HTML and derived records; private account screenshots and session details are excluded. JSON and YAML imports also retain their original source bytes when used. Eleven selected SKUs have exact reviewed manufacturer specifications. Remaining manufacturer-match and collection gaps remain recorded; storing a source does not establish that it is accurate or complete.

- [Confirmed captured prices, sorted cheapest first](../../../docs/tables/known-prices.md)
- [Catalog, delivery/unit costs and unresolved gaps](../../../docs/tables/README.md)
- [Manual screenshot review](../../../docs/acceptance/visual-review/README.md)
- [Case requirements and collection findings](../../../docs/cases/vietnam-nha-trang.md)
- [Checksums, timestamps and source/conversion inventory](manifest.json)

## Use the committed case without downloading

From the repository root, using Node.js 22.13 or newer:

```sh
npm ci
node bin/lazada-search.js compare --offline --no-ocr --allow-stale --sort totalBeforeDelivery
node bin/lazada-search.js audit --offline --no-ocr
node bin/lazada-search.js serve --offline --no-ocr
node bin/lazada-search.js archive-verify --offline --no-ocr
```

The CLI automatically reads this directory. `--data-dir` selects a separate writable working folder, and `--archive-dir` selects a different case. `--no-archive` disables the repository fallback. Existing local records override the committed records. Replaying the archive requires neither a browser nor Tesseract; rerunning OCR on new images requires Tesseract.

The same archive is available to library callers:

```js
import { AssociativeStore, LazadaSearch } from 'lazada-search';

const app = new LazadaSearch({
  store: new AssociativeStore({
    directory: '.lazada-search',
    archive: 'data/cases/vietnam-nha-trang',
  }),
  offline: true,
  ocr: false,
});
try {
  const report = await app.compare({
    category: 'whey',
    sort: 'totalBeforeDelivery',
    allowStale: true,
  });
  console.log(report.observedPrices);
} finally {
  await app.close();
}
```

## Refresh or correct sources

Committed captures are reused until an explicit refresh or invalidation. Their original price timestamps are preserved. Historical prices can be sorted as observations; purchase eligibility still checks freshness, exact specifications, shipping and stock. The archive does not turn an old price into a current quote.

```sh
# Fix extraction against saved HTML without contacting Lazada.
node bin/lazada-search.js collect LAZADA_URL --offline --reprocess --no-ocr

# Require a replacement source after finding incorrect source data.
node bin/lazada-search.js invalidate LAZADA_URL --reason 'Selected variant or source data is incorrect'
node bin/lazada-search.js collect LAZADA_URL --refresh
node bin/lazada-search.js delivery LAZADA_URL --refresh

# Reload and cross-check an incorrect manufacturer source.
node bin/lazada-search.js invalidate OFFICIAL_URL --reason 'Manufacturer specifications changed'
node bin/lazada-search.js verify PRODUCT_ID OFFICIAL_URL --refresh

# Re-import corrected JSON/YAML, preserving source and conversion history.
node bin/lazada-search.js import corrected-products.yml

# Publish the updated case and its recalculated Markdown tables.
node scripts/archive-case.mjs --offline
node scripts/export-catalog-tables.mjs --offline
node bin/lazada-search.js archive-verify --offline --no-ocr
git add data/cases/vietnam-nha-trang docs/tables docs/acceptance
git commit -m 'Update collected evidence and price comparisons'
```

Invalidation requires a reason and is persisted. Invalidated captures cannot satisfy an offline collection. Their dependent prices, specifications and shipping quotes are excluded from confirmed comparisons until the source reload succeeds. Individual-source refreshes use the existing request scheduler; there is no full-catalog download. A changed page or image is content-addressed separately. OCR engine/language/segmentation keys and extraction/source fingerprints control reuse of derived records.

## Stored formats and integrity

`manifest.json` indexes every file using SHA-256 of both compressed bytes and uncompressed content. Files use deterministic gzip to reduce repository size. Paths include content hashes, so repeated exports reuse unchanged sources and conversions. A new manifest is published after the complete snapshot is written; a failed export leaves the previous manifest usable. Git retains prior snapshots.

- `records/*.json.gz`: all records grouped by namespace, including raw structured page snapshots.
- `links/*.lino.gz`: lossless Links Notation conversion of each namespace's JSON records.
- `links/*.links.gz`: `LZARCH01` bundles of application `LZLINK01` binary doublet graphs, one graph per record. The archive reader loads these directly; these application files are distinct from native link-cli archives.
- `blobs/<prefix>/<sha256>.gz`: HTML, images, screenshots and imported source files. New OCR runs also retain original Tesseract TSV output.

`archive-verify` checks every blob hash and every JSON → `.lino` → binary conversion. Changed source contents or conversion fingerprints rebuild the affected namespace; corrupted conversions are repaired on re-export. The working store checks and rebuilds its own binary projections from canonical `.lino` records.

For manual inspection, decompress the path listed in the manifest:

```sh
gzip -dc data/cases/vietnam-nha-trang/records/product.*.json.gz
gzip -dc data/cases/vietnam-nha-trang/links/product.*.lino.gz
```

Executable page scripts, tracking/security URL parameters and account/header fields are removed from archived HTML; public product DOM, JSON-LD and SKU inventories are retained. The manifest records original and sanitized HTML hashes. Empty tracking responses contain no product evidence and are counted separately. Browser profiles, cookies, session caches, bot credentials and executables stay outside this public archive.

Tests cover fresh archive replay, explicit refresh/invalidation, source corrections, conversion consistency, corruption, failed exports and zero-download library/CLI/HTTP replay using real public fixtures. Telegram comparison tests cover complete row delivery and verification status. See [validation evidence](../../../docs/acceptance/validation.json).
