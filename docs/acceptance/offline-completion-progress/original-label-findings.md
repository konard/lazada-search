# Offline original-label progress

The current public archive was read without website, search, image, provider or browser requests. All 14 ice rows and the held Rule 1 handpicked SKU were checked against current archive listing IDs, original hashes and retained source reviews.

Two Happy Belgian Chocolate front labels were reviewed through the existing quantity API in an isolated temporary store. They corroborate the already known 125 ml and 475 ml values. They establish no new grams, protein, ingredients, manufacturer formula, stock or freight. At quantity two, totals remain 250 ml and 950 ml, with unchanged 360 and 315.7894736842105 VND/ml before delivery. Both delivered rates remain null.

[evidence-review.json](evidence-review.json) covers all 15 cases and exact original source pointers. [happy-volume-application.json](happy-volume-application.json) preserves accepted review IDs, source timestamps and explicit numeric assertions. [happy-volume-restart-invalidation.json](happy-volume-restart-invalidation.json) confirms restart reuse and withdrawal of derived claims after isolated source invalidation, preserving independent quantities and the active stop.

The initial temporary harness read the comparison result's wrong object level. A positive 950 ml assertion caught undefined. The corrected harness explicitly checks every metric under result.metrics; no assertion, product code or evidence gate was weakened.

## Accepted packets

- [Happy 475 ml packet](1880785864_VNAMZ-8527716007.review-packet.json), [review input](1880785864_VNAMZ-8527716007.review-input.json).
- [Happy 125 ml packet](1880785864_VNAMZ-8527716006.review-packet.json), [review input](1880785864_VNAMZ-8527716006.review-input.json).

Original images already reside in the repository. The 475 ml image SHA256 is 6583224988823985367b40e065aa6617fcbf984e30e3b2b5b9f0994d75a77ec2; the 125 ml image SHA256 is 74475122b45d0440381f91586bb697cf021f84c9dd87cf88e85866f58cd36bb6.

## Exact offline API recipe

Use an application whose store resolves the public archive's originals and whose app.cache.offline is true. Read a review packet, require the exact current SKU and original observation timestamp, and run:

    const product = await app.store.get('product', packet.productId);
    assert.equal(app.cache.offline, true);
    assert.equal(product.sku, packet.sku);
    assert.equal(product.observedAt, packet.observedAt);

    await app.store.put('evidence', packet.evidence);
    await app.store.put('product', {
      ...product,
      evidenceIds: [...new Set([...product.evidenceIds, packet.evidence.id])],
    });
    const review = await reviewPackageQuantities(
      app,
      packet.productId,
      packet.reviewInput
    );
    assert.equal(review.nutritionApproved, false);
    assert.equal(review.factoryIdentityApproved, false);

The API verifies attached original listing/image bytes and digests, selected SKU/count/selection, capture timestamps, source invalidations and specification holds. It persists a package-quantity-review without changing original prices or observation dates. Source changes withdraw the review; no stale review should be force-applied.

Do not import the isolated negative-control invalidations into a shared store. No committed archive, shared store or repository source changed during this offline data pass.

## Remaining exact evidence

- Rule 1 Combo 2 Túi 1Kg shares artwork with 500 g/1,000 g options. The original 2,200-pixel zip-bag front prints no legible inner-bag mass or serving mass. The description lists offered sizes without an explicit selected bundle basis. Other gallery pictures are Vanilla/Dark Chocolate or unrelated 500 g reviews. A 2 kg denominator and the selected plain formula remain held.
- iBerri's 3 kg claim conflicts with flavour-dependent ranges; generic Cremo 6 L/3 kg is not its exact export package.
- Cremo's selected white 6,000 ml tub cannot inherit the manufacturer yellow tub's 3 kg.
- Fanfare 175 ml has blank seller nutrient cells. Related 175 g, 170 ml and 195 ml records cannot supply this selected export formula.
- Happy 125/475 ml fronts establish volume only; historical 2021 laboratory nutrition is not bound to these packages.
- Merino 40/60 g artwork has no independent ml/current nutrition or exact current formula/GTIN.
- PowerCap factory nutrition uses zero placeholders without a serving basis; seller 1 g protein remains a reference.
- WorldCone/Aice exclusions and the sold-out Merino cone remain in force.
- No frozen Nha Trang quote was captured or approved.

The saved Optimum Nutrition CAPTCHA stop remains active and unchanged.
