import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { calculateOffer, LazadaSearch } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { matchesFlavourScope, productFlavour } from '../src/flavour-scope.js';
import { listingKey } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error(
    'Publish redacted product-page captures before generating public shortlist data'
  );
}
const app = new LazadaSearch({
  store: configuredStore(options),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
app.collector.start = () => {
  throw new Error('Urgent shortlist is strictly offline');
};
const checkedAt = new Date().toISOString();
const now = Date.parse(checkedAt);
const comparison = await app.compare({ quantity: 1, allowStale: true, now });
const audit = await app.audit();
const groups = new Map();
for (const row of comparison.comparisons) {
  if (!(row.offer.price > 0) || row.offer.variantConfirmed !== true) {
    continue;
  }
  const key = `${listingKey(row.offer.url)}:${row.offer.sku || row.offer.id}`;
  const rows = groups.get(key) || [];
  rows.push(row);
  groups.set(key, rows);
}

const manualFindings = {
  '367656830_VNAMZ-116917756014': {
    notes: [
      'The cached HTML audit confirms the selected COMBO 5 contains five 40g sticks, totaling 200g. The public price is 39000 VND, or 195 VND per declared food gram. Exact manufacturer nutrition and frozen delivery remain unconfirmed.',
    ],
  },
  '13479894070_VNAMZ-117397989208': {
    withholdUnitRanking: true,
    notes: [
      'The title 22g is protein per serving, not declared powder net mass. The selected 18 sticks have no confirmed powder net mass, so unit ranking remains withheld.',
    ],
  },
  '2126595433_VNAMZ-10014178624': {
    notes: [
      'Seller description says a zip-bag repack. Manufacturer ingredient/material specifications do not verify this retail repack or its purity. Listing ingredients and unflavoured description conflict.',
    ],
  },
  '2126595433_VNAMZ-10014178625': {
    notes: [
      'Captured 2kg selected option is unavailable; exclude it from actionable candidates.',
    ],
  },
  '2126595433_VNAMZ-10014178626': {
    notes: [
      '5Kg Tang 1Kg declares a conditional free-food gift. The confirmed paid-food mass is 5000g; do not add the gift gram denominator until the same powder and gift eligibility are verified.',
    ],
  },
  '13430219487_VNAMZ-117214356195': {
    notes: [
      'Generic Gold Standard title has no captured brand. Listing metadata contains unrelated material, diameter and racket-string fields; do not treat the copied description as an exact manufacturer identity or authenticity proof.',
    ],
  },
  '13430219487_VNAMZ-117214356196': {
    notes: [
      'Same generic cross-border listing as the vanilla variant; exact identity and label remain unverified.',
    ],
  },
  '13430219487_VNAMZ-117214356197': {
    notes: [
      'Same generic cross-border listing as the vanilla variant; exact identity and label remain unverified.',
    ],
  },
  '3300919067_VNAMZ-16058119853': {
    notes: [
      'Official 5lb ITS JUST package mass is 2268g when the exact label matches. The listing displays a rounded 2300g. Price and freight must refer to this selected natural SKU and order quantity.',
      'Captured gift-combo promotion is conditional; no confirmed monetary discount can be subtracted.',
    ],
  },
};

function declaredPackCount(product) {
  const text = (product.selectedVariant || [])
    .map((option) => option.text)
    .join(' ');
  const match = /(?:combo|com bo)\s*(\d+)\s*(?:cây|ly|gói|túi|hộp)/iu.exec(
    text
  );
  return match ? Number(match[1]) : undefined;
}

function rowPriority(row) {
  const pack = declaredPackCount(row.product);
  return (
    Number(row.manufacturerVerified) * 1000 +
    Number(pack !== undefined && row.product.packCount === pack) * 100 +
    Number(row.offer.originalPrice > row.offer.price) * 10 +
    Number(Array.isArray(row.offer.promotions))
  );
}

function bulkScenarios(product, offer, unitRankingWithheld) {
  return [1, 2, 3, 5, 10].map((quantity) => {
    const quantityOffer =
      quantity > 1 && offer.shippingQuantity !== quantity
        ? { ...offer, shipping: undefined }
        : offer;
    const quote = calculateOffer(product, quantityOffer, {
      quantity,
      deliveryArea: 'Nha Trang',
      now,
    });
    const { metrics: calculated } = quote;
    if (quantity > 1 && offer.shippingQuantity !== quantity) {
      assert.equal(calculated.totalAfterDelivery, null);
    }
    if (Number.isFinite(calculated.totalMassG) && !unitRankingWithheld) {
      assert.equal(
        calculated.totalMassG,
        product.netMassG * (product.packCount || 1) * quantity
      );
    }
    const measured = (field) =>
      unitRankingWithheld ? null : calculated[field];
    return {
      quantity,
      merchandiseSubtotalVnd: calculated.merchandiseSubtotal,
      confirmedOrderDiscountVnd: calculated.discount,
      beforeDeliveryVnd: calculated.totalBeforeDelivery,
      freightVnd: calculated.shipping,
      afterDeliveryVnd: calculated.totalAfterDelivery,
      foodMassG: measured('totalMassG'),
      foodVolumeMl: measured('totalVolumeMl'),
      proteinG: measured('totalProteinG'),
      vndPerFoodGramBeforeDelivery: measured('costPerGramBeforeDelivery'),
      vndPerFoodGramAfterDelivery: measured('costPerGramAfterDelivery'),
      vndPerMlBeforeDelivery: measured('costPerMlBeforeDelivery'),
      vndPerMlAfterDelivery: measured('costPerMlAfterDelivery'),
      vndPerProteinGramBeforeDelivery: measured(
        'costPerProteinGramBeforeDelivery'
      ),
      vndPerProteinGramAfterDelivery: measured(
        'costPerProteinGramAfterDelivery'
      ),
      eligible: quote.eligible && !unitRankingWithheld,
      unresolved: [
        ...quote.problems,
        ...(unitRankingWithheld
          ? ['Net mass denominator rejected by urgent review']
          : []),
      ],
    };
  });
}

function saleObservation(offer) {
  return {
    salePriceVnd: offer.price,
    originalPriceVnd: offer.originalPrice ?? null,
    saleSavingsVnd:
      offer.originalPrice > offer.price
        ? offer.originalPrice - offer.price
        : null,
    calculatedSaleReductionPercent:
      offer.originalPrice > offer.price
        ? 100 * (1 - offer.price / offer.originalPrice)
        : null,
    displayedSaleReductionPercent: offer.displayedDiscountPercent ?? null,
    saleAlreadyIncluded: true,
    confirmedAdditionalMonetaryDiscountVnd: offer.discount || 0,
    promotions: (offer.promotions || []).map((promotion) => ({
      text: promotion.text,
      eligibilityConfirmed: promotion.eligibilityConfirmed === true,
      observedAt: promotion.observedAt,
      evidenceId: promotion.evidenceId,
    })),
    bulkTiers: offer.bulkTiers || [],
  };
}

function packageObservation(product, offer, unitRankingWithheld) {
  return {
    available: offer.available ?? null,
    minQuantity: offer.minQuantity ?? null,
    maxQuantity: offer.maxQuantity ?? null,
    stock: offer.stock ?? null,
    netMassG: unitRankingWithheld ? null : (product.netMassG ?? null),
    netVolumeMl: product.netVolumeMl ?? null,
    packCount: product.packCount || 1,
    proteinPer100g: product.proteinPer100g ?? null,
    proteinType: product.proteinType,
  };
}

function manufacturerObservation(product, manufacturerVerified) {
  return {
    brand: product.brand || null,
    manufacturerVerified,
    manufacturerUrl: product.manufacturerVerification?.sourceUrl || null,
    manufacturerEvidenceId:
      product.manufacturerVerification?.evidenceId || null,
    manufacturerReviewId: product.manufacturerVerification?.reviewId || null,
  };
}

function freightObservation(offer) {
  return {
    onePackageFreightVnd:
      offer.shippingQuantity === 1 ? (offer.shipping ?? null) : null,
    shippingQuotedQuantity: offer.shippingQuantity ?? null,
    shippingQuoteObservedAt: offer.quoteObservedAt ?? null,
    deliveryArea: offer.deliveryArea ?? null,
    coldChainConfirmed: offer.coldChainConfirmed === true,
  };
}

function reviewedMetrics(input, unitRankingWithheld) {
  const metrics = { ...input };
  delete metrics.shippingDestination;
  if (unitRankingWithheld) {
    for (const field of Object.keys(metrics)) {
      if (
        /^costPer/u.test(field) ||
        /^total(?:Mass|Volume|Protein)/u.test(field)
      ) {
        metrics[field] = null;
      }
    }
  }

  return metrics;
}

function toReviewedRow(rows) {
  const selected = [...rows].sort(
    (left, right) =>
      Date.parse(right.offer.observedAt) - Date.parse(left.offer.observedAt) ||
      rowPriority(right) - rowPriority(left)
  )[0];
  const { product, offer } = selected;
  const finding = manualFindings[offer.sku] || {};
  const differingFields = [
    'netMassG',
    'netVolumeMl',
    'packCount',
    'proteinPer100g',
  ].filter(
    (field) =>
      new Set(rows.map((row) => JSON.stringify(row.product[field] ?? null)))
        .size > 1
  );
  const notes = [...(finding.notes || [])];
  if (differingFields.length) {
    notes.push(
      `Cached listing aliases disagree on ${differingFields.join(', ')}. Preserve this discrepancy; prefer exact factory review and explicitly selected selling-unit evidence.`
    );
  }
  if (
    /\b(?:sample|share|zip)\b/iu.test(
      `${product.title} ${(product.selectedVariant || []).map((option) => option.text).join(' ')}`
    )
  ) {
    notes.push(
      'Sample/share/zip selling option: retail origin, repack identity, expiry and label require review independently of brand specifications.'
    );
  }
  if (product.category === 'chocolate-ice-cream') {
    notes.push(
      'Ordinary freight is not frozen delivery. Confirm Nha Trang cold chain for this SKU and intended bulk quantity before considering a purchase.'
    );
  }
  const current = calculateOffer(product, offer, {
    deliveryArea: 'Nha Trang',
    now,
  });
  const observationConflicts = selected.observationConflicts || [];
  const unitRankingWithheld =
    finding.withholdUnitRanking === true ||
    (finding.withholdUntilManufacturerReview === true &&
      !selected.manufacturerVerified) ||
    observationConflicts.length > 0;
  if (observationConflicts.length) {
    notes.push(...observationConflicts);
  }
  const metrics = reviewedMetrics(selected.metrics, unitRankingWithheld);

  return {
    productId: product.id,
    offerId: offer.id,
    priceEvidenceId: offer.evidenceId,
    quoteEvidenceId: offer.quoteEvidenceId,
    sku: offer.sku,
    url: offer.url,
    title: product.title,
    category: product.category,
    requestedFlavorScopeMatched: matchesFlavourScope(
      product,
      'chocolate-or-unflavoured'
    ),
    extractedFlavour: productFlavour(product),
    selectedOptions: [
      ...new Set((product.selectedVariant || []).map((option) => option.text)),
    ],
    ...saleObservation(offer),
    observedAt: offer.observedAt,
    ageHours: (now - Date.parse(offer.observedAt)) / 3600000,
    staleByDefault24hLimit: now - Date.parse(offer.observedAt) > 86400000,
    ...packageObservation(product, offer, unitRankingWithheld),
    ...manufacturerObservation(product, selected.manufacturerVerified),
    ...freightObservation(offer),
    cachedAliasCount: rows.length,
    cachedAliasDenominatorDifferences: differingFields,
    observationConflicts,
    unitRankingWithheld,
    eligibleNowOnePackage: current.eligible && !unitRankingWithheld,
    unresolvedNow: current.problems,
    metrics,
    bulkScenarios: bulkScenarios(product, offer, unitRankingWithheld),
    reviewNotes: notes,
  };
}

const entries = [...groups.values()].map(toReviewedRow);
const supported = entries.filter((entry) =>
  ['whey', 'protein-powder', 'chocolate-ice-cream'].includes(entry.category)
);
const actionable = supported.filter(
  (entry) =>
    entry.available !== false &&
    !entry.unitRankingWithheld &&
    entry.requestedFlavorScopeMatched
);
const sortBy = (field) => (left, right) =>
  (left.metrics[field] ?? Infinity) - (right.metrics[field] ?? Infinity);
const verifiedWhey = actionable
  .filter((entry) => entry.category === 'whey' && entry.manufacturerVerified)
  .sort(sortBy('costPerProteinGramBeforeDelivery'));
const provisionalWhey = actionable
  .filter((entry) => entry.category === 'whey' && !entry.manufacturerVerified)
  .sort(sortBy('costPerGramBeforeDelivery'));
const ice = actionable
  .filter((entry) => entry.category === 'chocolate-ice-cream')
  .sort(sortBy('costPerMlBeforeDelivery'));
const report = {
  checkedAt,
  market: 'Vietnam',
  deliveryArea: 'Nha Trang',
  currency: 'VND',
  scope:
    'Offline review of cached selected-SKU observations, not a whole-market cheapest guarantee',
  requestedFlavors: {
    proteinPowder: ['plain/unflavoured/natural', 'chocolate'],
    iceCream: [
      'chocolate only; excludes chocolate-banana and mixed-flavour tubs',
    ],
  },
  networkDownloads: app.cache.stats.downloads,
  summary: {
    comparisonRowsBeforeAliasGrouping: comparison.comparisons.length,
    uniqueSelectedSkuObservations: entries.length,
    supportedFoodSkus: supported.length,
    capturedSkusWithinRequestedFlavorScope: supported.filter(
      (entry) => entry.requestedFlavorScopeMatched
    ).length,
    manufacturerVerifiedFoodSkus: supported.filter(
      (entry) => entry.manufacturerVerified
    ).length,
    currentlyEligibleOnePackageOffers: actionable.filter(
      (entry) => entry.eligibleNowOnePackage
    ).length,
    confirmedMonetaryVouchers: supported.filter(
      (entry) => entry.confirmedAdditionalMonetaryDiscountVnd > 0
    ).length,
    capturedBulkTiers: supported.filter((entry) => entry.bulkTiers.length)
      .length,
    denominatorDisagreementSkuCount: entries.filter(
      (entry) =>
        entry.cachedAliasDenominatorDifferences.length ||
        entry.observationConflicts.some((conflict) =>
          /denominator/iu.test(conflict)
        )
    ).length,
    unresolvedListingCount: audit.missingListings.length,
    unresolvedSkuPriceCount: audit.missingSkuPrices.length,
    unfinishedSearchScopes: audit.unfinishedSearches.length,
  },
  arithmetic:
    'Per unit = (sale price x package quantity - confirmed fixed order discount + freight quoted for exactly that quantity) / food mass, volume or protein in all food packs. Displayed sale reduction is already included. No volume-to-mass conversion or gift/voucher eligibility is assumed.',
  refreshFirst: [
    '3300919067_VNAMZ-16058119853',
    '3201573592_VNAMZ-15280912681',
    '3261102356_VNAMZ-15736009588',
  ],
  verifiedWhey,
  provisionalWhey: provisionalWhey.slice(0, 20),
  chocolateIceCream: ice,
  soyAlternativesOutsideWheyCategory: actionable.filter(
    (entry) => entry.category === 'protein-powder' && /soy/iu.test(entry.title)
  ),
  excludedOrQuarantined: entries.filter(
    (entry) =>
      entry.available === false ||
      entry.unitRankingWithheld ||
      entry.category === 'unknown'
  ),
  excludedByRequestedFlavorScope: supported.filter(
    (entry) => !entry.requestedFlavorScopeMatched
  ),
  allReviewedSelectedSkuObservations: entries,
  inputDuplicateObservationGroups: comparison.duplicateObservations || [],
};
assert.equal(report.networkDownloads, 0);
const serialized = JSON.stringify(report, null, 2);
assert.equal(
  /\+84[\s-]*\d{8,10}|browser-profile|"(?:shippingDestination|cookie|authorization|sessionToken|password)"\s*:/iu.test(
    serialized
  ),
  false,
  'Public shortlist must exclude private account fields'
);
const directory = 'docs/acceptance/urgent-discounts';
await mkdir(directory, { recursive: true });
const style = await resolveConfig(`${directory}/README.md`);
await writeFile(
  `${directory}/reviewed-shortlist.json`,
  await format(`${serialized}\n`, { ...style, parser: 'json' })
);

const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : 'Pending';
const cell = (value) =>
  String(value).replaceAll('|', '&#124;').replaceAll('\n', ' ');
const rows = (list, metric, afterMetric) =>
  list
    .map(
      (entry) =>
        `| [${cell(entry.title)}](${entry.url}) | ${cell(entry.selectedOptions.join('; '))} | ${entry.sku} | ${number(entry.salePriceVnd)} | ${number(entry.metrics[metric])}${afterMetric ? ` → ${number(entry.metrics[afterMetric])}` : ''} | ${number(entry.onePackageFreightVnd)} | ${entry.staleByDefault24hLimit ? 'Refresh stale price' : 'Captured within 24h'} |`
    )
    .join('\n');
const priority = entries.find(
  (entry) => entry.sku === '3300919067_VNAMZ-16058119853'
);
const priorityNarrative = priority?.manufacturerVerified
  ? `[Natural 5lb ITS JUST](${priority.url}) has exact manufacturer verification: **${number(priority.netMassG)} g** powder containing **${number(priority.metrics.totalProteinG)} g** protein. Captured sale **${number(priority.salePriceVnd)} VND**, one-package freight **${number(priority.onePackageFreightVnd)} VND**, delivered total **${number(priority.metrics.totalAfterDelivery)} VND**, or **${number(priority.metrics.costPerProteinGramAfterDelivery)} VND per gram of protein**. Captured at ${priority.observedAt}; selected quantity limit ${number(priority.maxQuantity)}. Two packages cost **${number(priority.bulkScenarios.find((scenario) => scenario.quantity === 2).beforeDeliveryVnd)} VND before delivery**; three cost **${number(priority.bulkScenarios.find((scenario) => scenario.quantity === 3).beforeDeliveryVnd)} VND before delivery**. Freight must be quoted separately for each intended bulk quantity. This is the lowest captured verified whey candidate in the current shortlist, not a market-wide guarantee.`
  : 'The natural 5lb ITS JUST candidate [3300919067](https://www.lazada.vn/products/pdp-i3300919067.html) needs exact factory-label review and a fresh destination freight quote. Official package mass is 2,268 g when the known factory identity matches. The listing displays a rounded 2,300 g. Prioritize this candidate before purchasing.';
const markdown = `# Urgent 10.10 cached buying shortlist\n\nChecked ${checkedAt}, destination Nha Trang. Review ran offline with **0 downloads**. ${supported.length} distinct captured food SKUs are available after grouping repeated listing aliases; ${report.summary.manufacturerVerifiedFoodSkus} have exact manufacturer specifications. The shortlist includes **plain/natural/unflavoured or chocolate protein powders**, and **chocolate ice cream only**; banana, vanilla and mixed ice-cream tubs are excluded. Search coverage is still incomplete, and bulk freight must be quoted for the intended quantity. This is a practical refresh shortlist, not a market-wide cheapest claim.\n\n## Manufacturer-verified whey, sorted by VND per gram of protein before delivery\n\n| Listing | Selected option | SKU | Sale VND | VND / protein g before → after delivery | Captured one-package freight | Price freshness |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows(verifiedWhey, 'costPerProteinGramBeforeDelivery', 'costPerProteinGramAfterDelivery')}\n\n${priorityNarrative}\n\n## Cheaper provisional whey leads, sorted by declared food grams\n\n| Listing | Selected option | SKU | Sale VND | VND / declared food g | Captured one-package freight | Price freshness |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows(provisionalWhey.slice(0, 12), 'costPerGramBeforeDelivery')}\n\nNZMP zip bags and ON share/sample options need exact repack and selling-unit review. Generic Gold Standard listing 13430219487 has blank brand and unrelated material/string metadata; its very low captured price is not enough to establish an exact genuine ON product. SEEQ 18-stick title says **22 g protein per serving**, which cannot be used as powder net mass: its extracted unit cost is withheld. The unavailable NZMP 2kg option is excluded.\n\n## Chocolate ice cream, sorted by declared milliliters\n\n| Listing | Selected option | SKU | Sale VND | VND / declared ml | Captured one-package freight | Price freshness |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows(ice, 'costPerMlBeforeDelivery')}\n\nThe [cached extraction audit](../urgent-extraction-audit/README.md) confirms Merino COMBO 5 as five 40g sticks, totaling 200g at 39,000 VND: **195 VND per declared food gram** before delivery. This provisional mass comparison has no verified milliliter or protein denominator. Current stock, exact manufacturer nutrition and frozen delivery to Nha Trang still require confirmation. A normal parcel freight quote does not establish frozen delivery. Chocolate-banana cups and mixed-flavour tubs are outside the requested scope, even if their declared milliliter cost is lower.\n\n## Discounts and bulk arithmetic\n\nSale prices include the displayed sale reduction. Additional order discounts require confirmed eligibility. This snapshot has **${report.summary.confirmedMonetaryVouchers} confirmed additional monetary vouchers** and **${report.summary.capturedBulkTiers} confirmed bulk price tiers**. The ITS JUST gift-combo text is conditional and cannot reduce a cash comparison. A no-gift option priced lower is a separate selected SKU, not a coupon applied again.\n\n[Machine-readable reviewed observations](reviewed-shortlist.json) include original prices, sale savings, all captured conditions, price age, quantity limits and explicit 1/2/3/5/10-package scenarios. One-package freight is never copied to a larger order. Private account data, destination street addresses and screenshots are excluded.\n`;
await writeFile(
  `${directory}/README.md`,
  await format(markdown, { ...style, parser: 'markdown' })
);
console.log(JSON.stringify(report.summary));
await app.close();
