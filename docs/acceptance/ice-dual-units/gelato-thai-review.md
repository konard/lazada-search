# Exact ice-cream units and nutrition review

Three selected SKUs were checked against cached original pages and images. Current manufacturer nutrition and exact net grams remain unverified; no density conversion is applied.

| Exact selected SKU          | Product                        | Declared volume | Exact factory grams                 | Current factory protein/nutrition | Finding                                           |
| --------------------------- | ------------------------------ | --------------: | ----------------------------------- | --------------------------------- | ------------------------------------------------- |
| 1880785864_VNAMZ-8527716006 | Happy Gelato Belgian chocolate |          125 ml | Unresolved                          | Unresolved                        | Current package back label absent                 |
| 1880785864_VNAMZ-8527716007 | Happy Gelato Belgian chocolate |          475 ml | Unresolved                          | Unresolved                        | Current package back label absent                 |
| 1561216831_VNAMZ-6599331044 | iBerri Thai chocolate          |        6,000 ml | Unresolved; seller declares 3,000 g | Unresolved                        | Seller description also gives 3–3.3 kg by flavour |

The [Chomthana manufacturer catalogue](https://www.chomthana.com/products/icecreams/) lists a generic Cremo confection tub as 6 L / 3 kg and offers a chocolate scoop flavour. It supplies no mapping to this exact iBerri export SKU, GTIN or formula. The generic mass stays in the conditional evidence matrix and is not applied. The four cached Thai images show an unlabelled tub, a flavour grid, a seller logo and a chocolate scoop; none contains a nutrition or manufacturer back label.

The [Thai certification authority indexed record](https://halal.co.th/en/product/detail/653003) identifies iBerri chocolate-flavoured ice cream made by Chomthana with certification through 19 July 2027. It gives no package size or barcode. Direct retrieval failed TLS validation, so the saved evidence is an explicitly labelled search-index snapshot, with no original-response hash claimed. This record cannot verify a selected SKU's weight or nutrition.

Happy Gelato's [existing laboratory review](../urgent-icecream/targeted-spec-review.json) concerns a chocolate sample received in November 2021 and reported in December 2021: protein 4.6 g, fat 4.8 g, carbohydrate 24 g and energy 158 kcal per 100 g. Those values apply only to that sample. They are not current SKU facts; carbohydrate is not a sugar measurement. Neither the report nor the cached package fronts establishes net grams for the 125 ml or 475 ml tubs.

The Happy Gelato official-domain DNS/TLS failures were reused from the existing cache. Current public web opens supplied no specification; the public Facebook response was a cached temporary-block page. No login or retry loop was attempted.

The [machine-readable review](gelato-thai-review.json) contains field provenance, original-artifact paths and SHA256 hashes, the conditional manufacturer matrix, non-applied historical nutrition and every direct source attempt. Future acquisition needs the current exact chocolate back labels, product identity/GTIN mapping, and separate Nha Trang frozen-service and quantity-specific freight evidence. Original marketplace HTML remains referenced in the existing archive; only a selective product extract is copied here, with no account state.

Validation: three selected SKUs, four cached Thai images, one newly cached manufacturer catalogue, zero Lazada requests, zero new OCR runs, zero density assumptions, zero shared-store/browser writes. All referenced local evidence hashes were checked.
