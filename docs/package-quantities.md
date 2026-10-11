# Package quantities and both unit prices

Ice-cream mass and volume are independent facts. A selected offer with both established quantities must show both `totalMassG` and `totalVolumeMl`, plus `costPerGramBeforeDelivery` and `costPerMlBeforeDelivery`. A matching quantity and destination-specific freight quote additionally supplies both after-delivery prices. Missing freight leaves those after-delivery values `null`.

Each inner food package is counted once. For the reviewed PowerCap chocolate carton, 24 tubes × 131 g gives 3,144 g, and 24 × 130 ml gives 3,120 ml. The captured 648,000 VND price therefore gives 206.11 VND/g and 207.69 VND/ml before delivery. A two-carton order doubles both quantities and merchandise cost without changing these unit prices. A disputed pack count withholds every dependent denominator.

## Review an already cached exact package

The library exports `reviewPackageQuantities(application, productId, review)`. The application must be offline. Attach the original listing and exact package-label evidence to the stored product first; both original blobs must exist and match their recorded SHA-256 digests.

```javascript
import { reviewPackageQuantities } from 'lazada-search';

await reviewPackageQuantities(app, productId, {
  reviewedBy: 'Name of the person or audited review process',
  reason: 'Explain the exact package identity and the printed amount.',
  listingEvidenceId,
  listingSha256,
  facts: {
    netMassG: {
      value: 131,
      unit: 'g',
      basis: 'one-inner-food-package',
      sourceEvidenceId: labelEvidenceId,
      sourceSha256: labelSha256,
      sourceAuthority: 'manufacturer-label-secondary-host',
      excerpt: '130mL; 净含量131克',
      identityMatched: true,
    },
  },
});
```

`netVolumeMl` can be reviewed independently with unit `ml`. Values must be positive and finite. The quantity is for one inner food package, not its shipping carton, shaker or selected multipack. Preserve source authority: a factory label hosted by an importer is not evidence retrieved directly from the manufacturer. Review only facts supported by an exact identity match; a similar family or different flavour cannot supply a missing amount.

The CLI reads the same review object from JSON:

```sh
node bin/lazada-search.js review-package-quantities PRODUCT_ID review.json --offline --no-ocr
node bin/lazada-search.js compare --category chocolate-ice-cream --sort costPerGramBeforeDelivery --offline --no-ocr
node bin/lazada-search.js compare --category chocolate-ice-cream --sort costPerMlBeforeDelivery --offline --no-ocr
```

HTTP and Telegram use the structured operation `review-package-quantities`, with `input: { productId, review }`. They accept the review object directly and do not read an operator's filesystem path. The [actual-original E2E test](../tests/e2e/ice-quantity-review.test.js) exercises each interface and a store restart.

## Reuse and invalidation

The review is a durable associative `package-quantity-review` record. It binds the exact selected SKU, listing URL, selection, capture timestamp, original listing digest, label evidence and original label digest. An identical validated review reuses the existing record. Comparisons apply the review without changing raw offer prices, original observation dates or the captured product quantities. Explicit specification holds continue to take priority.

A changed capture, mismatched SKU or selection, absent or corrupt original bytes, source invalidation or tampered review withdraws the derived quantity. The independently captured other quantity remains available. Exact-capture public reviews can be reused through private fallback comparisons without recollecting their sources.

Quantity review does not approve manufacturer identity, nutrition, current stock or delivery. No density is assumed. A known gram amount cannot supply millilitres, or vice versa. Nutrient-based ratios require their own exact product and formula evidence.

The [current ice rankings](tables/ice-unit-rankings.md), [independent audit](acceptance/ice-unit-completeness/) and [remaining requirements](acceptance/requirements-audit/current.md) retain these distinctions. Export the public case with `archive` after a new review, then use `archive-verify` to verify originals and both associative conversions offline.
