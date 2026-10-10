# Korean chocolate ice cream source review

Exact SKU evidence is retained without any Lazada requests or shared-store changes. The original gallery images are copied unchanged from the existing associative cache. Manufacturer HTML, read-only endpoint responses and original images are cached beside this receipt, with SHA256 and request-body hashes in the JSON.

| Exact SKU                    | Volume | Protein per package | Energy per package | Authority and strict scope                                                                                              |
| ---------------------------- | ------ | ------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 2978009544_VNAMZ-14350953081 | 130 ml | 1 g                 | 135 kcal           | Volume: manufacturer; nutrition: seller promotional panel; chocolate variant, factory ingredients pending               |
| 3047790409_VNAMZ-14661118301 | 175 ml | not supplied        | not supplied       | Seller volume; official chocolate family image matches, export size and formula pending                                 |
| 3039951845_VNAMZ-14623703963 | 160 ml | 3.2 g               | 296 kcal           | Seller nutrition; **excluded** from strict nut-free scope because the World Cone chocolate depiction has peanut topping |

Binggrae's exact export PowerCap family57 maps Chocolate product774 to130ml variant796. The [manufacturer page](https://www.bing.co.kr/en/product/detail?PDT=57), variant metadata and original ChocoFlavorIceBar wrapper establish product identity and volume. Its official nutrition response is a placeholder: every amount is0, daily amounts are `-`, energy unit is empty, and the serving basis is0 with an empty unit. These values are rejected as missing nutrition, so manufacturer0g protein or0kcal must not enter rankings. The seller1g claim remains separately identified.

Fanfare's cached175ml chocolate nutrition image is an empty table. The [official Lotte product directory](https://www.lottewellfood.com/brand/product?searchType1=LC700) supplies a matching chocolate family image, but no175ml export specification or nutrition panel. No other flavor's values were transferred.

The seller alias “Crispy Crunch” depicts Lotte World Cone (월드콘) chocolate. Its cached cone and wrapper visibly show peanuts, also depicted in the [manufacturer's original chocolate wrapper](https://www.lottewellfood.com/images/brand/img_hp05_04.png). Its seller3.2g protein value is retained for audit and excluded from the strict ranking. This visual evidence does not replace a full ingredient/allergen panel.

Net grams are absent from all reviewed gallery and matched manufacturer sources. No density, ml-to-g conversion, factory ingredient list or protein amount was invented. Package protein and volume metrics can use their explicit package basis without a mass conversion; seller nutrition remains separately marked and cannot upgrade manufacturer verification.

Full per-field facts, accurate visual excerpts, identity limits, source hashes, raw source paths and attempted searches are recorded in [korean-review.json](korean-review.json). No requests remain running; source writes are frozen after validation.
