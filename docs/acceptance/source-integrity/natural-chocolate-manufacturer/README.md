# ON Naturally Flavored Chocolate manufacturer follow-up

Acquired on 2026-10-11 for selected Lazada SKU `13463872611_VNAMZ-117339168804`. This bundle contains an unapproved manufacturer lead and failed-fetch provenance. It grants no nutrition or authenticity approval.

The [dedicated official product page](https://www.optimumnutrition.com/en-us/products/gold-standard-whey-naturally-flavored-protein-powder) lists Chocolate and a 27-serving, 1.9 lb option. This supports the product family shown on the selected seller-front image. Its printed 864 g is preserved by the separate [selected-package correction receipt](../selected-package-corrections.json); the rounded imperial size does not replace that metric mass.

The web reader displayed the smaller 15-serving option. Its nutrition link names a 15-serving Chocolate asset. Manufacturer gallery alternative text also names 2.73 kg, which contradicts the selected package and cannot establish its mass. Family advertising describes 24 g protein per serving and whey isolate as the primary protein source; neither supplies an exact approved serving-mass denominator or establishes a pure-isolate formula.

The initial isolated `ManufacturerSourceCache` attempt produced a transport failure without HTTP response. One authorized network fetch later returned HTTP 403 with a Cloudflare challenge. Further manufacturer-host acquisition stopped. The original challenge is retained privately; its sanitized public derivative and both body hashes are recorded in [the HTTP receipt](official-natural-whey.http403.source.json). It contains no product facts. [The web extract](official-natural-whey.web-extract.json) is explicitly a reader extraction, not original HTML or an original label image.

The minimal missing proof is a readable official Naturally Flavored Chocolate 27-serving/864 g back label, its package identifier and revision, plus corresponding seller-package identity evidence. Do not transfer regular Gold Standard nutrition, assume the default 15-serving formula matches, infer a serving weight from package mass/serving count, or promote an uninspected image URL.
