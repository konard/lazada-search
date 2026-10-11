# Exact ice-cream label follow-up

This audit covers all 14 rows in the frozen [ice rankings](../../tables/ice-unit-rankings.json) snapshot from 2026-10-11T05:47:30.429Z. No new exact gram weight or current manufacturer protein denominator was proven. Existing held quantities, flavour exclusions and source authority remain intact.

The audit inspected 32 cached public gallery images for Lotte and Happy, plus 45 existing Happy OCR records. All 40 existing field-source SHA-256 checks passed. No website requests or shared-store changes were made.

The [machine-readable review](review.json) preserves every SKU, source hash, original excerpt, held field and minimum next label task. Original images other than the two copies below are referenced by their compressed public archive paths; the JSON declares compression separately from original image format. Two source HTML captures required redaction: their safe [public-source provenance](public-source-provenance.json) links the committed derivatives to the original digest metadata. The private original HTML is not published. Exact selected SKUs, the weight excerpt and selected-count/calculation inputs were rechecked against the derivatives.

| Happy selected SKU          | Original package-front evidence                                                | SHA-256                                                          | Approval limit                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1880785864_VNAMZ-8527716006 | [125 ml original](happy-belgian-chocolate-125ml-original.webp): **Net. 125ml** | 74475122b45d0440381f91586bb697cf021f84c9dd87cf88e85866f58cd36bb6 | Corroborates the selected volume only; no gram mass, current formula or protein approval. |
| 1880785864_VNAMZ-8527716007 | [475 ml original](happy-belgian-chocolate-475ml-original.webp): **Net. 475ml** | 6583224988823985367b40e065aa6617fcbf984e30e3b2b5b9f0994d75a77ec2 | Corroborates the selected volume only; no gram mass, current formula or protein approval. |

Both WebP files are unchanged original cached response bytes. The shared gallery contains both sizes; its 125 ml hero cannot replace a selected 475 ml amount. The 2021 CASE sample's 4.6 g/100 g protein remains historical and unlinked to either current selling unit. Decorative ingredients in advertising do not supply a complete ingredient list.

Fanfare's 175 ml seller nutrition table is blank. Its retailer GTIN has conflicting 170 ml and 175 ml descriptions; related 195 ml and family-only 175 g records cannot fill its quantities. Crispy Crunch/WorldCone's 160 ml seller table says 3.2 g protein, but its visible peanut/nut topping retains its strict exclusion. The reviewed exact images do not establish a vanilla core. The earlier [source-pass notes](../manufacturer-research/new-source-pass/review.md) were corrected without changing numeric facts or eligibility.

The two PowerCap selling rows have matched 130 ml/131 g wrapper quantities. Their protein denominator comes from one seller promotional table, while the factory endpoint's numeric nutrition remains empty. The snapshot coverage count of three protein denominators includes the excluded WorldCone; it does not mean three factory-verified, strict chocolate products.

The [automation guide](../../ICE-CREAM-AUTOMATION.md#exact-label-acceptance-for-the-14-row-snapshot) lists the next exact label task for every row. No density conversion, flavour/formula transfer, historical nutrition promotion or held-weight restoration was performed.
