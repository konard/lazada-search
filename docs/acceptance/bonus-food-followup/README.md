# Bonus food proof followup — 11 October 2026

SKU `3255422832_VNAMZ-117013951240` remains an advertised two-paid-bag offer with
one **potential** food gift. The cached originals do not establish the gift's
mass, flavour, finished formula, stock or applied order eligibility.

The followup also finds a paid-mass basis conflict. The shared specification
declares `2kg`, but the shared “2KG PURE TẶNG BÌNH” artwork pictures **two
pouches** and a bottle. Its small pouch-mass text is partly occluded; the
[inspection crop](printed-mass-inspection-crop.png) cannot approve 1000g or any
other replacement mass. The parent 2kg may describe a bundle rather than each
inner pouch. Consequently, the current `2000g × 2 = 4000g` denominator requires
a hold until exact selected-package evidence resolves the basis.

| Field                 | Evidence and decision                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Selected paid flavour | Catalogue and displayed option say chocolate; shared description says unflavoured. No gift-flavour or formula transfer. |
| Paid bag count        | “2 túi tặng 1 túi” supports the advertised two-paid-bag count; it does not establish each bag's grams.                  |
| Gift count            | One bag advertised; actual allocation remains unconfirmed.                                                              |
| Paid per-pouch mass   | Hold `netMassG`; approve no alternate value.                                                                            |
| Gift mass / protein   | Held; no density, servings or raw-ingredient conversion.                                                                |
| Quantity limits       | Selected catalogue says min1/max5; displayed input says min1/max30. Neither establishes gift thresholds or gift stock.  |
| Applied eligibility   | No preserved cart/checkout gift allocation or complete campaign terms.                                                  |
| Observed price        | Retain 1,790,000 VND from 10 October 2026 at 21:09:54.492 UTC; this audit does not refresh the price.                   |

[review.json](review.json) records exact source pointers, excerpts, catalogue
objects, contradictions and the minimal missing sources.
[specification-hold.json](specification-hold.json) is the applied selective
public hold. It suppresses the disputed per-pouch mass and dependent gram and
protein metrics while preserving the original claims, price and advertised
counts. Root applied it after both full suites passed; [integration.json](integration.json) records the exact source checks and removed447.50 VND/g calculation.

The [shared artwork original](shared-2kg-artwork-original.webp) is copied
unchanged from the repository archive, SHA-256
`fbd30f1ca572b3ad26bf33687f19055128ce210255042d8ad14173bff46cfdc4`.
[inspection-transform.json](inspection-transform.json) preserves the original
dimensions, crop rectangle, resize method, renderer version and both digests.
The crop is a visual inspection aid, never an original label or an approved fact.
The selected combo's separate three-pouch illustration is already preserved in
the earlier audit; the catalogue uses that same image for chocolate and vanilla
combo siblings, so it cannot establish gift flavour.

All 14 matching cached gallery renditions were checked against their archived
original blob hashes. No new browser actions, network requests, OCR execution,
core edits or shared-store writes occurred. The existing `athlepro.vn` lookup
failure was retained without repeating it. Shared Hilmar8010/raw20kg declarations
do not establish the finished chocolate pouch formula or promotion eligibility.

An integration command must verify the source binding before writing the hold.
From the repository root, after tests and publication are idle:

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { configuredStore, parseArguments } from './src/config.js';
import { sha256 } from './src/util.js';
const hold = JSON.parse(await readFile(
  'docs/acceptance/bonus-food-followup/specification-hold.json', 'utf8'
));
const store = configuredStore(parseArguments(['--offline', '--no-ocr']));
const product = await store.get('product', hold.productId);
const offer = await store.get('offer', hold.offerId);
const evidence = await store.get('evidence', hold.evidenceId);
const html = await store.blob(hold.originalHtmlSha256);
const image = await readFile(hold.imagePath);
if (product?.sku !== hold.sku || offer?.sku !== hold.sku ||
    evidence?.html?.sha256 !== hold.originalHtmlSha256 ||
    !html || sha256(html) !== hold.originalHtmlSha256 ||
    sha256(image) !== hold.imageSha256) {
  throw new Error('Hold source binding no longer matches the preserved case');
}
await store.put('specification-hold', hold);
NODE
```

This command was documented but not executed by the independent reviewer. Root subsequently applied the source-bound hold and regenerated comparisons and the repository archive, with zero downloads. See [the integration receipt](integration.json). A later exact manufacturer correction can resolve the existing hold
mechanism; this bundle grants no such correction.
