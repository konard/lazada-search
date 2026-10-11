# Food gifts and selling-unit arithmetic

`calculateOffer(product, offer, options)` reads optional `offer.foodComponents`.
The existing `product.netMassG`, `netVolumeMl`, nutrition and `packCount` remain
the paid selling unit. Existing offers retain their arithmetic without supplying
components. Up to100 component records are accepted per offer.
`accountFoodComponents` is also available directly from
`src/food-components.js`; its `paid` argument contains already calculated
`totalMassG`, `totalVolumeMl` and `totalProteinG`.

Each component has a stable `id` and one of three `kind` values:

- `paid-food`: `productId` and `unitsPerSellingUnit` describe the already counted
  selected product. They must match the existing product and `packCount`.
  They never add that multipack again. Contradictions withhold the denominators.
- `bonus-food`: a separately identified food package with exact reviewed facts
  and order eligibility. Its confirmed units enter the order denominator once.
- `non-food`: accessories such as shakers. They contribute no grams,
  millilitres or protein, regardless of advertised size or weight.

A bonus stores its `product`, `identity`, `sourceIdentity`, `review`, `facts`,
`evidenceIds` and `eligibility`. Both identities must match brand, product name,
flavour, market, package type, formula revision and a GTIN or manufacturer
variant code. They describe **one inner package** (`innerPackCount: 1`) and the
exact current selling formula (`currentFormula: true`); the bonus product has
`packCount: 1`. A multipack gift is represented by the explicit
number of these inner packages, rather than another implicit pack multiplier.
Package grams and millilitres must match the product and both identities.
The requested market comes from `options.market`, `offer.market` or the paid
product. The requested flavour scope applies independently to the bonus; its
default is chocolate/plain whey or a chocolate ice-cream core.

The identity `review` and every numeric fact reference reviewed original evidence:
`sourceUrl`, `sourceSha256`, `evidenceId`, `excerpt`, `reviewedBy` and `reviewedAt`.
The evidence ID must appear in the component's `evidenceIds`; invalidated
evidence cannot count. Facts also supply `value`, `unit`, `basis` and the
single-number original `valueExcerpt`. Quantity facts use `g`/`ml` with
`one-inner-food-package`; exact original `kg`→`g` or `L`→`ml` conversions may
supply `sourceValue` and `sourceUnit`. No mass/volume conversion is supported.
Nutrition uses `g/100g` with `per-100g`, `g/100ml` with `per-100ml`, or
`g/package` with `one-inner-food-package`. Its original `basisExcerpt` must
state the corresponding basis. A serving, density or servings-per-package
count cannot be relabelled as package protein.

The calculator consumes **previously reviewed** source references. It does not
fetch original bytes or perform an exact factory review. The source acquisition
and review workflow must validate originals, digests, package identity and
eligibility before persisting these fields. Reusing a digest alone does not
establish seller authenticity or current stock.

`eligibility` binds the gift to:

- `offerId` and the exact selected `sku`;
- the exact `orderQuantity` of paid selling units;
- `units`, the total number of bonus inner packages for that order;
- `allocationId`, identifying the physical gift allocation within that order;
- `minOrderQuantity`, `maxOrderQuantity`, `stockUnits` and `maxUnitsPerOrder`;
- `confirmed`, `available`, `conditionsComplete` and `conditionsSatisfied`, all
  explicitly `true`;
- a current `observedAt`, with a default maximum age of24 hours, configurable
  through `maxPromotionAgeMs`.

Every numeric eligibility field has a reviewed source fact in
`eligibility.claims[field]`, with `unit: 'count'`. Order quantity and its limits
use `basis: 'paid-selling-unit'`; gift units, stock and the per-order limit use
`basis: 'inner-food-package'`. Required payment, buyer or campaign conditions
must be reviewed as complete and satisfied; an advertising headline alone
cannot set these flags. A quantity change requires a new matching confirmation.
Paid offer stock and quantity limits still apply.

For a selected two-bag offer, ordering2 selling units means4 paid bags. A
confirmed gift allocation of1 bag adds **one** bag, giving5 bags; the order
quantity does not multiply that gift. Two gift bags require an explicit
`eligibility.units: 2` and matching stock/limit evidence. Identical component
records deduplicate. Contradictory records with the same ID, or multiple IDs
claiming the same allocation, remain potential.

`metrics.foodComponents` reports `paidFood`, `confirmedBonuses`,
`potentialBonuses`, `nonFoodAccessories`, source references and problems.
`completeOffer` means all **supplied component records** were resolved; it does
not certify marketplace coverage, exhaustive promotion discovery or delivery.
Potential gifts leave the existing paid denominators intact. A counted bonus
with an unknown nutrient or quantity makes that combined metric unknown; it
cannot fill a held or unknown paid quantity. Conflicting protein bases withhold
the combined protein metric. Paid-only sugar/energy ratios are withheld after
adding bonus food until component nutrient totals can be established.

The actual “2 túi tặng1 túi” offer in
[issue14](https://github.com/konard/lazada-search/issues/14) still needs exact
bonus mass, flavour, formula, stock and order-eligibility evidence. This module
does not silently turn its two paid bags into three verified bags.

## Persistence and interfaces

`importRecords({ offers })` validates optional `offer.foodComponents` before
writing the import batch. `quote(offerId, { foodComponents })` replaces the
selected offer's component list and preserves its complete record in offer
history. A restart reloads the same evidence, identities and potential gifts
from the `.lino` record and binary associative projection. Passing an empty
list explicitly removes supplied component records from the current quote;
omitting the field preserves the existing list.

Components require nonempty stable string IDs and a supported kind. Paid
metadata also requires a product ID and a positive integer
`unitsPerSellingUnit`. Conflicting duplicate IDs, malformed nested objects,
nonfinite or negative quantities, fractional counts and incompatible declared
fact units fail before persistence. Identical duplicate records deduplicate
regardless of object property order. A bonus with missing identity, nutrition,
review or eligibility fields remains an unapproved potential record; schema
validation does not approve its facts or original evidence.

The CLI accepts the same quote JSON:

```sh
lazada-search quote OFFER_ID '{"foodComponents":[{"id":"advertised-gift","kind":"bonus-food","originalText":"Gift identity pending review"}]}' --offline
```

For HTTP `POST /api/operations` and Telegram `/operation`, use the common
structured request:

```json
{
  "operation": "quote",
  "input": {
    "offerId": "OFFER_ID",
    "quote": {
      "foodComponents": [
        {
          "id": "advertised-gift",
          "kind": "bonus-food",
          "originalText": "Gift identity pending review"
        }
      ]
    }
  }
}
```

Confirmed bonus results expose `allocationId` from the reviewed eligibility
record. Basket integration can therefore detect the same physical gift
allocation claimed by multiple offer lines and withhold conflicting totals.
The component calculator checks allocations within a single offer; cross-line
deduplication belongs to the basket calculation.

## Stored original evidence

Comparison inputs pass through the read-only asynchronous
`validateFoodComponentEvidence(store, offers, { manufacturerRegistry })` gate.
It returns cloned offers and never downloads, approves new facts or writes
product, offer, evidence or blob records. The default registry is `MANUFACTURERS`;
application comparisons pass their configured trusted manufacturer registry.

Each bonus review, numeric fact and eligibility claim must reference an existing
attached evidence record whose URL and preserved original blob digest match.
The blob must exist and hash correctly. HTML and plain-text excerpts must
occur in the original source; image excerpts require preserved SHA-bound OCR
and its original TSV, or a stored exact visual manufacturer review and matching
source claim. Crop OCR additionally retains its original and derived images,
transform record and any preceding OCR pass. Binary image bytes are never
treated as a text label. Neither OCR nor this gate establishes a new exact
manufacturer identity.

A declared factory approval must match a stored source-backed product approval
and its exact operator review or exact recorded cross-check. The original
manufacturer URL and captured final URL must be trusted for this brand;
manufacturer role metadata alone cannot establish authority. Existing
specification holds and source invalidations still apply. Source-backed seller
reference data does not gain manufacturer approval by passing this gate.

Eligibility uses an original marketplace source and its actual capture time.
`eligibility.observedAt` must match that time. Each claim's original `excerpt`
or optional `contextExcerpt` must identify the selected SKU and contain the
claim excerpt, preventing another checkout line's counts from being borrowed.
Changing a caller timestamp cannot refresh old stock. Source invalidations
after the captured observation withhold the gift even if a newer cache entry
exists at the same URL; a genuinely later observation can be reviewed separately.

Failed proofs are marked `invalidated` in the returned clone and the bonus stays
potential. `evidenceValidation` retains reasons, checked source pointers and
the validation time. `status: 'originals-validated'` means these original-source
checks passed; the existing identity, units, nutrition basis, stock and scope
gates still decide whether the gift can enter the order. Paid denominators and
stored original records remain intact.
