# Exact chocolate evidence and remaining purchase checks

The cached Happy Gelato gallery includes a CASE laboratory report for **KEM CHOCOLATE BỈ**, submitted by **CÔNG TY TNHH TMDV HAPPY DURIAN**. The report number is **MMI2111.271022372**, received 27 November 2021 and issued 8 December 2021. Its original images were read manually after OCR; the sample description is a plastic container. The report's stated limitation confines its results to the tested sample.

| Measurement  | Tested sample, per 100 g | Original result                     |
| ------------ | -----------------------: | ----------------------------------- |
| Protein      |                   4.60 g | Nitrogen × 6.38, TCVN 8099-1:2015   |
| Fat          |                   4.80 g | TCVN 6688-2:2007 / ISO 8262-2:2005  |
| Carbohydrate |                   24.0 g | Food and Drug Administration method |
| Energy       |                 158 kcal | Food and Drug Administration method |

[Identity page](targeted-labels/c5801c68d08c5fe8c9c655c47f0877073b16b1729831f9336428190d3654bad9.webp), [analytical report first page](targeted-labels/8bf6231701201cd92ddaee3cf38887262c7b88d1333982a4562cae8e9e9a6e61.webp), and [nutrition results](targeted-labels/189a68860572709367700e60d87bf477806f54ad27565369bc60daefa92eb622.webp) retain the original cached image bytes. The [partial review](targeted-spec-review.json) records each reading, source hash, extraction correction and remaining identity requirement. These images came from the public marketplace gallery, with no new Lazada request.

The chocolate flavour matches the listing family, and front images show [125 ml](targeted-labels/ffec6f1c8b12f91819fd18e8f5c94505f948cd67674ceeee55762a8a14c3c774.webp) and [475 ml](targeted-labels/6583224988823985367b40e065aa6617fcbf984e30e3b2b5b9f0994d75a77ec2.webp) packages. The report provides no package weight, GTIN, current formulation, ingredients, sugar or saturated fat. It cannot establish grams of protein in either selling option. The review remains unapplied to shared products until current exact package identity and manufacturer authority are demonstrated.

The [gallery audit](targeted-gallery-audit.json) covers all 20 unique cached Merino/Happy Gelato gallery images at least 150 pixels wide or tall. The Merino images show chocolate-pack fronts, marketing and logos; no back label or nutrition table appears. Merino listing 1561301337's ingredient text says cantaloupe flavour despite its chocolate title, so it remains a source conflict requiring a label. Ingredients of the separate 68 g Merino Yeah model must not be transferred to this stated 40 g SKU.

The [manufacturer request cache](targeted-source-cache.json) records one attempt per additional candidate URL. HappyDurian's HTTPS endpoint and the legacy KidoFoods endpoint fail certificate validation with `CERT_HAS_EXPIRED`. [KIDO's corporate homepage](https://www.kdc.vn/) responds successfully but contains no exact 40 g Merino specification. Successful HTML bytes are cached alongside the failure outcomes; replay makes zero requests. HappyGelato's current site had already failed DNS resolution in [source-cache.json](source-cache.json).

No exact Merino or Happy Gelato selling option has a confirmed Nha Trang frozen-delivery service or bulk freight quote in the reviewed evidence. A manufacturer's general nationwide policy and a laboratory's Nha Trang address cannot establish a merchant's frozen delivery. [Kim Phúc's Merino 40 g page](https://kimphuc.net/kem-merino-socola-com-cacao-40g) explicitly limits its express ice-cream service to Ho Chi Minh City; that policy applies to this direct seller and cannot be assumed for other stores. Its ingredient text also contains the cantaloupe conflict.

A [2023 customer visit](https://www.lemon8-app.com/%40dangdine/7226751990599041538?region=vn) and [2025 directory entry](https://www.sluurpy.com/en/nha-trang/restaurant/8965964/kem-%C3%BD-happy-gelato-nha-trang) identify a Happy Gelato shop at 09 Hùng Vương, Nha Trang. They provide a local research lead; current operations, exact chocolate-tub stock, prices and delivery remain unverified. No merchant was contacted.

The [isolated associative archive](targeted-evidence-archive/manifest.json) stores the review, five original images and manufacturer-request outcomes as JSON, links notation and binary links. It is separate from shared product and purchase-ranking stores. Its offline replay validates original hashes, record round trips and binary image references.

```sh
node scripts/urgent-icecream-targeted-evidence.mjs
```

`--online` fetches only candidate URLs without an existing success or failure record, with 10-second intervals. The [new-category conflict follow-up](new-candidate-conflicts.md) adds two official manufacturer pages to the same cache and isolated archive; all five current targets have cached outcomes.
