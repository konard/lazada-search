# Lazada search

An evidence-backed product research library, CLI, Telegram bot and online calculator for whey protein and chocolate ice cream. Defaults are Lazada Vietnam, VND and **Nha Trang** delivery.

[Published catalog tables](docs/tables/README.md) include every captured candidate, manufacturer-source leads, missing listings, missing SKU prices, delivery arithmetic and manual screenshot reviews. **The current live dataset is incomplete and has no fully manufacturer-verified purchase winner.**

[Captured prices sorted cheapest first](docs/tables/known-prices.md) remain usable while other fields await verification. The [complete public evidence archive](data/cases/vietnam-nha-trang/README.md) is committed with the case, including source snapshots, HTML, images, OCR, correction histories, `.lino` and binary conversions. A fresh checkout can replay it without website requests.

The collector uses [Browser Commander](https://github.com/link-foundation/browser-commander), preserves page text, specifications, JSON-LD, variant options, images, HTML and screenshots, and runs local Tesseract OCR. Gallery extraction prefers the largest image URLs actually present in the page, including embedded image metadata. Products, offers, label claims and manufacturer checks form an associative links network. Every calculation can be rerun from cached evidence without visiting Lazada.

## Quick Start

Use Node.js 22.13 or newer. Install Tesseract and the languages needed for your labels (`eng`, optionally `vie`).

```bash
npm install
npx playwright install chromium
# macOS: brew install tesseract tesseract-lang
# Ubuntu: sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-vie
cp .lenv.example .lenv
node bin/lazada-search.js compare --offline --no-ocr --allow-stale --sort totalBeforeDelivery
node bin/lazada-search.js crawl --max-pages 5 --max-products 100
node bin/lazada-search.js compare --category whey --quantity 10
node bin/lazada-search.js compare --category chocolate-ice-cream --quantity 10
node bin/lazada-search.js serve
```

Open `http://127.0.0.1:8080` to change quantity, shipping, discounts and nutrition filters. Calculations read the current store on every request. Collected and imported fixture data are kept separate; the tool never seeds fictional products into your shopping database.

A public-page crawl works without `--session-from`. When an existing session is accessible, `--session-from auto` uses Browser Commander's domain-scoped import into a dedicated automation profile. You can choose `chrome`, `firefox`, `yandex` or `safari` and `--session-profile NAME`. Session contents stay local and are excluded from graph exports. `sessions` reports only availability, counts and access errors. A cookie count does **not** prove authentication. Safari files may require macOS Full Disk Access. If an existing debugging browser is available, `--cdp-url http://127.0.0.1:9222` collects in a new tab in its existing context. The original tabs remain open.

If no session can be imported, `node bin/lazada-search.js login` opens the dedicated profile for sign-in. Close it with Ctrl+C; subsequent commands retain that profile. Challenges and login walls are reported and stop collection. `--refresh` retries a page after access has been restored.

## Configuration

CLI options override environment defaults and `.lenv` configuration through [lino-arguments](https://github.com/link-foundation/lino-arguments). Existing environment variables take precedence over the default `.lenv` file; `--configuration FILE` selects an explicit configuration.

| Setting                     | Default                        | Purpose                                    |
| --------------------------- | ------------------------------ | ------------------------------------------ |
| `LAZADA_DATA_DIR`           | `.lazada-search`               | Private local state                        |
| `LAZADA_ARCHIVE_DIR`        | `data/cases/vietnam-nha-trang` | Committed public case fallback             |
| `LAZADA_MARKET`             | `vn`                           | Also supports `th`, `sg`, `my`, `ph`, `id` |
| `LAZADA_DELIVERY_AREA`      | `Nha Trang`                    | Delivery context for page cache            |
| `LAZADA_SESSION_FROM`       | empty                          | Optional existing browser session          |
| `LAZADA_BROWSER_EXECUTABLE` | auto                           | Browser Commander executable selection     |
| `LAZADA_CDP_URL`            | empty                          | Optional running browser endpoint          |
| `LAZADA_OCR_LANGUAGES`      | `eng`                          | Tesseract languages, e.g. `eng+vie`        |
| `LAZADA_OCR_DATA_DIR`       | system                         | Optional local trained-model directory     |
| `LAZADA_CLINK_COMMAND`      | `clink`                        | Optional native store executable           |
| `TELEGRAM_BOT_TOKEN`        | empty                          | BotFather token                            |
| `TELEGRAM_ALLOWED_USER_IDS` | empty                          | Comma-separated private-chat user IDs      |

Run `node bin/lazada-search.js --help` for all options. Page navigations and explicit image downloads start at least three seconds apart per domain. `--offline` prohibits website downloads; cached stale prices still require `--allow-stale` for purchase eligibility. `--no-ocr` explicitly disables OCR. Committed case sources are reused until explicit refresh or invalidation. With `--no-archive`, search/listing snapshots expire after six hours and manufacturer pages after 30 days. Images and OCR are keyed separately; OCR includes the engine version, languages and segmentation mode. Images observed by the browser are reused for OCR, and cached images are served back to later browser pages. New selectors and changed HTML hashes reprocess saved HTML without downloading the page again; `collect --reprocess --offline` explicitly repeats extraction. `--refresh` rechecks the page and image evidence online. `invalidate URL --reason TEXT` persists a correction/reload requirement, which an offline request cannot satisfy. Re-export with `archive`, and verify all sources and conversions with `archive-verify`.

## Comparison and evidence

The default metric is delivered cost per gram of protein:

```text
order cost = quantity × applicable unit price + order shipping − confirmed order discount
food mass = package net mass × explicit pack count × quantity
protein mass = food mass × protein per 100 g ÷ 100
cost per 25 g protein = order cost × 25 ÷ protein mass
```

Bulk tiers use an explicit minimum package quantity. Shipping and coupons apply once to the whole order. The tool also calculates cost per kilogram, protein per 100 kcal and sugar per 25 g protein. It reports separate best offers for whey and chocolate ice cream. Currencies are never silently mixed or converted.

Every relevant offer remains visible in `comparisons`, the calculator table and
Telegram, including offers that need more information. The following metrics
are calculated independently before and after delivery: `totalBeforeDelivery`,
`totalAfterDelivery`, `costPerGramBeforeDelivery`, `costPerGramAfterDelivery`,
`costPerMlBeforeDelivery`, `costPerMlAfterDelivery`,
`costPerProteinGramBeforeDelivery`, `costPerProteinGramAfterDelivery`, and the
corresponding costs per 25 g protein and per kg of food. Missing shipping makes
the after-delivery values `null`; missing labelled mass or volume makes only
the affected unit costs `null`. No volume-to-mass conversion is assumed.
`totalCost` and the original unit-cost names retain the legacy calculation:
when shipping is unknown they represent merchandise cost only. Use the explicit
before/after fields for delivery comparisons.

`observedPrices` contains confirmed selected-SKU observations sorted by the chosen known metric, independently of manufacturer verification. `unsortable` retains rows missing that metric or variant confirmation. Neither list changes purchase eligibility in `ranked`. Use `--sort totalBeforeDelivery` to sort captured package prices without requiring nutrition or freight; use `--sort totalAfterDelivery` only where a matching freight quote exists. Invalidated price/quote sources are excluded until reloaded. Each observation retains its original timestamp.

Public Vietnam shipping estimates can be collected without signing in:

```bash
node bin/lazada-search.js delivery LAZADA_URL --province "Khánh Hòa" --locality "Phường Nha Trang"
node bin/lazada-search.js compare --sort costPerGramAfterDelivery
node bin/lazada-search.js compare --category chocolate-ice-cream --sort costPerMlBeforeDelivery
```

Delivery captures preserve the selected SKU, exact locality, original HTML and
screenshot. Successful estimates and failed attempts are cached for six hours;
`--refresh` explicitly retries. A public product-page estimate is recorded with
`shippingQuantity: 1`. It does not establish freight for a bulk order. A
confirmed bulk quote should specify `shippingQuantity` for that quantity.
An explicit `--shipping` override remains an order-cost scenario. Phường Nha
Trang is the default representative locality, not a claim about the buyer's
exact address. A page that cannot deliver there is recorded as unavailable
for that destination.

Eligible offers require an exact official manufacturer match with sourced net mass, protein, sugar, fat, saturated fat, energy and ingredients; they also require a confirmed variant, a fresh price and known shipping. Frozen delivery requires explicit confirmation. Unknown nutrition, volume-only labels, mixed nutrition columns, ambiguous variants, stale offers, unavailable stock, unreviewed OCR and manufacturer conflicts remain visible in `excluded`. A declared delivery-area filter requires a quote for exactly that area. `--shipping` is an explicit what-if override; `--no-require-shipping` produces a merchandise-cost comparison. These assumptions are returned with the result.

Ingredients identify isolate, concentrate, hydrolyzed whey or blends; a title's marketing claim alone does not identify the protein type. Label flags indicate milk, soy, added sugar, sweeteners and palm oil. Missing ingredient data stays unknown. Flags are descriptions, not medical judgments or a synthetic health score.

```bash
node bin/lazada-search.js inspect product
node bin/lazada-search.js inspect evidence EVIDENCE_ID
node bin/lazada-search.js inspect ocr OCR_ID
node bin/lazada-search.js verify PRODUCT_ID https://official-manufacturer.example/exact-product
node bin/lazada-search.js review PRODUCT_ID proteinPer100g 80 EVIDENCE_ID
node bin/lazada-search.js quote OFFER_ID '{"shipping":30000,"deliveryArea":"Nha Trang","variantConfirmed":true}'
node bin/lazada-search.js quote ICE_CREAM_OFFER_ID '{"shipping":30000,"deliveryArea":"Nha Trang","coldChainConfirmed":true}'
node bin/lazada-search.js compare --category whey --protein-type isolate --min-protein 75 --max-sugar 5 --quantity 10
```

Manufacturer URLs are explicitly supplied by the operator. Verification matches exact GTIN, or brand plus manufacturer SKU; similar names alone never establish identity. Unmatched sources and contradictions are retained. Exact manufacturer evidence takes priority over listing values and preserves conflicting original claims in a correction ledger. OCR still requires review. Official-domain discovery candidates do not establish exact identity. Refreshing changed page evidence invalidates previous field reviews. Reusing the same cached page preserves a shipping quote; a new price snapshot expires it.

Use `import FILE.json`, `import FILE.yml` or `import FILE.lino` for reviewed data. Imports retain the original source bytes and rebuild the affected working-store `.lino` and binary records. See [the fixture schema](tests/fixtures/products.json); those records are explicitly fictional test data. Imports validate nutrition bounds, currencies, timestamps and product references before writing records. `inspect offer-history` exposes past price/quote snapshots. See the [case archive workflow](data/cases/vietnam-nha-trang/README.md) for refresh, correction, export and offline verification.

[Real public cache fixtures](tests/fixtures/public-cache/README.md) also include
four historical product captures, two original nutrition labels, bilingual OCR
results, Nha Trang delivery evidence, `.lino` records and binary `.links`
projections. The offline replay test asserts zero browser starts and downloads.

## Library

```javascript
import { AssociativeStore, LazadaSearch } from 'lazada-search';

const app = new LazadaSearch({
  store: new AssociativeStore({ directory: '.lazada-search' }),
  market: 'vn',
  deliveryArea: 'Nha Trang',
});
try {
  await app.crawl({ maxPages: 5, maxProducts: 100 });
  const result = await app.compare({ category: 'whey', quantity: 10 });
  console.log(result.ranked, result.excluded, result.bestByCategory);
} finally {
  await app.close();
}
```

The public package includes TypeScript declarations, collector/cache/OCR adapters, nutrition parsing, comparison functions, the associative store, native store adapter, session import and Telegram/HTTP factories. Importing the package never opens a browser or sends messages.

## Associative storage

The design follows [Formal AI's associative technology stack](https://github.com/link-assistant/formal-ai/blob/main/docs/associative-tech-stack.md). `links-notation`, `lino-objects-codec` and `lino-arguments` are direct dependencies. Records use readable object `.lino` files, content-addressed blobs and addressable doublets `(record, (field, typed value))`, with explicit product/evidence/cache/OCR relationships. Equal pairs and atoms share addresses in the exported network.

The built-in `LZLINK01` binary projection provides source/target queries, inverse links and digest-checked recovery from canonical `.lino` records. It is an application format. The optional `NativeLinkStore` adapter also creates actual **binary links-notation archives** through Rust link-cli's `--export-binary`. Each archive is imported into a fresh store and every link is compared before the shard becomes active. Numeric link addresses avoid expensive native name lookups; each shard's `atoms.lino` maps atom addresses to their full typed labels. Both graph and dictionary determine the content address. Keep the whole shard when copying it. Unchanged verified shards are reused; corruption rebuilds the shard.

```bash
cargo install link-cli --version 1.0.0 --locked
node bin/lazada-search.js mirror --clink-command /path/to/clink
node bin/lazada-search.js export --format lino > products-network.lino
node bin/lazada-search.js export --format links > products-network.links
```

Native shards live under `.lazada-search/.native/`; `data.links` is the binary archive and `store.db` is link-cli's working database. Rust link-cli 1.0.0 persists its working database as text, so the adapter explicitly creates and verifies the binary archive. Open `store.db` with `clink --db`, or restore `data.links` using `clink --db fresh.db --import-binary data.links`. The regular `export` command's `.links` output uses `LZLINK01`. Every application record commits via fsync and atomic rename under a process-shared writer lock. Binary projections can be rebuilt after interrupted writes. Blobs deduplicate by SHA-256. No background pruning deletes label evidence. Copy the whole private data directory for backup, excluding browser profiles and `.session-cache` when only research evidence is needed. Dependency reports and workarounds are recorded in [docs/upstream-issues.md](docs/upstream-issues.md).

## Telegram

```bash
export TELEGRAM_BOT_TOKEN='your-BotFather-token'
export TELEGRAM_ALLOWED_USER_IDS='your-numeric-user-id'
node bin/lazada-search.js bot
```

Private-chat commands: `/crawl`, `/collect URL`, `/compare`, `/inspect KIND ID`, `/verify ID URL`, `/review ID FIELD VALUE EVIDENCE_ID`, `/quote OFFER_ID JSON`, `/help`. Options match the CLI. Quote whitespace-bearing strings with single quotes, including JSON objects. The bot requires an explicit allowlist, ignores other users and group chats, serializes work and uses plain-text replies. No production messages are sent by the test suite.

## Coverage and acceptance

A crawl is a bounded search, not proof that every Lazada SKU has been enumerated. Default search queries include whey, isolate, and English/Vietnamese chocolate ice cream. Reports preserve searched pages, found products, failures, cache counts, limits and uncollected URLs. `complete` stays false because inventory, personalization and lazy-loading can hide products. Page and image limits are explicit; all original page evidence and unparsed fields are retained. Repeating a crawl reuses visited search pages, prioritizes unseen product URLs across the queries, and advances through cached results before requesting new search pages.

```bash
npm test
npm run test:e2e
# Include a real native link-cli check:
LAZADA_TEST_CLINK=/path/to/clink npm run test:e2e
# Optional installed Chromium override for CI/local test browsers:
LAZADA_TEST_BROWSER_EXECUTABLE=/path/to/chromium npm run test:e2e
# Small public-page acceptance; requires a priced product in both categories:
npm run test:live
npm run check
```

Deterministic E2E tests use real Chromium through Browser Commander, real Tesseract, persisted graph recovery, spawned CLI commands, a local Telegram Bot API fixture and a browser-driven calculator. Live Lazada results and account access are a separate acceptance check. See [architecture and evidence rules](docs/architecture.md).

## Universal app example

The React example imports the same pure comparison functions and accepts reviewed product/offer JSON. It retains the template's web, Electron and Capacitor build paths. Auto-regenerated preview screenshots use `npm run example:web:preview-images`; they are separate from live shopping evidence. `npm run example:web:build` builds the example. The local `serve` calculator is the primary interface to the collected database.

## Contributing

Keep calculations deterministic, preserve ambiguous source claims, and add meaningful fixtures when parser behavior changes. Use `npm test`, `npm run test:e2e` and `npm run check`. The inherited Changesets release pipeline remains in place; package identity is now `lazada-search`. See [contributing](docs/CONTRIBUTING.md).

## License

[Unlicense](LICENSE).

## Catalog coverage and Markdown export

`crawl --exhaustive` follows observed public pagination without page/product caps, retains every discovered candidate, inventories all public SKU combinations and stops on security challenges. Each SKU needs its own confirmed price. `audit --strict` fails while catalog completeness remains unproven; public search cannot certify a whole-market inventory.

Generate the repository tables with `node scripts/export-catalog-tables.mjs --offline`. Reprocess cached listings and OCR with `node scripts/audit-cached-catalog.mjs --offline`. `node scripts/collect-manufacturer-sources.mjs` follows the official-domain registry, retains unmatched source evidence and reuses cached pages, images and OCR. The [coverage table](docs/tables/README.md) lists every outstanding gap. Telegram supports `/audit --strict` and splits full comparisons across messages without a ten-row limit.

The committed [catalog snapshot](docs/tables/catalog.json) includes products, offers, discoveries, public SKU inventories and crawl reports. Import it into a fresh cache with `node bin/lazada-search.js import docs/tables/catalog.json --offline`. It reproduces the same explicit coverage gaps and provisional calculations without website requests. Original private browser state is not part of the published snapshot.
