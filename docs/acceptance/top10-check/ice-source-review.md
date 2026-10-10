# Ice-cream source review

Reviewed 2026-10-10T16:30:30.365Z. Reparsed **10/10** exact cached SKU/price sources, verified source hashes and recalculated all available seller unit denominators without downloads. Seller claims are separate from manufacturer verification; frozen delivery and nutrition remain unverified.

The pre-correction original `g` and `ml` fields meant prices per unit, not physical quantities. This review separates physical quantities and unit prices. No grams-to-milliliters conversion was used.

| SKU                          | Price VND | Selected selling unit                                                              |    Total g |   Total ml |          VND/g |         VND/ml | Availability       |
| ---------------------------- | --------: | ---------------------------------------------------------------------------------- | ---------: | ---------: | -------------: | -------------: | ------------------ |
| 3039951845_VNAMZ-14623703963 |     39000 | Kem ốc quế choco Hàn Quốc Lotte Crispy Crunch Ice Cone Chocolate 160ml ABetterLife | Not stated |        160 | Not calculable |       243.7500 | Observed available |
| 1880785864_VNAMZ-8527716007  |    150000 | 475ml                                                                              | Not stated |        475 | Not calculable |       315.7895 | Observed available |
| 1880785864_VNAMZ-8527716006  |     45000 | 125ml                                                                              | Not stated |        125 | Not calculable |       360.0000 | Observed available |
| 367656830_VNAMZ-116917756014 |     39000 | COMBO 5 cây                                                                        |        200 | Not stated |       195.0000 | Not calculable | Observed available |
| 1561301337_VNAMZ-6599253417  |      8000 | 1 cây                                                                              |         40 | Not stated |       200.0000 | Not calculable | Observed available |
| 367656830_VNAMZ-610790405    |      8000 | 1 cây                                                                              |         40 | Not stated |       200.0000 | Not calculable | Observed available |
| 2978009544_VNAMZ-14350953081 |     27000 | Kem chai choco Power Cap Hàn Quốc Binggrae Pongta Chocolate 130ml ABetterLife      | Not stated |        130 | Not calculable |       207.6923 | Observed available |
| 3047790409_VNAMZ-14661118301 |     42000 | Kem lốc xoáy choco Lotte Hàn Quốc Fanfare Chocolate 175ml ABetterLife              | Not stated |        175 | Not calculable |       240.0000 | Observed available |
| 1561216831_VNAMZ-6599331044  |    539000 | (GIAO HỎA TỐC HCM) Kem ký Thái Lan vị socola hộp 6L (3Kg)                          |       3000 |       6000 |       179.6667 |        89.8333 | Observed available |
| 497264871_VNAMZ-15825435034  |     89000 | COMBO 5 cây                                                                        |        300 | Not stated |       296.6667 | Not calculable | Unavailable        |

The Merino 60 g cone is **COMBO 5**: 300 g per selected selling unit at 89,000 VND (296.6667 VND/g), but its captured option is unavailable. The Merino 40 g combo is 200 g; its 40-stick factory carton is not the selected five-stick purchase. Happy Gelato selected sizes are 125 ml (45,000 VND) and 475 ml (150,000 VND).

The Thai tub explicitly claims 6 L and 3 kg, while its description says 3–3.3 kg depending on flavour. Treat the mass claim as conditional; do not convert 6 L to grams.

The two historical captures were recovered through stored original HTML hashes and offer evidence references. Manufacturer formula, printed package verification, discounts and Nha Trang frozen shipping remain outside this bounded source audit.

Full source hashes, selected options, timestamps and arithmetic are in [ice-source-review.json](ice-source-review.json).
