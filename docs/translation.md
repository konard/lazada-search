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
