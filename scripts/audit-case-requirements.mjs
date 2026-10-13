import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { latestCrawl } from '../src/crawl.js';
import { auditCoverage } from '../src/coverage.js';
import { scopeAccountAudit } from './account-category-scope.mjs';
import { matchesFlavourScope } from '../src/flavour-scope.js';
import { powderCategory } from './report-unit-costs.mjs';
import { requirementDraftStatus } from '../src/requirement-registry.js';
import { collectionAcceptanceGates } from './requirement-audit-gates.mjs';

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
const registry = requirementDraftStatus();
const issues = await json(registry.githubIssueSnapshot);
const sourceAcceptance = await json(registry.validationEvidence);
const stop = await json(
  'docs/acceptance/challenge-window-retention/saved-stop-status.json'
);
const independent = await json(
  'docs/acceptance/result-recheck/independent-ice-requirements.json'
);
await json('docs/drafts/requirements.json');
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
const historicalRequirements = [
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
const historicalOpenRequirements = historicalRequirements.filter(
  (row) =>
    row.status !== 'implemented' ||
    /partial|missing|unconfirmed|dependent|pending/u.test(
      row.realDataAcceptance
    )
);
const baselineById = new Map(
  historicalRequirements.map((row) => [row.id, row])
);
const independentById = new Map(
  independent.requirements.classifications.map((row) => [row.id, row])
);
if (
  independentById.size !== registry.requirements.length ||
  registry.requirements.some((row) => !independentById.has(row.id))
) {
  throw new Error(
    'Independent requirement recheck does not cover the complete current registry'
  );
}
const requirements = registry.requirements.map((row) => ({
  ...row,
  historicalAssessment: baselineById.get(row.id) || null,
  checkpointAssessment: independentById.get(row.id),
}));
const openRequirements = requirements.filter(
  (row) => row.checkpointAssessment.fulfilledAtCheckpoint !== true
);
const targetComparisons = catalog.comparisons.filter(
  (row) =>
    matchesFlavourScope(row.product, 'chocolate-or-unflavoured') &&
    (row.product.category === 'chocolate-ice-cream' ||
      powderCategory(row.product) === 'whey')
);
const gates = collectionAcceptanceGates({
  registry,
  issues,
  coverage,
  broad,
  active,
  ice,
  targetComparisons,
  stop,
});
const report = {
  schemaVersion: 2,
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
  purchaseReady: Object.values(gates).every(Boolean),
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
  requirements,
  mappedRequirements: registry.mappedRequirements,
  mappedGithubIssues: registry.mappedGithubIssues,
  openRequirements,
  independentRecheckObservedAt: independent.checkedAt,
  independentRecheckSourceCommit: independent.head,
  historicalOpenRequirements,
  historicalAcceptanceObservedAt: updates.checkedAt || review.auditedAt,
  sourceAcceptance: {
    sourceCommit: sourceAcceptance.sourceCommit,
    sourceAccepted: sourceAcceptance.sourceAccepted === true,
    evidence: registry.validationEvidence,
    scope:
      'Acceptance of the immutable source in this receipt; not new audit edits, live data or complete requirement delivery.',
  },
  collectionStop: stop,
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
    'All 49 requirements and current issues come from the registry. Historical per-requirement findings are preserved as dated baselines, not new acceptance.',
    'Current counts are recalculated from the published catalog; the audit date is not a product price refresh.',
    'Finite delivery totals require source-bound quantity and destination checks; even a passing structural check still needs independently verified originals.',
    'Unknown shipping, exact formula identity or ice-cream density is never replaced with estimates.',
  ],
};
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}/current.json`,
  await format(JSON.stringify(report), { parser: 'json' })
);
// A complete observed SKU inventory is scoped to the captured listing sources.
// Authoritative marketplace coverage has its own independent gate above.
const rows = Object.entries(gates)
  .map(([gate, passed]) => `| ${gate} | ${passed ? 'Passed' : 'Open'} |`)
  .join('\n');
const issueRows = report.githubIssues
  .map(
    (issue) =>
      `| [#${issue.number}](${issue.url}) | ${issue.title} | ${issue.state} |`
  )
  .join('\n');
const requirementRows = requirements
  .map(
    (row) =>
      `| ${row.id} | ${row.requirement} | ${row.checkpointAssessment.fulfilledAtCheckpoint ? 'Fulfilled at tested checkpoint' : 'Data/live outcome incomplete'} | ${row.checkpointAssessment.dataOrLiveGap || 'Implemented/tested mechanics or recorded operator procedure; future maintenance does not invalidate checkpoint acceptance.'} |`
  )
  .join('\n');
const body = `# Current requirements and collection acceptance\n\n**All requirements delivered: ${report.allRequirementsDelivered}. All target products collected: ${report.allTargetProductsCollected}. Production ready: ${report.productionReady}.**\n\nRecalculated offline at ${report.checkedAt}, from the published catalog observed at ${catalog.checkedAt}. No marketplace requests are made by this audit.\n\nThe active chocolate/plain whey and chocolate ice-cream case has **${active.missingListings.length} uncollected listings**, **${active.missingSkuPrices.length} unpriced SKU options**, and **${active.categoryReview.length} unresolved category observations**. ${report.activeScope.excludedCategoryListings} clearly identified hardware, animal-feed, non-frozen protein-bar or plant-only listings are excluded with their original titles, reasons and source pointers retained. Unknown and other-flavour listing titles remain pending because they can contain relevant sibling options.\n\n| Acceptance gate | Result |\n| --- | --- |\n${rows}\n\nThe SKU-inventory gate covers captured listing sources. Entire-market discovery remains a separate open gate; a passing captured-source inventory check does not establish exhaustive Lazada coverage.\n\n## GitHub issue inventory\n\nThis state is from the saved GitHub inventory, whose SHA-256 is recorded in [current.json](current.json). Re-run the inventory download before resolving an issue or interpreting a later state.\n\n| Issue | Requirement | State |\n| --- | --- | --- |\n${issueRows}\n\n## Complete requirement inventory\n\nAll ${requirements.length} requirements are mapped against ${issues.length} issues. Prior acceptance is a dated implementation baseline; the independent recheck below distinguishes delivered checkpoint behavior from missing real data/live outcomes. Implemented collection mechanics and passing fixture tests do not satisfy missing real product, label, translation or delivered-price evidence.\n\n| ID | Requirement | Prior baseline | External acceptance or ongoing maintenance |\n| --- | --- | --- | --- |\n${requirementRows}\n\n[Full implementation review](implementation-review.md) · [Independent cached-list and SKU review](coverage-review.md) · [Buying tables](../../tables/top-10-partial.md) · [Requirements](../../REQUIREMENTS.md) · [Roadmap](../../ROADMAP.md)\n\nThe two saved ice routes repeat the same mixed 386-item list; they are not two independent strict chocolate inventories. Public search has no authoritative all-market SKU inventory. Exact bulk freight, frozen Nha Trang delivery and manufacturer revision matches remain evidence requirements.\n`;
await writeFile(
  `${directory}/current.md`,
  await format(body, { parser: 'markdown' })
);
console.log(
  JSON.stringify({
    allRequirementsDelivered: report.allRequirementsDelivered,
    allTargetProductsCollected: report.allTargetProductsCollected,
    activeScope: report.activeScope,
    mappedRequirements: requirements.length,
    mappedGithubIssues: issues.length,
    openRequirements: openRequirements.length,
    historicalOpenRequirements: historicalOpenRequirements.length,
    openGithubIssues: issues.filter((issue) => issue.state !== 'CLOSED').length,
    downloads: 0,
  })
);
if (process.argv.includes('--strict') && !report.allRequirementsDelivered) {
  process.exitCode = 1;
}
