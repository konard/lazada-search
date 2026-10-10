import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LazadaSearch, DomainScheduler } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { runAccountCase } from './account-case-workflow.mjs';
import { latestCrawl } from '../src/crawl.js';

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
  ...(options.categoryOnly ? ['--category-only'] : []),
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
    return {
      ...(await app.audit()),
      discoveryComplete: latest?.discoveryComplete === true,
    };
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
  await run('archive-case.mjs', [...sharedFlags, '--offline', '--no-ocr']);
  await run('../bin/lazada-search.js', [
    'archive-verify',
    ...sharedFlags,
    '--offline',
    '--no-ocr',
  ]);
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
    recollect,
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
