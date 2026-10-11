# Current primary-source follow-up

This bounded internet pass covers Happy Belgian Chocolate 125/475 ml and Lotte Fanfare chocolate 175 ml. Four targeted queries and four distinct new URLs produced two original HTML responses with HTTP 200, company/contact corroboration, and no exact current mass, nutrition or ingredient approval. [Structured review](review.json) preserves all three selected SKUs and existing quantities.

Happy Durian appears in the [Vietnamese trade association’s 2023 exhibitor list](https://hvnclc.vn/33-dn-cung-hoi-dn-hvnclc-tham-du-thaifex-anuga-2023/). This supports the company’s gelato business only. A [barcode-owner search lead](https://icheck.vn/san-pham/kem-bo-sau-rieng-125ml-8938530482206) identifies tax ID 0315603499 and phone 0858993939 at 169/1/19 Lương Định Của, Thủ Đức; it relates to avocado/durian 125 ml rather than Belgian Chocolate. The historical 2021 lab customer address differs. Neither supports the current chocolate formula or ownership of a currently readable manufacturer site. Existing Happy DNS/TLS/Facebook negative receipts were reused without retry.

The [official Lotte ice cream index](https://www.lottewellfood.com/brand/product?searchType1=LC700) lists Fanfare and has a manufacturer product inquiry form at `/contact-us`, requiring country, brand, name, email and content. No message was sent and the POST action was not called. The page exposes no exact 175 ml export back label, grams or nutrition. The existing 175 ml/170 ml conflict for GTIN 8801118251313 remains.

| Selected SKU                 | Exact remaining source evidence                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1880785864_VNAMZ-8527716006  | Current Belgian Chocolate 125 ml front/back with grams, full nutrition and serving basis, ingredients/allergens, manufacturer, GTIN and formula/market revision. |
| 1880785864_VNAMZ-8527716007  | Its own current 475 ml front/back and specification; the 125 ml package and 2021 sample cannot supply its mass or protein.                                       |
| 3047790409_VNAMZ-14661118301 | Current export chocolate label for GTIN 8801118251313 resolving printed 170/175 ml volume, plus declared grams, nutrition basis and ingredients.                 |

The committed HTML files are safe public derivatives. Raw original response bytes and headers remain private; their SHA-256 and byte lengths remain in [public-source-provenance.json](public-source-provenance.json). Publication removes executable scripts, account controls, hidden controls and embedded access tokens. Raw headers, including Lotte's session cookie, are omitted. The company, Fanfare and contact-form excerpts are checked against the derivatives before import. Selected web excerpts are explicitly marked and never represented as original HTML.

Initial sandbox DNS and Python trust chain errors are client transport failures, not manufacturer outage evidence. System curl retrieved both pages with default TLS verification enabled. Failure receipts are retained. No challenge was encountered or bypassed, and requests to the manufacturer host were separated by at least 60 seconds.

Offline replay validates every artifact before importing only public source artifacts and the review into the associative store:

```sh
node scripts/archive-ice-current-primary-followup.mjs --offline --no-ocr
```

Replay makes zero website requests, OCR invocations, outreach messages or product/offer changes. [Replay receipt](archive-replay.json) identifies the imported evidence. Density, historical samples, other flavours and unmatched package revisions cannot supply missing facts. A company contact lead is not manufacturer nutrition approval.
