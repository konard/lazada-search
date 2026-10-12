import { fold, listingKey } from './text.js';
import { targetCategoryExclusion } from './target-category.js';
import { productFlavour, isShakerBundle } from './flavour-scope.js';
import { sha256 } from './util.js';
import { positive } from './values.js';
import {
  validatedHandpickedLinks,
  handpickedIdentityFromUrl,
} from './handpicked-links.js';

export const SHOPPING_METRICS = [
  'costPerGramBeforeDelivery',
  'costPerGramAfterDelivery',
  'costPerMlBeforeDelivery',
  'costPerMlAfterDelivery',
  'costPerProteinGramBeforeDelivery',
  'costPerProteinGramAfterDelivery',
];

export function shoppingCategory(product) {
  if (product.category === 'chocolate-ice-cream') {
    return product.category;
  }
  if (
    product.manufacturerVerification?.identityMatched &&
    product.manufacturerVerification.sourceAuthority === 'manufacturer'
  ) {
    const ingredients = JSON.stringify(product.ingredients || []);
    const whey = /whey\s*protein/iu.test(ingredients);
    const soy = /soy(?:a)?\s*(?:protein|isolate)/iu.test(ingredients);
    if (whey && soy) {
      return 'mixed-protein';
    }
    if (soy) {
      return 'soy';
    }
    if (whey) {
      return 'whey';
    }
  }
  const selected = (product.selectedVariant || [])
    .map((entry) => entry.text)
    .join(' ');
  const identity = `${selected} ${product.title || ''}`;
  if (
    /soy\s*(?:protein|isolate)|(?:protein|isolate)\s*soy|đạm\s*đậu\s*nành/iu.test(
      identity
    )
  ) {
    return 'soy';
  }
  if (
    targetCategoryExclusion(product.title) ||
    /\b(?:thuc vat|vegan|plant based|non dairy)\b/u.test(fold(identity))
  ) {
    return 'other-protein';
  }
  return product.category === 'whey' ? 'whey' : 'other-protein';
}

function reportRow(row) {
  const { product, offer, metrics } = row;
  const countHeld =
    product.packageCountUnresolved ||
    product.pendingSpecificationReview?.includes('packCount');
  const powder = product.category !== 'chocolate-ice-cream';
  const rates = Object.fromEntries(
    ['totalBeforeDelivery', 'totalAfterDelivery', ...SHOPPING_METRICS].map(
      (field) => [field, metrics[field] ?? null]
    )
  );
  let foodG = metrics.totalMassG ?? null,
    ml = metrics.totalVolumeMl ?? null,
    proteinG = metrics.totalProteinG ?? null;
  if (countHeld) {
    foodG = null;
    ml = null;
    proteinG = null;
    for (const field of SHOPPING_METRICS) {
      rates[field] = null;
    }
  }
  if (powder) {
    ml = null;
    rates.costPerMlBeforeDelivery = null;
    rates.costPerMlAfterDelivery = null;
    if (metrics.proteinBasis === '100ml') {
      proteinG = null;
      rates.costPerProteinGramBeforeDelivery = null;
      rates.costPerProteinGramAfterDelivery = null;
    }
  }
  return {
    offerId: offer.id,
    productId: product.id,
    sku: offer.sku,
    url: offer.url,
    title: product.title,
    category: shoppingCategory(product),
    flavour: productFlavour(product),
    selectedOptions: product.selectedVariant || [],
    manufacturerVerified: row.manufacturerVerified,
    eligible: row.eligible,
    problems: [...row.problems],
    observedAt: offer.observedAt,
    price: offer.price,
    originalPrice: offer.originalPrice ?? null,
    promotions: offer.promotions || [],
    ingredients: product.ingredients || [],
    ingredientFlags: product.ingredientFlags || {},
    proteinType: product.proteinType,
    corrections: product.corrections || [],
    claims: product.claims || [],
    pendingSpecificationReview: product.pendingSpecificationReview || [],
    quantities: {
      foodG,
      ml,
      proteinG,
      sellingUnits: metrics.quantity,
      innerPackagesPerSellingUnit: countHeld ? null : product.packCount || 1,
    },
    nutrition: {
      proteinPer100g: product.proteinPer100g ?? null,
      proteinPer100ml: product.proteinPer100ml ?? null,
      proteinPerPackageG: product.proteinPerPackageG ?? null,
      sugarPer100g: product.sugarPer100g ?? null,
      sugarPer100ml: product.sugarPer100ml ?? null,
      fatPer100g: product.fatPer100g ?? null,
      fatPer100ml: product.fatPer100ml ?? null,
      saturatedFatPer100g: product.saturatedFatPer100g ?? null,
      saturatedFatPer100ml: product.saturatedFatPer100ml ?? null,
      kcalPer100g: product.kcalPer100g ?? null,
      kcalPer100ml: product.kcalPer100ml ?? null,
    },
    metrics: rates,
    available: offer.available,
    deliveryAvailable: offer.deliveryAvailable,
    shippingQuantity: offer.shippingQuantity ?? null,
    coldChainConfirmed: offer.coldChainConfirmed === true,
    evidenceIds: [
      ...new Set(
        [...(product.evidenceIds || []), offer.evidenceId].filter(Boolean)
      ),
    ],
  };
}

function ordered(rows, metric) {
  const sorted = rows
    .filter(
      (row) => Number.isFinite(row.metrics[metric]) && row.metrics[metric] >= 0
    )
    .sort(
      (a, b) =>
        a.metrics[metric] - b.metrics[metric] ||
        String(a.sku || a.offerId).localeCompare(String(b.sku || b.offerId))
    );
  const seen = new Set();
  return sorted.filter((row) => {
    const key = row.sku || row.offerId;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rankCategory(rows, limit) {
  return Object.fromEntries(
    SHOPPING_METRICS.map((metric) => {
      const observations = ordered(rows, metric);
      const verified = ordered(
        rows.filter((row) => row.manufacturerVerified),
        metric
      );
      const buyable = ordered(
        rows.filter((row) => row.eligible),
        metric
      );
      return [
        metric,
        {
          top: observations.slice(0, limit),
          verifiedTop: verified.slice(0, limit),
          buyableTop: buyable.slice(0, limit),
          rankedCount: observations.length,
          missing: rows.filter((row) => !Number.isFinite(row.metrics[metric])),
        },
      ];
    })
  );
}

function handpickedReport(input, rows, pendingRows, rankings, aliases) {
  const submitted = input.map((entry, index) => {
    const candidate =
      typeof entry === 'string' ? { submittedUrl: entry } : entry;
    const submittedUrl = candidate.submittedUrl || candidate.url;
    const persisted = aliases.find(
      (alias) => alias.submittedUrl === submittedUrl && alias.sourceVerified
    );
    const direct = handpickedIdentityFromUrl(submittedUrl);
    const identity = direct?.sku ? direct : persisted || direct;
    const url = identity?.resolvedUrl || null;
    const exactSku = identity?.sku || null;
    const listingMatches = url
      ? rows.filter((row) => listingKey(row.url) === listingKey(url))
      : [];
    const matches = exactSku
      ? listingMatches.filter((row) => row.sku === exactSku)
      : [];
    const pendingMatches = url
      ? pendingRows.filter(
          (row) =>
            listingKey(row.url) === listingKey(url) &&
            (!exactSku || row.sku === exactSku)
        )
      : [];
    const topMembership = Object.fromEntries(
      SHOPPING_METRICS.map((metric) => [
        metric,
        {
          listingMatch: Object.entries(rankings)
            .filter(([, category]) =>
              category[metric].top.some((row) =>
                listingMatches.some((match) => match.offerId === row.offerId)
              )
            )
            .map(([category]) => category),
          exactSkuMatch: Object.entries(rankings)
            .filter(([, category]) =>
              category[metric].top.some((row) =>
                matches.some((match) => match.offerId === row.offerId)
              )
            )
            .map(([category]) => category),
        },
      ])
    );
    return {
      submittedIndex: index,
      submittedUrl,
      resolvedUrl: url,
      exactSku,
      matches,
      listingMatches,
      pendingMatches,
      topMembership,
      resolutionStatus: matches.length
        ? 'captured'
        : pendingMatches.length
          ? 'captured-unpriced-or-unconfirmed'
          : persisted?.status === 'captured'
            ? 'captured-outside-target-scope'
            : exactSku
              ? 'exact-sku-uncollected'
              : url
                ? 'listing-exact-sku-pending'
                : 'unresolved-or-unverified',
      sourceValidation:
        identity?.sourceValidation ||
        (identity ? 'exact-submitted-product-url' : null),
    };
  });
  return {
    submitted,
    totalSubmitted: input.length,
    resolvedWithPrices: submitted.filter((entry) => entry.matches.length)
      .length,
    pending: submitted.filter((entry) => !entry.matches.length),
    membershipCounts: Object.fromEntries(
      SHOPPING_METRICS.map((metric) => [
        metric,
        {
          submittedListingMatches: submitted.filter(
            (entry) => entry.topMembership[metric].listingMatch.length
          ).length,
          submittedExactSkuMatches: submitted.filter(
            (entry) => entry.topMembership[metric].exactSkuMatch.length
          ).length,
          uniqueListingMatches: new Set(
            submitted
              .filter(
                (entry) => entry.topMembership[metric].listingMatch.length
              )
              .map((entry) => listingKey(entry.resolvedUrl))
          ).size,
          uniqueExactSkuMatches: new Set(
            submitted
              .filter(
                (entry) => entry.topMembership[metric].exactSkuMatch.length
              )
              .map((entry) => entry.exactSku)
          ).size,
        },
      ])
    ),
    gramPricePending: submitted.flatMap((entry) =>
      entry.matches
        .filter(
          (row) => !Number.isFinite(row.metrics.costPerGramBeforeDelivery)
        )
        .map((row) => ({
          submittedIndex: entry.submittedIndex,
          submittedUrl: entry.submittedUrl,
          ...row,
        }))
    ),
    sortedByGramPrice: submitted
      .flatMap((entry) =>
        entry.matches
          .filter((row) =>
            Number.isFinite(row.metrics.costPerGramBeforeDelivery)
          )
          .map((row) => ({
            submittedIndex: entry.submittedIndex,
            submittedUrl: entry.submittedUrl,
            ...row,
          }))
      )
      .sort(
        (a, b) =>
          (a.metrics.costPerGramBeforeDelivery ?? Infinity) -
            (b.metrics.costPerGramBeforeDelivery ?? Infinity) ||
          a.submittedIndex - b.submittedIndex
      ),
  };
}

function checkoutRows(observations, quantity) {
  return observations
    .filter(
      (entry) =>
        entry.metrics &&
        entry.quote.lines.length === 1 &&
        entry.quote.lines[0].quantity === quantity &&
        entry.lines?.length === 1
    )
    .map((entry) => {
      const line = entry.lines[0];
      const row = reportRow({
        ...line,
        eligible: entry.eligible,
        problems: entry.problems,
        metrics: { ...line.metrics, ...entry.metrics, quantity },
      });
      return {
        ...row,
        observedAt: entry.quote.observedAt,
        price: entry.quote.lines[0].unitPrice,
        observationKind: 'exact-single-item-checkout',
        checkoutQuoteId: entry.quote.id,
        shippingQuantity: quantity,
        coldChainConfirmed: entry.quote.coldChainConfirmed,
        promotions: entry.quote.appliedDiscounts,
        evidenceIds: [...new Set([...row.evidenceIds, entry.quote.evidenceId])],
      };
    });
}

function basketReport(observation) {
  const metrics = observation.metrics ? { ...observation.metrics } : null;
  const allIce =
    observation.lines?.length === observation.quote.lines.length &&
    observation.lines.every(
      (line) => line.product.category === 'chocolate-ice-cream'
    );
  if (metrics && !allIce) {
    metrics.totalVolumeMl = null;
    metrics.costPerMlBeforeDelivery = null;
    metrics.costPerMlAfterDelivery = null;
  }
  return {
    quoteId: observation.quote.id,
    observedAt: observation.quote.observedAt,
    deliveryArea: observation.quote.deliveryArea,
    currency: observation.quote.currency,
    lines: observation.quote.lines,
    eligible: observation.eligible,
    coldChainConfirmed: observation.quote.coldChainConfirmed,
    appliedDiscounts: observation.quote.appliedDiscounts,
    metrics,
    problems: observation.problems,
    evidenceId: observation.quote.evidenceId,
    scope: 'exact-captured-basket-no-per-item-shipping-allocation',
  };
}

export async function buildShoppingReport(application, options = {}) {
  const quantities = options.quantities || [options.quantity || 1];
  const limit = positive(options.limit ?? 10, 'top limit', { integer: true });
  if (
    !Array.isArray(quantities) ||
    !quantities.length ||
    quantities.length > 100 ||
    limit > 1000
  ) {
    throw new Error('Bounded explicit report quantities required');
  }
  const aliases = await validatedHandpickedLinks(application);
  const supplied = options.handpicked || [];
  if (!Array.isArray(supplied) || supplied.length > 1000) {
    throw new Error('Handpicked report submissions require a bounded array');
  }
  const handpicked = [...supplied];
  const suppliedUrls = new Set(
    supplied.map((entry) =>
      typeof entry === 'string' ? entry : entry.submittedUrl || entry.url
    )
  );
  for (const alias of aliases) {
    if (!suppliedUrls.has(alias.submittedUrl)) {
      handpicked.push({ submittedUrl: alias.submittedUrl });
    }
  }
  const basketComparison = await application.compareBaskets({
    deliveryArea: options.deliveryArea || application.deliveryArea,
    flavourScope: 'chocolate-or-unflavoured',
    allowStale: options.allowStale === true,
  });
  const reports = [];
  for (const quantity of quantities) {
    positive(quantity, 'quantity', { integer: true });
    const comparison = await application.compare({
      quantity,
      deliveryArea: options.deliveryArea || application.deliveryArea,
      flavourScope: 'chocolate-or-unflavoured',
      allowStale: options.allowStale === true,
    });
    const accepted = (row) =>
      row.offer.variantConfirmed === true &&
      /^\d+_VNAMZ-\d+$/u.test(row.offer.sku || '') &&
      Number.isFinite(row.offer.price) &&
      row.offer.price > 0 &&
      !row.offer.priceInvalidated &&
      row.offer.available !== false &&
      !isShakerBundle(row.product) &&
      productFlavour(row.product) !== 'other';
    const rows = [
      ...comparison.comparisons.filter(accepted).map(reportRow),
      ...checkoutRows(basketComparison.observations, quantity),
    ];
    const pendingRows = comparison.comparisons
      .filter((row) => !accepted(row))
      .map(reportRow);
    const groups = {};
    for (const category of [
      'whey',
      'chocolate-ice-cream',
      'soy',
      'mixed-protein',
    ]) {
      groups[category] = rankCategory(
        rows.filter((row) => row.category === category),
        limit
      );
    }
    reports.push({
      quantity,
      rows,
      pendingRows,
      rankings: groups,
      handpicked: handpickedReport(
        handpicked,
        rows,
        pendingRows,
        groups,
        aliases
      ),
      assumptions: comparison.assumptions,
    });
  }
  return {
    schemaVersion: 1,
    kind: 'shopping-report',
    generatedAt: new Date().toISOString(),
    market: application.market,
    currency: application.currency,
    deliveryArea: options.deliveryArea || application.deliveryArea,
    reports,
    baskets: basketComparison.observations.map(basketReport),
    basketCoverage: basketComparison.assumptions,
    coverage: await application.audit(),
    codeValidation: 'draft-untested',
    allTargetProductsCollected: false,
    allRequirementsDelivered: false,
    purchaseReady: false,
  };
}

const number = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : '—';
const cell = (value) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/[\r\n]+/gu, ' ');

function basketReportLines(baskets) {
  const lines = [];
  lines.push(
    '## Exact captured basket quotes',
    '',
    'Mixed baskets retain their own complete freight and discounts. Their shipping is not assigned to individual products.',
    '',
    '| Quote | Captured UTC | Lines | Food g | ml | Protein g | VND before | VND after | VND/g before | VND/g after | VND/ml before | VND/ml after | VND/protein g before | VND/protein g after | Qualified |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
  );
  for (const basket of baskets) {
    const metrics = basket.metrics || {};
    lines.push(
      `| ${[
        cell(basket.quoteId),
        basket.observedAt,
        cell(
          basket.lines
            .map((line) => `${line.sku} × ${line.quantity}`)
            .join('; ')
        ),
        number(metrics.totalMassG),
        number(metrics.totalVolumeMl),
        number(metrics.totalProteinG),
        number(metrics.totalBeforeDelivery),
        number(metrics.totalAfterDelivery),
        ...SHOPPING_METRICS.map((field) => number(metrics[field])),
        basket.eligible ? 'Yes' : cell(basket.problems.join('; ')),
      ].join(' | ')} |`
    );
  }
  lines.push('');
  return lines;
}

export function shoppingReportMarkdown(report) {
  const lines = [
    '# Cached shopping comparisons',
    '',
    `Generated ${report.generatedAt}. ${report.market}, ${report.currency}, ${report.deliveryArea}.`,
    '',
    'Original price timestamps remain authoritative. Missing or disputed quantities and freight are never estimated.',
    '',
    '**Draft implementation; tests deferred. Collection and purchase acceptance remain incomplete.**',
    '',
  ];
  for (const set of report.reports) {
    for (const [category, rankings] of Object.entries(set.rankings)) {
      for (const [metric, ranking] of Object.entries(rankings)) {
        lines.push(
          `## ${category} / quantity ${set.quantity} / ${metric}`,
          '',
          '| Rank | Product | Captured UTC | Food g | ml | Protein g | VND before | VND after | VND/g before | VND/g after | VND/ml before | VND/ml after | VND/protein g before | VND/protein g after | Factory matched |',
          '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
        );
        ranking.top.forEach((row, index) =>
          lines.push(
            `| ${[
              index + 1,
              `[${cell(row.title)}](${row.url})`,
              row.observedAt,
              number(row.quantities.foodG),
              number(row.quantities.ml),
              number(row.quantities.proteinG),
              ...Object.values(row.metrics).map(number),
              row.manufacturerVerified ? 'Yes' : 'Pending',
            ].join(' | ')} |`
          )
        );
        lines.push(
          '',
          `${ranking.rankedCount} sortable captured observations; ${ranking.missing.length} require this denominator.`,
          ''
        );
      }
    }
    lines.push(
      `## Handpicked / quantity ${set.quantity}`,
      '',
      '| Submitted link | Exact captured SKU | Food g | ml | Protein g | VND before | VND after | VND/g before | VND/g after | VND/ml before | VND/ml after | VND/protein g before | VND/protein g after | Resolution |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'
    );
    set.handpicked.sortedByGramPrice.forEach((row) =>
      lines.push(
        `| ${[
          cell(row.submittedUrl),
          row.sku,
          number(row.quantities.foodG),
          number(row.quantities.ml),
          number(row.quantities.proteinG),
          ...Object.values(row.metrics).map(number),
          'Captured',
        ].join(' | ')} |`
      )
    );
    lines.push(
      '',
      '### Pending handpicked identities, prices and denominators',
      '',
      '| Submitted link | Resolved exact SKU | State | Source or extraction problems |',
      '| --- | --- | --- | --- |'
    );
    set.handpicked.pending.forEach((entry) =>
      lines.push(
        `| ${[
          cell(entry.submittedUrl),
          entry.exactSku || '—',
          entry.resolutionStatus,
          cell(
            entry.pendingMatches.flatMap((row) => row.problems).join('; ') ||
              'Exact selected source or scoped price remains uncollected'
          ),
        ].join(' | ')} |`
      )
    );
    set.handpicked.gramPricePending.forEach((row) =>
      lines.push(
        `| ${[
          cell(row.submittedUrl),
          row.sku || '—',
          'Captured price; gram denominator pending',
          cell(row.problems.join('; ')),
        ].join(' | ')} |`
      )
    );
    lines.push(
      '',
      '### Handpicked intersection with captured top rankings',
      '',
      'Listing membership may refer to another selling option. Exact SKU membership is recorded separately.',
      '',
      '| Metric | Submitted listing matches | Submitted exact SKU matches | Unique listings | Unique exact SKUs |',
      '| --- | ---: | ---: | ---: | ---: |'
    );
    for (const [metric, counts] of Object.entries(
      set.handpicked.membershipCounts
    )) {
      lines.push(
        `| ${[
          metric,
          counts.submittedListingMatches,
          counts.submittedExactSkuMatches,
          counts.uniqueListingMatches,
          counts.uniqueExactSkuMatches,
        ].join(' | ')} |`
      );
    }
    lines.push('');
  }
  lines.push(...basketReportLines(report.baskets || []));
  return `${lines.join('\n')}\n`;
}

export async function saveShoppingReport(application, report) {
  const { generatedAt, ...contents } = report;
  const fingerprint = sha256(JSON.stringify(contents));
  const id = `shopping-report:${fingerprint}`;
  const existing = await application.store.get('shopping-report', id);
  if (existing) {
    return existing;
  }
  const json = await application.store.putBlob(
    Buffer.from(JSON.stringify(report, null, 2))
  );
  const markdown = await application.store.putBlob(
    Buffer.from(shoppingReportMarkdown(report))
  );
  return application.store.put('shopping-report', {
    id,
    generatedAt,
    fingerprint,
    json,
    markdown,
    coverage: report.coverage,
    codeValidation: 'draft-untested',
    purchaseReady: false,
    publicSafe: application.store.visibility !== 'private',
  });
}
