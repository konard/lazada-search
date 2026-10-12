# Manufacturer and label automation draft

This implementation is a code draft requested after the dual-unit checkpoint. It has not been imported, executed, tested, or used to fetch sources. The existing CAPTCHA stop remains unchanged. Historical catalog prices, delivery gaps, manufacturer gaps, and report acceptance receipts are not made current by this draft.

The new modules compose the existing `ManufacturerResearch`, `ManufacturerSourceCache`, `EvidenceCache`, catalog review projection, identity validator and model-bound local Tesseract OCR APIs. They do not replace the trusted manufacturer registry or the existing review validators.

## Exported contracts

`buildLabelWorklist(application, options)` returns the real catalog's unresolved package, manufacturer identity and label nutrition work. The default scope is whey powder with chocolate or unflavoured selected options and strictly chocolate ice cream. Soy powder, shaker selections and other flavours are outside this worklist. Every ice-cream item independently requests missing grams and missing millilitres. The worklist explicitly refuses density conversions and does not mark market coverage complete.

`planManufacturerWorkflow(application, options)` persists a finite task graph. Options include `productIds`, `categories`, `id`, `maxProducts`, `maxSourcesPerProduct`, `maxLabelsPerPage`, `maxTotalTasks`, `maxAttempts` and `retryFailed`. Defaults are 50,000 products, eight manufacturer sources per product, twelve label originals per page, 10,000 tasks and three attempts. Budgets are recorded as blockers rather than represented as complete collection.

`runManufacturerWorkflow(application, id, options)` executes at most `maxTasks` tasks, default 25. Network access defaults to false. Online execution additionally requires `allowNetwork: true`, an online application cache and no active global CAPTCHA stop. Cached original evidence and local OCR can be prepared while collection is stopped. Source cache misses remain blockers in offline mode. `retryBlocked: true` requests bounded retries after recorded backoff. `recoverInterrupted: true` moves a previous single worker's interrupted tasks to blocked state; explicit retry is still required. These options never clear the CAPTCHA stop.

`manufacturerWorkflowStatus(application, id?)` returns the saved task graphs, task counts and the actual collection stop. It reports `draftCodeValidated: false` and `marketCompletenessGuaranteed: false`.

## Source reuse and discovery

The plan fingerprints the selected product, SKU, capture date, option texts and attached source identifiers. Private offer prices remain independent; correctly collected shared source bytes are read through the existing store fallback and repository archive. GET and POST manufacturer originals are reused directly by digest, including endpoints whose request bodies must not be reconstructed from a body digest. Captured listing HTML, screenshots and product-label images are also reusable without downloading them again.

Official registry roots provide an initial source graph. An optional provider can discover exact official pages:

```js
const searchProvider = {
  origin: 'https://your-configured-search-provider.example',
  search: async ({ queries, domains, identity, maxResults, signal }) => {
    // Return public source candidate objects such as { url }.
    // The provider implementation must obey maxResults and AbortSignal.
    return yourConfiguredSearch(queries, { domains, maxResults, signal });
  },
};
```

This is an injection contract, not a bundled or configured search service. There is no registry override through a plan. The existing domain scheduler paces provider calls and source requests. Search responses are cached as content-addressed JSON under the exact query and domain fingerprint. Only configured official domains become source requests; rejected URLs are recorded by digest. The real manufacturer source cache validates published label URLs and registered asset hosts, preserves redirects and originals, and detects challenges. The workflow additionally binds each label to its original parent publication digest.

`createManufacturerSearchProvider(application, configuration)` in `src/manufacturer-workflow-search.js` supplies a concrete JSON HTTP search adapter for the same workflow. The operator supplies its serializable configuration through trusted local CLI/library configuration or application startup. HTTP and Telegram workflow requests reuse the configured application provider; they cannot choose token-environment names or new credential destinations. An example configuration is:

```json
{
  "id": "configured-manufacturer-search",
  "version": "1",
  "origin": "https://your-configured-search-provider.example",
  "endpoint": "https://your-configured-search-provider.example/v1/search",
  "tokenEnv": "MANUFACTURER_SEARCH_TOKEN",
  "tokenHeader": "Authorization",
  "tokenPrefix": "Bearer ",
  "rowsPath": "/results",
  "urlPath": "/url",
  "titlePath": "/title",
  "queriesField": "queries",
  "domainsField": "domains",
  "limitField": "maxResults",
  "cacheOnly": true,
  "intervalMs": 60000
}
```

This adapter is implemented as draft code; the example is not an installed provider or an executed request. It requires a same-origin public HTTPS endpoint, sends a bounded JSON POST body and reads results with safe JSON pointers. It rejects plaintext credentials, registry overrides, endpoint credentials, query credentials and redirects. Authentication values are read from the named environment variable only while issuing a request; headers and raw credential-bearing responses are never written to a definition. Response candidates echoing the token are excluded. Successful public candidate URLs are still checked against the trusted manufacturer registry by the runner.

The adapter enforces at least 60 seconds between requests to its provider origin, even if the application's general scheduler has a shorter interval. It checks the persistent global stop before every request and records detected provider challenges as a collection stop. Defaults bound the request to 32 KiB, response to 2 MiB, timeout to 30 seconds and results to 100; configurable maxima are 128 KiB, 8 MiB, 60 seconds and 500 results. Optional `cacheOnly: true` returns exact cached responses through the workflow cache or produces an explicit cache-miss blocker without a request. The runner's cache fingerprint includes provider ID, version, configuration digest, exact query and domain restrictions. Changing only `cacheOnly` preserves reuse of previously collected responses.

Failed originals keep their retry dates. Invalidated source originals require recollection, never silent reuse. Changing or invalidating a publication removes its authority to support the corresponding label task. Changed selected SKUs supersede their old tasks and require a new plan. A changed invalidation fingerprint or explicit `retryFailed` creates refreshed planning work.

## OCR and candidates

Raw original bytes and OCR TSV bytes must match their stored SHA-256 references. An OCR transcription must be identical to the original TSV transcription and must bind to its original image. Default local OCR passes use page segmentation modes 6 and 11; at most eight explicitly supplied passes are supported. Existing transformed-image and OCR/model caches perform their own provenance validation.

The default extractor proposes explicit net grams and millilitres, unambiguous nutrition rows with a stated per-100-g, per-100-ml or per-package basis, and original ingredient list text. It does not derive food grams from volume, use shipping weight as food weight, multiply a carton twice, transfer a different flavour's nutrition or establish a product's formula from a family page. Ambiguous columns, incomplete ingredient lists and zero values remain flagged candidates. Manufacturer endpoints reporting zero placeholder nutrients cannot silently create an approved specification.

An optional local `factExtractor({ text, source, ocr, identity, productId })` can return `{ candidates, identity }` for additional structured manufacturer formats. It receives original text and source references. Every returned excerpt and supported unit is checked before saving a candidate. This callback is a configured local extraction adapter; it must not perform hidden network requests or approve facts. The existing exact identity validator still reports missing or conflicting brand, product, selected flavour, market, package, identifier and current formula evidence.

The default structured JSON adapter also recognizes an explicitly published `identity` or `productIdentity` object, `quantities` and `nutrition`. It requires literal brand, name, flavour, market, package type, identifier, formula revision and `currentFormula: true`; absent revision/currentness yields no structured facts. Quantities require their explicit unit and one-inner-package basis, and nutrition requires its original label excerpt and basis. These candidates still require separate human review. No generic family page or numerical endpoint becomes exact by filling identity defaults.

## Separate approval boundaries

The graph creates separate quantity and nutrition review tasks. A reviewed weight cannot become approval of ingredients, protein content, factory identity or delivery availability. Proposed quantities refer to one inner food package; selling-unit multiplication remains in the established comparison code.

Each `manufacturer-review-draft` records the current listing originals, source-bound candidate IDs, exact identity gaps, placeholder warnings, unsupported-source blockers and its target review API. Quantity drafts target `reviewPackageQuantities`; factory nutrition drafts target `reviewManufacturerResearch`. Marketplace nutrition remains withheld until cross-checked against an exact primary manufacturer label. The workflow does not call either approval API automatically, populate reviewer names, fabricate identifier matches or write candidate facts into products. Existing manufacturer reconciliation remains the path for approved corrections.

## Explicit review bridge

`prepareManufacturerWorkflowReview(application, { workflowId, reviewDraftId })` returns an original-bound review packet template and missing human inputs. `reviewManufacturerWorkflow(application, packet)` is the separate human approval step. The packet includes `reviewedBy`, `reason`, unchanged `productFingerprint`, exact `listingEvidenceId`/`listingSha256`, reviewed listing/manufacturer/source identities and explicit `candidateIds`. A source-date freshness window defaults to seven days and is bounded to one year. Zero facts require explicit `confirmedZeroValueCandidateIds`; they are never auto-approved. Quantity and nutrition drafts retain separate approval boundaries.

For a nutrition review, optional `factoryQuantityCandidateIds` explicitly selects at most two primary grams/ml candidates from this same workflow. This allows verified manufacturer package facts to accompany reviewed nutrition and satisfy the catalog's manufacturer quantity requirements; it never upgrades a seller-only quantity. The bridge validates source identities, original bytes, current revision, selected package, label publication and listing associations before applying the existing research-review, package-review and manufacturer reconciliation APIs. It rejects changed or invalidated sources by URL, evidence ID or cache ID. Search-cache identity includes the result bound, so a narrow cached query cannot silently satisfy a broader one.

All packet validation runs against a staged store view before source attachment writes. The approved product projection is written after review/source records; existing prices and offer originals are preserved. Factory evidence attachments refer to unchanged stored original bytes and respect private source visibility. The workflow records its own authorized attachment transition so subsequent reviews do not mistake newly attached approved originals for a different selected capture. No attachment, saved candidate or prepared packet itself grants approval.

Immediately before publishing the staged writes, and again before writing the product projection, the bridge rereads the current raw product, review packet, candidates, original listing, source bytes, OCR proofs and invalidations. A changed capture or source withdraws the review. The existing chronological `putLatest` product API also retains a newer capture that arrives after the final read. The unrun regressions inject both late captures and source invalidations during asynchronous validation and exercise the chronological writer's refusal to replace a newer product.

`tests/manufacturer-workflow-draft.test.js` contains meaningful but **unrun** candidate, source-invalidation, review rejection/application, original attachment, preserved-price, cached-only provider and result-bound cache regressions. Their existence is draft test coverage, not successful execution or live acceptance.

The shared `verifyOriginalBoundOcr` draft verifier in `src/ocr-evidence.js` is now used by both workflow extraction and manufacturer research approval. It validates the actual stored OCR record, original/derived image digests and byte lengths, the persisted transform record and deterministic transform ID, renderer/recipe, bounds, original source OCR/TSV binding, transcription/confidence/word geometry and declared native-model fingerprints. It keeps the derived physical image hash distinct from the original image hash. Merely setting `originalImageHash` cannot authorize an unrelated crop. The unrun tests include a preserved-transform fixture and rejection controls for missing transforms, changed recipes, corrupted derived bytes, changed TSV, model fingerprints and original OCR provenance. Actual renderer/native/interface acceptance is still deferred.

## Durable records and remaining acceptance work

Records use the existing links-notation and associative store:

| Kind                          | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `label-worklist`              | Actual catalog gaps and original evidence references              |
| `manufacturer-workflow`       | Finite resumable tasks, bounds, blockers and per-run cache counts |
| `manufacturer-research`       | Existing source capture and challenge receipts                    |
| `manufacturer-source`         | Existing cached original HTML, JSON and label sources             |
| `ocr`                         | Existing model-bound original TSV and transcriptions              |
| `manufacturer-fact-candidate` | Source-bound proposals that are never approved product fields     |
| `manufacturer-review-draft`   | Independent quantity and nutrition review work                    |

These record kinds can be archived by the existing repository archive. A plan does not create new collected marketplace prices, shipping quotes, manufacturer labels or a full top ten. Subsequent authorized execution must preserve and export actual originals before reporting progress.

The runner requires one worker per persisted workflow. It prevents concurrent runs in the same process; a distributed multi-process lease is not implemented. This restriction is explicit in every plan. After this drafting stage, acceptance must cover every task type across library, CLI, HTTP and Telegram; interrupted runs; shared public/private originals; source corruption and invalidation; CAPTCHA stops; source budgets; flavour and identifier conflicts; OCR transforms; zero placeholder facts; and actual manufacturer corrections. No acceptance evidence is claimed for these new drafts.
