import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LazadaSearch, DomainScheduler } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import {
  runAccountCase,
  reuseAccountDiscovery,
} from './account-case-workflow.mjs';
import { latestCrawl } from '../src/crawl.js';
import { scopeAccountAudit } from './account-category-scope.mjs';
import {
  accountBacklogFlags,
  orderAccountBacklog,
} from './account-backlog-order.mjs';
import { attemptedCollectionUrls } from './account-collection-attempts.mjs';
import { canonicalUrl } from '../src/text.js';
import { persistScopeDecisions } from '../src/scope-decisions.js';

const options = parseArguments(process.argv.slice(2));
options.account ||= 'default';
const sharedFlags = [
  '--data-dir',
  options.dataDir,
  '--archive-dir',
  options.archiveDir,
  '--market',
  options.market,
  '--delivery-area',
  options.deliveryArea,
];
const accountFlags = ['--account', options.account, ...sharedFlags];
const collectionFlags = [
  ...accountFlags,
  '--exhaustive',
  '--interval-ms',
  String(Math.max(60000, options.intervalMs)),
  '--max-images',
  String(options.maxImages),
  '--ocr-languages',
  options.ocrLanguages,
  ...(options.ocr ? [] : ['--no-ocr']),
  ...accountBacklogFlags(options),
  '--search-sort',
  options.searchSort,
];
if (options.ocrDataDir) {
  collectionFlags.push('--ocr-data-dir', options.ocrDataDir);
}
for (const query of options.query || []) {
  collectionFlags.push('--query', query);
}
for (const url of options.categoryUrl || []) {
  collectionFlags.push('--category-url', url);
}
const store = configuredStore(options);
const reportId = `account-case:${new Date().toISOString()}`;

async function run(name, flags) {
  await store.put('case-run', {
    id: reportId,
    phase: name,
    updatedAt: new Date().toISOString(),
  });
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL(name, import.meta.url)), ...flags],
      { stdio: 'inherit' }
    );
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name} stopped: ${signal || code}`))
    );
  });
}

async function audit() {
  const app = new LazadaSearch({
    store,
    offline: true,
    ocr: false,
    market: options.market,
    deliveryArea: options.deliveryArea,
  });
  try {
    const latest = latestCrawl(await store.list('crawl'));
    const scoped = scopeAccountAudit(await app.audit(), {
      categoryOnly: options.categoryOnly,
      flavourScope: options.flavourScope,
      activeSourcesOnly: true,
      crawl: latest,
      discoveries: await store.list('discovery'),
    });
    const attempted = new Set(await attemptedCollectionUrls(store, options));
    await persistScopeDecisions(store, scoped, {
      flavourScope: options.flavourScope,
    });
    const urls = orderAccountBacklog(scoped);
    const result = {
      ...scoped,
      collectableUrls: urls.filter((url) => !attempted.has(canonicalUrl(url))),
      deferredUrls: urls.filter((url) => attempted.has(canonicalUrl(url))),
      discoveryComplete: latest?.discoveryComplete === true,
    };
    await writeFile(
      'docs/acceptance/collection-progress.json',
      `${JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          market: options.market,
          deliveryArea: options.deliveryArea,
          flavourScope: options.flavourScope,
          minimumIntervalMs: Math.max(60000, options.intervalMs),
          discoveryComplete: result.discoveryComplete,
          scopes: latest?.scopes || [],
          collectableUrls: result.collectableUrls,
          deferredUrls: result.deferredUrls,
          missingListings: result.missingListings,
          missingSkuPrices: result.missingSkuPrices,
          categoryReview: result.categoryReview,
          excludedCategoryListings: result.excludedCategoryListings || [],
          excludedFlavourTasks: result.excludedFlavourTasks || [],
          unavailableListings: result.unavailableListings || [],
          stop:
            (await store.get('collection-stop', 'browser-collection'))
              ?.active === true,
          purchaseReady: false,
        },
        null,
        2
      )}\n`
    );
    return result;
  } finally {
    await app.close();
  }
}

async function publish() {
  await run('publish-account-captures.mjs', [
    ...accountFlags,
    '--offline',
    '--no-ocr',
  ]);
  await run('export-catalog-tables.mjs', [
    ...sharedFlags,
    '--offline',
    '--no-ocr',
  ]);
  await run('export-deadline-report.mjs', [
    ...sharedFlags,
    '--offline',
    '--no-ocr',
  ]);
  await run('export-handpicked-report.mjs', [
    ...sharedFlags,
    '--offline',
    '--no-ocr',
  ]);
  await run('export-ice-unit-report.mjs', []);
  await run('export-whey-verification-worklist.mjs', [
    'docs/tables/catalog.json',
  ]);
  await run('archive-case.mjs', [...sharedFlags, '--offline', '--no-ocr']);
  await run('../bin/lazada-search.js', [
    'archive-verify',
    ...sharedFlags,
    '--offline',
    '--no-ocr',
  ]);
}

async function checkpoint() {
  if (options.commitCheckpoints) {
    await run('audit-case-requirements.mjs', []);
    await run('publish-collection-checkpoint.mjs', ['--push']);
  }
}

async function recollect() {
  const saved = JSON.parse(
    await readFile('docs/acceptance/saved-extraction-audit.json', 'utf8')
  );
  const app = new LazadaSearch({
    store,
    market: options.market,
    deliveryArea: options.deliveryArea,
    ocr: options.ocr,
    scheduler: new DomainScheduler({
      intervalMs: Math.max(60000, options.intervalMs),
    }),
    browserOptions: { channel: 'chrome', headless: false },
  });
  try {
    for (const url of new Set(
      saved.recollectionAfterInitialPass.map((entry) => entry.url)
    )) {
      console.log(JSON.stringify({ phase: 'deferred-recollection', url }));
      await app.collect(url, { refresh: true });
    }
  } finally {
    await app.close();
  }
}

try {
  const result = await runAccountCase({
    discover: () => run('collect-account-discovery.mjs', collectionFlags),
    collect: () => run('collect-account-backlog.mjs', collectionFlags),
    audit,
    publish,
    checkpoint,
    recollect,
    reuseDiscovery: reuseAccountDiscovery(options),
  });
  await store.put('case-run', {
    id: reportId,
    ...result,
    updatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  await store.put('case-run', {
    id: reportId,
    stopped: true,
    error: error.message,
    updatedAt: new Date().toISOString(),
  });
  throw error;
}
