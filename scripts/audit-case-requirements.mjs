import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { latestCrawl } from '../src/crawl.js';
import { auditCoverage } from '../src/coverage.js';
import { scopeAccountAudit } from './account-category-scope.mjs';
import { matchesFlavourScope } from '../src/flavour-scope.js';
import { powderCategory } from './report-unit-costs.mjs';

const directory = 'docs/acceptance/requirements-audit';
const snapshots = [];
async function json(path) {
  const body = await readFile(path);
  const data = JSON.parse(body);
  snapshots.push({
    path,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
    observedAt:
      data.checkedAt ||
      data.generatedAt ||
      data.reviewedAt ||
      data.auditedAt ||
      null,
  });
  return data;
}
const catalog = await json('docs/tables/catalog.json');
const review = await json(`${directory}/implementation-review.json`);
const updates = await json(`${directory}/implementation-updates.json`).catch(
  (error) => {
    if (error.code === 'ENOENT') {
      return { requirements: [], additionalRequirements: [] };
    }
    throw error;
  }
);
const coverage = await json(`${directory}/coverage-review.json`);
const issues = await json(`${directory}/github-issues.json`);
const ice = await json('docs/tables/ice-unit-rankings.json');
const whey = await json('docs/acceptance/whey-verification/worklist.json');
const crawl = latestCrawl(catalog.crawls);
const broad = auditCoverage({ ...catalog, crawl });
const active = scopeAccountAudit(broad, {
  crawl,
  discoveries: catalog.discoveries,
  activeSourcesOnly: true,
  flavourScope: 'chocolate-or-unflavoured',
});
const counts = (audit) =>
  Object.fromEntries(
    [
      'missingListings',
      'missingSkuPrices',
      'missingPrices',
      'unknownSkuInventories',
      'categoryReview',
      'specifications',
    ].map((field) => [field, audit[field].length])
  );
const updatesById = new Map(updates.requirements.map((row) => [row.id, row]));
const requirements = [
  ...review.requirements.map((row) => ({
    ...row,
    ...updatesById.get(row.id),
  })),
  ...(updates.additionalRequirements || []),
].map((row) => ({
  id: row.id,
  requirement: row.requirement,
  status: row.status,
  mechanicsStatus: row.mechanicsStatus,
  realDataAcceptance: row.realDataAcceptance,
  evidence: row.evidence,
  finding: row.finding,
}));
const openRequirements = requirements.filter(
  (row) =>
    row.status !== 'implemented' ||
    /partial|missing|unconfirmed|dependent|pending/u.test(
      row.realDataAcceptance
    )
);
const targetComparisons = catalog.comparisons.filter(
  (row) =>
    matchesFlavourScope(row.product, 'chocolate-or-unflavoured') &&
    (row.product.category === 'chocolate-ice-cream' ||
      powderCategory(row.product) === 'whey')
);
const delivered = (row) =>
  row.metrics.totalAfterDelivery !== null &&
  row.offer.shippingQuantity === row.metrics.quantity &&
  (row.product.category !== 'chocolate-ice-cream' ||
    row.offer.coldChainConfirmed === true);
const gates = {
  authoritativeCategoryInventory:
    coverage.authoritativeCategoryInventoryCollected === true,
  visibleListsTerminal: broad.sourceListsComplete,
  allDiscoveredTargetListingsCaptured: active.missingListings.length === 0,
  allRelevantSkuPricesCaptured:
    active.missingSkuPrices.length === 0 && active.missingPrices.length === 0,
  allSkuInventoriesObserved: active.unknownSkuInventories.length === 0,
  allCategoryReviewsResolved: active.categoryReview.length === 0,
  allExactManufacturerSpecificationsVerified:
    active.specifications.length > 0 &&
    active.specifications.every((row) => row.problems.length === 0),
  iceMassVolumeAndProteinComplete:
    ice.rows.length > 0 &&
    ice.rows.every(
      (row) =>
        row.massG > 0 && row.volumeMl > 0 && Number.isFinite(row.proteinG)
    ),
  allCapturedTargetDeliveryQuotesExact:
    targetComparisons.length > 0 && targetComparisons.every(delivered),
  bulkDestinationQuotesCaptured: targetComparisons.some(
    (row) => row.offer.shippingQuantity > 1 && delivered(row)
  ),
  frozenNhaTrangDeliveryConfirmed: targetComparisons.some(
    (row) =>
      row.product.category === 'chocolate-ice-cream' &&
      row.offer.deliveryArea === 'Nha Trang' &&
      delivered(row)
  ),
  allRequirementsAccepted: openRequirements.length === 0,
  allGithubIssuesClosed:
    issues.length > 0 && issues.every((issue) => issue.state === 'CLOSED'),
};
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  catalogObservedAt: catalog.checkedAt,
  allRequirementsDelivered: Object.values(gates).every(Boolean),
  allTargetProductsCollected: [
    'authoritativeCategoryInventory',
    'allDiscoveredTargetListingsCaptured',
    'allRelevantSkuPricesCaptured',
    'allSkuInventoriesObserved',
    'allCategoryReviewsResolved',
  ].every((key) => gates[key]),
  productionReady: Object.values(gates).every(Boolean),
  gates,
  activeScope: {
    ...counts(active),
    verifiedProducts: active.verifiedProducts,
    excludedCategoryListings: active.excludedCategoryListings?.length || 0,
    excludedExactOptions: active.excludedFlavourTasks?.length || 0,
  },
  broaderArchive: {
    ...counts(broad),
    verifiedProducts: broad.verifiedProducts,
  },
  wheyCoverage: whey.counts,
  iceCoverage: ice.coverage,
  openRequirements,
  githubIssues: issues.map(({ number, title, state, url }) => ({
    number,
    title,
    state,
    url,
  })),
  snapshots,
  downloads: 0,
  caveats: [
    'Finished visible pagination does not establish an authoritative marketplace inventory.',
    'The independent implementation and coverage reviews are dated baselines; current counts are recalculated from the published catalog.',
    'Unknown shipping, exact formula identity or ice-cream density is never replaced with estimates.',
  ],
};
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}/current.json`,
  await format(JSON.stringify(report), { parser: 'json' })
);
const rows = Object.entries(gates)
  .map(([gate, passed]) => `| ${gate} | ${passed ? 'Passed' : 'Open'} |`)
  .join('\n');
const issueRows = report.githubIssues
  .map(
    (issue) =>
      `| [#${issue.number}](${issue.url}) | ${issue.title} | ${issue.state} |`
  )
  .join('\n');
const requirementRows = openRequirements
  .map(
    (row) => `| ${row.id} | ${row.requirement} | ${row.realDataAcceptance} |`
  )
  .join('\n');
const body = `# Current requirements and collection acceptance\n\n**All requirements delivered: ${report.allRequirementsDelivered}. All target products collected: ${report.allTargetProductsCollected}. Production ready: ${report.productionReady}.**\n\nRecalculated offline at ${report.checkedAt}, from the published catalog observed at ${catalog.checkedAt}. No marketplace requests are made by this audit.\n\nThe active chocolate/plain whey and chocolate ice-cream case has **${active.missingListings.length} uncollected listings**, **${active.missingSkuPrices.length} unpriced SKU options**, and **${active.categoryReview.length} unresolved category observations**. ${report.activeScope.excludedCategoryListings} clearly identified hardware, animal-feed, non-frozen protein-bar or plant-only listings are excluded with their original titles, reasons and source pointers retained. Unknown and other-flavour listing titles remain pending because they can contain relevant sibling options.\n\n| Acceptance gate | Result |\n| --- | --- |\n${rows}\n\n## GitHub issue inventory\n\nThis state is from the saved GitHub inventory, whose SHA-256 is recorded in [current.json](current.json). Re-run the inventory download before resolving an issue or interpreting a later state.\n\n| Issue | Requirement | State |\n| --- | --- | --- |\n${issueRows}\n\n## Outstanding requirement acceptance\n\nImplemented collection mechanics and passing fixture tests do not satisfy missing real product, label, translation or delivered-price evidence.\n\n| ID | Requirement | Remaining acceptance |\n| --- | --- | --- |\n${requirementRows}\n\n[Full implementation review](implementation-review.md) · [Independent cached-list and SKU review](coverage-review.md) · [Buying tables](../../tables/top-10-partial.md) · [Requirements](../../REQUIREMENTS.md) · [Roadmap](../../ROADMAP.md)\n\nThe two saved ice routes repeat the same mixed 386-item list; they are not two independent strict chocolate inventories. Public search has no authoritative all-market SKU inventory. Exact bulk freight, frozen Nha Trang delivery and manufacturer revision matches remain evidence requirements.\n`;
await writeFile(
  `${directory}/current.md`,
  await format(body, { parser: 'markdown' })
);
console.log(
  JSON.stringify({
    allRequirementsDelivered: report.allRequirementsDelivered,
    allTargetProductsCollected: report.allTargetProductsCollected,
    activeScope: report.activeScope,
    openRequirements: openRequirements.length,
    openGithubIssues: issues.filter((issue) => issue.state !== 'CLOSED').length,
    downloads: 0,
  })
);
if (process.argv.includes('--strict') && !report.allRequirementsDelivered) {
  process.exitCode = 1;
}
