Vietnamese-to-English translation is a presentation layer. Original Unicode strings, source-byte SHA-256 digests and evidence associations remain stored. Translation results never update authoritative ingredients, nutrition, SKU identity, prices or comparison denominators.

The default makes no translation requests. `translate` and `translate-product` return `status: "pending"` until a provider is configured, or replay a matching successful cached translation. Full-catalog translation acceptance remains incomplete until a real provider is configured and every required text has a successful reviewed translation. The committed fixture contains human-written test pairs and does not establish live translation accuracy.

Library users can supply `{ id, version, translate(input), endpoint? }` through `LazadaSearch({ translationProvider })`. The adapter returns a nonempty translated string; errors and invalid responses remain pending. A function adapter requires explicit `translationProviderId` and `translationProviderVersion`. Use `endpoint` for the actual upstream URL so the shared per-domain scheduler can pace requests; adapters without an endpoint are paced under their provider identity. Adapters must honor the provided stop hook for upstream challenges and must not save credentials themselves.

```js
const app = new LazadaSearch({
  store,
  translationProvider: {
    id: 'my-reviewed-provider',
    version: 'model-2026-10',
    translate: async ({ originalText, sourceLanguage, targetLanguage }) =>
      myTranslationLibrary.translate(
        originalText,
        sourceLanguage,
        targetLanguage
      ),
  },
});
const presentation = await app.translate('Kem sô cô la 40 g', {
  sourceEvidenceId: 'original-page-evidence',
  sourceEvidenceHash: originalPageSha256,
});
```

An explicitly configured HTTP adapter sends JSON `{ "text": "...", "sourceLanguage": "vi", "targetLanguage": "en" }` and requires JSON `{ "translatedText": "..." }`. Its endpoint must have no URL credentials or query parameters. Optional bearer credentials are read at request time from an environment variable and are never stored in translation records. Redirects are rejected. Timeouts and response-size limits apply. HTTP 403/429 persist a collection stop; new requests stay stopped until the operator resolves the challenge and resumes collection. Existing valid translations can still replay while stopped.

```sh
lazada-search translate 'Kem sô cô la 40 g' \
  --translation-provider my-provider --translation-version model-2026-10 \
  --translation-endpoint https://my-translation-service.example/translate \
  --translation-token-env LAZADA_TRANSLATION_TOKEN
lazada-search translate-product PRODUCT_ID --source-language vi --target-language en
lazada-search translate 'Kem sô cô la 40 g' --offline \
  --translation-provider my-provider --translation-version model-2026-10
```

Telegram supports `/translate "Vietnamese text"` and `/translate_product PRODUCT_ID`. Configure the bot process provider through CLI options or `LAZADA_TRANSLATION_PROVIDER`, `LAZADA_TRANSLATION_VERSION` and `LAZADA_TRANSLATION_ENDPOINT`; credentials stay in their runtime environment variable. Telegram users cannot select an endpoint or credential source for the running application's provider.

Cache identity includes the exact UTF-8 source digest, language pair and provider ID/version. Repeated successful text translations need no provider calls; new bytes or provider versions receive new identities. `--refresh` regenerates the selected result. A failed refresh marks it pending rather than presenting old text as a new successful translation. Offline replay requires the same provider identity/version but no endpoint or credentials. `translate-product` covers the cached title, description and ingredient strings, retaining their product/evidence links; its `complete` flag applies to those fields only.

Every new result and cache replay runs deterministic source-bound quality checks. Numbers, quantity units, nutrition numerator/basis, registered product-brand terms and detected SKU/GTIN/URL/code strings must remain intact. Vietnamese decimal commas and English decimal points, ordinary thousands separators and supported unit names are normalized for comparison; units are never converted to different physical units or inferred from density. Supported negative sugar/flavour/accessory/delivery/stock conditions must retain their negative meaning. Ambiguous notation, unsupported word-number conversions and legitimate paraphrases outside the narrow checks can stay pending rather than receive automatic approval.

An unsuitable result has `status: "pending"`, `reason: "translation-quality-failed"`, failed `qualityChecks` and an explicitly unapproved `candidateText`. It has no usable `translatedText`. Previously cached text is checked again with the current checker fingerprint; unsuitable legacy text cannot replay. Safe legacy text needs a current human review. Automatic checks do not prove fluent English, correct ingredient terminology or complete semantic equivalence.

Human review binds the exact original and translated SHA-256 digests, configured provider identity/version and checker fingerprint. A reviewer cannot approve failed quantity/entity checks. Refresh replaces the review with pending metadata even when the provider returns identical text. Changed source bytes, translated bytes or checker code require a new review. An explicitly rejected result cannot be presented as reviewed English.

```js
const result = await app.translate('Merino kem sô cô la 40 g', {
  protectedEntities: ['Merino'],
});
// Invoke only after checking this exact source and English result.
await app.translator.review(result.id, {
  sourceSha256: result.sourceSha256,
  translatedSha256: result.translatedSha256,
  reviewer: 'operator-name',
  decision: 'approved', // or 'rejected'
});
```

`applyComparisonTranslations(report, translator)` reads cached translations without invoking a provider and returns copied rows with `product.presentation`. Original title, description, ingredient positions, variants, nutrition, prices, source evidence and comparison metrics remain unchanged. By default only currently reviewed text is shown in English; pending text retains its original Vietnamese. Telegram comparisons and the local web calculator consume the presentation metadata and keep source text visible. The explicit `{ requireReviewed: false }` option is an unreviewed preview for library callers; it is not the default buying view and is not an acceptance claim.

Reviewed catalog chunks can supply that same field presentation when no reviewed whole-field result is cached. Reassembly binds the current record kind/ID, exact field path and complete original UTF-8 digest. Source chunks must start at index/offset zero, remain contiguous in their original UTF-16 offsets, have correct individual digests and cover the exact current string. New plans preserve separate partition identities/counts when chunk boundaries change; complete unambiguous legacy groups remain readable. Every chunk must have a current human review matching the configured provider/version, language pair, translated digest and checker fingerprint. Combined text is checked again against whole-field numbers, units, nutrition bases and entities, so independent chunk approval cannot conceal a changed number at a boundary.

No translation or review is generated during reassembly. `chunkProof` retains the source record/path, whole-source digest, partition digest, ordered offsets, source/translation IDs and digests, reviewer/timestamps and combined quality result. Its review basis is `reviewed-chunks`; automatic whole-field checks do not prove fluency or semantic equivalence across boundaries. Missing, rejected, altered, overlapping or incomplete parts retain the original text. Fields and assembled output over1MiB, or partitions over256 chunks, keep the safe original fallback rather than a partial English sentence.

Planned commercial offer fields use `offer.presentation.commercialText`, an array of `{ path, presentation }`, with convenience properties for single-string seller, shipping text, promotion text and conditions. Only exact current fields enumerated by the catalog plan can use cached English. These observations remain presentation only and do not establish voucher eligibility or change prices, discounts or delivery metrics. Telegram comparison text retains originals beside reviewed seller/promotion/shipping/condition wording; the web seller display uses the same cached source-bound overlay. Private `shippingDestination`, address, phone/email and credential fields remain blocked from provider planning and commercial overlays.

`translate-catalog` plans the human text already cached in products, offers, discovery lists, SKU inventories, page evidence and OCR. Public cached HTML is parsed offline after scripts, hidden fields and account sections are removed. Private page bodies, credentials and OCR word fragments are excluded. Each source field retains its original UTF-8 digest, evidence links and exact Unicode; bounded chunks also retain the whole-field digest and offsets. Original HTML and image hashes are checked without downloading missing sources. Missing evidence stays an explicit gap.

A batch defaults to cache-only even when a provider is configured. Each run is bounded, persists a job and resumes remaining fields before retrying failed fields. Identical successful text reuses the provider/version cache across products. A changed field creates a new source identity; its old source and translation remain available. Refresh regenerates current text in resumable batches. The library returns counts of translated, pending and unprocessed chunks, source gaps and the last run's provider calls/cache hits.

```js
const checkpoint = await app.translateCatalog({
  cacheOnly: true,
  limit: 100,
  productIds: ['PRODUCT_ID'], // omit to enumerate the current cached catalog
});
const resumed = await app.translateCatalog({
  cacheOnly: false, // explicitly use the configured, paced provider
  limit: 100,
  productIds: ['PRODUCT_ID'],
});
const status = await app.translationStatus({ jobId: resumed.id });
```

```sh
lazada-search translate-catalog --translation-limit 100
lazada-search translate-catalog --translation-download --translation-limit 100 \
  --translation-provider my-provider --translation-version model-2026-10 \
  --translation-endpoint https://my-translation-service.example/translate
lazada-search translation-status JOB_ID
lazada-search translate-catalog --offline \
  --translation-provider my-provider --translation-version model-2026-10
```

Telegram exposes `/translate_catalog`, `/translation_status JOB_ID` and `/operation JSON`. The local HTTP server accepts JSON `POST /api/translation-catalog` and serves `GET /api/translation-status?jobId=JOB_ID`. For example, a batch payload is `{ "cacheOnly": true, "limit": 100 }`. Mutation routes require a local host, the same browser origin and a JSON body at most 1 MiB. HTTP and Telegram structured operations use the same library validation gates:

```json
{
  "operation": "translate-catalog",
  "options": { "cacheOnly": true, "limit": 100 }
}
```

`POST /api/operations` and Telegram `/operation` also accept discovery, crawling, collection status/resume, auditing, delivery, comparisons, inspection, source imports, reviewed facts, category/manufacturer reviews, quotes and invalidation. Source imports preserve their original JSON bytes. Structured source imports/reviews accept data directly and cannot read files from the server. Manufacturer research accepts `{ "operation": "manufacturer-research", "input": { "plan": {} } }`; CLI uses `manufacturer-research PLAN.json`. Research remains an unapproved draft, and callers cannot replace the application's trusted manufacturer registry. Operator filesystem administration and login commands remain CLI operations.

A batch's `complete` flag proves only that its enumerated cached text has successful checked translations and no detected missing evidence. `counts.reviewed`, `counts.reviewPending` and `reviewedComplete` separately report current source-bound reviews; rerun a cache-only batch after recording reviews to refresh its persisted checkpoint. `catalogInventoryComplete` remains false: translating a bounded cache cannot prove all marketplace listings were collected. Full English acceptance still requires an actual configured provider, complete source/product discovery and quality review of every required translation. No live translation provider is configured or paid calls made by the committed offline/E2E tests.

Exact basket comparisons apply the same reviewed cache to every nested product and offer line. Library, CLI, HTTP and Telegram share this overlay; basket quotes and their destination fields remain outside translation planning. Offline interface E2E fixtures verify reviewed titles/sellers beside the original Vietnamese and unchanged checkout arithmetic.
