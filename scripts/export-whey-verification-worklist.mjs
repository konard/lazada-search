import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { format, resolveConfig } from 'prettier';
import { AssociativeStore } from '../src/store.js';
import { DEFAULT_ARCHIVE } from '../src/archive.js';
import { categoryOf } from '../src/nutrition.js';
import { productFlavour, isShakerBundle } from '../src/flavour-scope.js';
import { manufacturerCandidates } from '../src/manufacturers.js';
import { specificationProblems } from '../src/verification.js';
import { listingKey, sha256 } from '../src/util.js';
import { powderCategory, reportUnitCosts } from './report-unit-costs.mjs';

const powderCategories = new Set(['whey', 'protein-powder']);
const skuNumber = (sku) =>
  String(sku || '')
    .split('_VNAMZ-')
    .at(-1);
const identityKey = (url, sku) => `${listingKey(url)}:${skuNumber(sku)}`;
const isPowder = (record) =>
  powderCategories.has(record.category) ||
  powderCategories.has(categoryOf(record.title || ''));
const selectedOptions = (product) => [
  ...new Set((product.selectedVariant || []).map((option) => option.text)),
];
const sourcePointer = (record) => ({
  id: record.id,
  role: record.role,
  url: record.url,
  observedAt: record.observedAt,
  fetchedAt: record.fetchedAt,
  status: record.status,
  html: record.html,
  screenshot: record.screenshot,
  image: record.image,
});
const nullable = (record, field) => record?.[field] ?? null;

function capturedScope(product, flavour) {
  const shakerOption = isShakerBundle(product);
  return {
    scopeEligible:
      powderCategories.has(product.category) &&
      ['chocolate', 'unflavoured'].includes(flavour) &&
      !shakerOption,
    scopeExclusion: !powderCategories.has(product.category)
      ? 'Normalized category is outside powder scope; retain evidence without promoting the title.'
      : shakerOption
        ? 'Selected selling option includes a shaker; title-only free-gift advertising is not counted as an option.'
        : flavour === 'other'
          ? 'Selected or exact reviewed flavour is outside chocolate/plain.'
          : null,
  };
}

function captureTasks(flavour, problems, offer, costs, candidates) {
  const tasks = [];
  if (
    !offer?.variantConfirmed ||
    !(offer?.price > 0) ||
    offer.priceInvalidated
  ) {
    tasks.push('capture-exact-selected-sku-price');
  }
  if (flavour === 'unknown') {
    tasks.push('verify-selected-flavour');
  }
  if (problems.length) {
    tasks.push('match-exact-factory-package-and-formula');
  }
  if (!candidates.some((candidate) => !candidate.brandConflict)) {
    tasks.push('identify-manufacturer-from-original-package');
  }
  if (!costs?.deliveryQuoteMatched) {
    tasks.push('quote-exact-quantity-to-Nha-Trang');
  }
  return tasks;
}

function capturedRow(product, offers, deliveryArea) {
  const offer = offers
    .filter((entry) => entry.productId === product.id && !entry.supersededBy)
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt)
    )[0];
  const flavour = productFlavour(product);
  const problems = specificationProblems(product);
  if (product.specificationsInvalidated) {
    problems.push(
      'Source specifications invalidated; recollect before factory approval'
    );
  }
  const candidates = manufacturerCandidates(product);
  const costs = offer
    ? reportUnitCosts({ product, offer }, { deliveryArea })
    : null;
  return {
    productId: product.id,
    listingKey: listingKey(product.url),
    url: product.url,
    sku: nullable(product, 'sku'),
    title: product.title,
    brand: product.brand,
    proteinSource: powderCategory(product),
    flavour,
    selectedOptions: selectedOptions(product),
    ...capturedScope(product, flavour),
    netMassG: nullable(product, 'netMassG'),
    packCount: nullable(product, 'packCount'),
    denominatorAuthority: problems.length
      ? 'captured normalized seller observation; factory approval pending'
      : 'exact matched manufacturer',
    manufacturerVerified: problems.length === 0,
    manufacturerVerification: nullable(product, 'manufacturerVerification'),
    manufacturerCandidates: candidates,
    manufacturerProblems: problems,
    observedAt: product.observedAt,
    price: nullable(offer, 'price'),
    priceObservedAt: nullable(offer, 'observedAt'),
    available: nullable(offer, 'available'),
    priceVariantConfirmed: nullable(offer, 'variantConfirmed') === true,
    originalPrice: nullable(offer, 'originalPrice'),
    costs,
    tasks: captureTasks(flavour, problems, offer, costs, candidates),
    evidenceIds: [
      ...new Set(
        [...(product.evidenceIds || []), offer?.evidenceId].filter(Boolean)
      ),
    ],
    sourcedClaims: (product.claims || []).map((claim) => ({
      field: claim.field,
      value: claim.value,
      source: claim.source,
      evidenceId: claim.evidenceId,
      sourceEvidenceId: claim.sourceEvidenceId,
      reviewId: claim.reviewId,
      requiresReview: claim.requiresReview,
      excerpt: claim.excerpt,
    })),
  };
}

function inventorySkuTask(inventory, sku, category, key) {
  const selectedVariant = (sku.options || []).map((option) => ({
    text: option.value,
  }));
  // Only SKU options prove a preliminary exclusion; listing-title flavour
  // advertising may mention another flavour or every available sibling.
  const flavour = productFlavour({ category, selectedVariant });
  const shaker = isShakerBundle({ selectedVariant });
  return {
    taskId: `selected-sku:${key}`,
    listingKey: listingKey(inventory.url),
    url: sku.url || inventory.url,
    sku: sku.sku,
    options: sku.options || [],
    available: sku.available ?? null,
    flavour,
    status:
      flavour === 'other' || shaker
        ? 'out-of-scope-selected-option'
        : 'pending',
    sourceCacheId: inventory.cacheId,
    observedAt: inventory.observedAt,
    requiredAction:
      flavour === 'unknown'
        ? 'inspect-exact-sku-flavour-before-price-ranking'
        : 'capture-exact-sku-price-and-labels',
    exclusionReason: shaker
      ? 'selected-shaker-option'
      : flavour === 'other'
        ? 'selected-other-flavour'
        : null,
  };
}

function listingTasks(catalog, products) {
  const known = new Set(products.map((product) => listingKey(product.url)));
  const groups = new Map();
  for (const discovery of catalog.discoveries || []) {
    if (discovery.classification === 'quarantined') {
      continue;
    }
    const key = listingKey(discovery.url);
    if (!groups.has(key)) {
      groups.set(key, {
        listingKey: key,
        url: discovery.url,
        titles: new Set(),
        references: new Map(),
        powder: false,
        uncertainCategory: false,
      });
    }
    const group = groups.get(key);
    group.titles.add(discovery.title);
    group.powder ||= isPowder(discovery);
    group.uncertainCategory ||=
      discovery.classification === 'needs-category-review';
    group.references.set(discovery.id, {
      discoveryId: discovery.id,
      sourceUrl: discovery.sourceUrl,
      cacheId: discovery.cacheId,
      query: discovery.query,
      observedAt: discovery.observedAt,
    });
  }
  return [...groups.values()]
    .filter(
      (group) =>
        (group.powder && !known.has(group.listingKey)) ||
        group.uncertainCategory
    )
    .map((group) => ({
      taskId: `${group.powder ? 'powder-inventory' : 'category-review'}:${group.listingKey}`,
      listingKey: group.listingKey,
      url: group.url,
      stage: group.powder
        ? 'collect-listing-and-all-selling-options'
        : 'review-category-before-filtering',
      titles: [...group.titles],
      sourceReferences: [...group.references.values()],
      status: 'pending',
      flavourExcluded: false,
      reason:
        'A listing title cannot rule out chocolate/plain sibling SKUs; uncertain categories require resumable review.',
    }));
}

function uncapturedSkuTasks(catalog, products) {
  const captured = new Map(
    products.map((product) => [identityKey(product.url, product.sku), product])
  );
  const known = new Map(
    products.map((product) => [listingKey(product.url), product])
  );
  const tasks = new Map();
  for (const inventory of catalog.skuInventories || []) {
    const listing = known.get(listingKey(inventory.url));
    if (!listing || !isPowder(listing)) {
      continue;
    }
    for (const sku of inventory.skus || []) {
      const key = identityKey(sku.url || inventory.url, sku.sku);
      if (captured.has(key)) {
        continue;
      }
      tasks.set(key, inventorySkuTask(inventory, sku, listing.category, key));
    }
  }
  return [...tasks.values()];
}

export function buildWheyVerificationWorklist(
  catalog,
  {
    input,
    generatedAt = new Date().toISOString(),
    sources = [],
    authoritySources = [],
  } = {}
) {
  const products = (catalog.products || []).filter(isPowder);
  const rows = products.map((product) =>
    capturedRow(
      product,
      catalog.offers || [],
      catalog.deliveryArea || 'Nha Trang'
    )
  );
  rows.sort(
    (left, right) =>
      (left.costs?.beforePerFoodGram ?? Infinity) -
        (right.costs?.beforePerFoodGram ?? Infinity) ||
      String(left.sku).localeCompare(String(right.sku))
  );
  const discoveries = listingTasks(catalog, products);
  const skuTasks = uncapturedSkuTasks(catalog, products);
  const evidenceIds = new Set(rows.flatMap((row) => row.evidenceIds));
  const cacheIds = new Set(
    [
      ...discoveries.flatMap((task) =>
        task.sourceReferences.map((source) => source.cacheId)
      ),
      ...skuTasks.map((task) => task.sourceCacheId),
    ].filter(Boolean)
  );
  const pointers = sources
    .filter((source) => evidenceIds.has(source.id) || cacheIds.has(source.id))
    .map(sourcePointer);
  return {
    schemaVersion: 1,
    generatedAt,
    input,
    catalogCheckedAt: catalog.checkedAt,
    market: catalog.market,
    deliveryArea: catalog.deliveryArea,
    scope:
      'Chocolate/plain whey; soy and mixed powders classified separately. Listing discovery never excludes flavour siblings by title.',
    assumptions: {
      quantity: 1,
      currentPriceGuarantee: false,
      wholeMarketCoverageGuarantee: false,
      densityConversions: 0,
      sharedStoreWrites: 0,
      networkRequests: 0,
    },
    counts: {
      capturedPowderSkus: rows.length,
      strictWheySkus: rows.filter(
        (row) => row.proteinSource === 'whey' && row.scopeEligible
      ).length,
      strictSoySkus: rows.filter(
        (row) => row.proteinSource === 'soy' && row.scopeEligible
      ).length,
      verifiedStrictWheySkus: rows.filter(
        (row) =>
          row.proteinSource === 'whey' &&
          row.scopeEligible &&
          row.manufacturerVerified
      ).length,
      missingFactoryMatches: rows.filter(
        (row) => row.scopeEligible && !row.manufacturerVerified
      ).length,
      discoveryTasks: discoveries.length,
      pendingSkuTasks: skuTasks.filter((task) => task.status === 'pending')
        .length,
      excludedSkuOptions: skuTasks.filter((task) => task.status !== 'pending')
        .length,
      originalSourcePointers: pointers.length,
      unresolvedEvidencePointers: [...evidenceIds].filter(
        (id) => !pointers.some((source) => source.id === id)
      ).length,
    },
    capturedSkus: rows,
    discoveryTasks: discoveries,
    uncapturedSkuTasks: skuTasks,
    originalSourcePointers: pointers,
    factoryBrandAuthoritySources: authoritySources,
  };
}

async function cachedFactoryAuthoritySources() {
  const directory = 'docs/acceptance/urgent-whey-reviews';
  const receipts = [
    'factory-lead-sources/nutrabolics-hydropure-current-product.json',
    'low-price-sources/warrior-whey.json',
    'low-price-sources/mutant-whey.json',
    'low-price-sources/ostrovit-wpc80-natural-700g.json',
  ];
  const results = await Promise.allSettled(
    receipts.map(async (file) => {
      const path = join(directory, file);
      const receipt = JSON.parse(await readFile(path, 'utf8'));
      const artifact = join(dirname(path), receipt.filename);
      const original = await readFile(artifact);
      const bytes =
        receipt.encoding === 'gzip' ? gunzipSync(original) : original;
      if (sha256(bytes) !== receipt.sha256 || receipt.status !== 200) {
        throw new Error(
          `Cached factory authority source failed verification: ${path}`
        );
      }
      return {
        receipt: path,
        artifact,
        sourceUrl: receipt.url,
        observedAt: receipt.observedAt,
        sourceSha256: receipt.sha256,
        originalBytes: bytes.length,
        digestMatched: true,
        approvalScope:
          'manufacturer domain candidate only; exact seller package and formula still require review',
      };
    })
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason;
    }
  }
  return results.map((result) => result.value);
}

function requirementsMarkdown(report) {
  const count = report.counts;
  return `# Whey verification requirements and resumable evidence worklist\n\nGenerated ${report.generatedAt} from the public catalog snapshot observed ${report.catalogCheckedAt}. Source SHA256: \`${report.input.sha256}\`. This is an offline evidence audit; source prices are timestamped observations.\n\n| Requirement | Evidence and current state |\n|---|---|\n| Chocolate/plain whey; soy separately | ${count.strictWheySkus} scoped whey SKUs; ${count.strictSoySkus} scoped soy SKUs. Reviewed protein ingredients distinguish the sources; soy lecithin is not soy protein. |\n| Exact manufacturer package and formula | ${count.verifiedStrictWheySkus} strict whey SKUs have all required sourced specifications; ${count.missingFactoryMatches} scoped powder SKUs still need an exact factory match. Each captured row retains field claims, original evidence IDs and matching problems. |\n| Complete selling-option inventory | ${count.discoveryTasks} listing/category tasks and ${count.pendingSkuTasks} uncaptured SKU tasks remain. Vanilla listing titles never exclude chocolate/plain siblings. Known other flavours and selected shaker options remain documented separately. |\n| Food and protein denominators | Each priced row carries package count, declared mass and separate food/protein costs. Pending factory denominators remain explicit seller observations; shaker millilitres and guessed densities are excluded. |\n| Delivery | Quotes must match Nha Trang and quantity1 for this snapshot; bulk orders require a newly matched quantity quote. |\n| Manufacturer source trust | Four cached primary brands were added: Nutrabolics, Warrior, Mutant and OstroVit. Whole-word aliases reject unrelated names; URLs with credentials or unsupported schemes are rejected. A trusted domain supplies a candidate, never exact identity by itself. |\n| Flavour correctness | Tests reject selected-SKU/factory contradictions, another official flavour’s label, generic natural-flavour marketing, and ice cream where chocolate is only a coating or the core is explicitly white/nonchocolate. |\n| Library/CLI/HTTP/Telegram | Shared comparison options support strict flavour scope. Existing end-to-end tests exercise offline comparison and Telegram delivery across all rows. Collection commands route through the shared application/crawl; the root-owned CAPTCHA guard must stop subsequent requests across interface invocations. |\n| Source preservation and zero repeated collection | ${count.originalSourcePointers} original cache/evidence pointers are retained; ${count.unresolvedEvidencePointers} pointers are explicitly unresolved. The producer reads public snapshots/cache only, makes0 requests and0 shared-store writes, and can be rerun after collection without re-downloading products. |\n\n[Structured worklist](worklist.json) contains every captured powder SKU, manufacturer source candidates, source field claims, pending exact identities, and all resumable discovery/SKU tasks. Manufacturer specification completeness does not establish seller authenticity. Availability and price age must be refreshed before ordering.\n\nRebuild after the root publishes a fresh catalog:\n\n\`\`\`sh\nnode scripts/export-whey-verification-worklist.mjs docs/tables/catalog.json\n\`\`\`\n\nRelevant checks: \`tests/flavour-scope.test.js\`, \`tests/manufacturer-owned-brands.test.js\`, \`tests/browser-import-review.test.js\`, \`tests/whey-verification-worklist.test.js\`, \`tests/e2e/flavour-scope.test.js\`, \`tests/e2e/telegram.test.js\`, and \`tests/e2e/verified-case.test.js\`.\n`;
}

async function main() {
  const inputPath = process.argv[2] || 'docs/tables/catalog.json';
  const bytes = await readFile(inputPath);
  const store = new AssociativeStore({ archive: DEFAULT_ARCHIVE });
  const results = await Promise.allSettled([
    store.list('evidence'),
    store.list('cache'),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason;
    }
  }
  const report = buildWheyVerificationWorklist(JSON.parse(bytes), {
    input: { path: inputPath, sha256: sha256(bytes), bytes: bytes.length },
    sources: results.flatMap((result) => result.value),
    authoritySources: await cachedFactoryAuthoritySources(),
  });
  const output = 'docs/acceptance/whey-verification/worklist.json';
  await mkdir(dirname(output), { recursive: true });
  const outputStyle = await resolveConfig(output);
  await writeFile(
    output,
    await format(JSON.stringify(report), { ...outputStyle, parser: 'json' })
  );
  const md = join(dirname(output), 'requirements.md');
  const style = await resolveConfig(md);
  await writeFile(
    md,
    await format(requirementsMarkdown(report), { ...style, parser: 'markdown' })
  );
  console.log(JSON.stringify(report.counts));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
