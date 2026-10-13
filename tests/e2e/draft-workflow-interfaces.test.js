import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  startServer,
  createTelegramBot,
  executeOperation,
  COLLECTION_STOP_ID,
} from '../../src/index.js';
import { draftWorkflowFixture } from '../helpers/draft-workflows.js';

const execute = promisify(execFile);

async function cli(directory, command, args = []) {
  const { stdout } = await execute(
    process.execPath,
    [
      'bin/lazada-search.js',
      command,
      ...args,
      '--data-dir',
      directory,
      '--no-archive',
      '--offline',
      '--no-ocr',
    ],
    {
      cwd: new URL('../..', import.meta.url),
      env: {
        ...process.env,
        LAZADA_ACCOUNT: '',
        LAZADA_MANUFACTURER_SEARCH_CONFIG: '',
        LAZADA_TRANSLATION_ENDPOINT: '',
        LAZADA_TRANSLATION_PROVIDER: 'unconfigured',
      },
    }
  );
  return JSON.parse(stdout);
}

async function http(t, app) {
  const server = await startServer({ application: app, port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async (payload) => {
    const response = await fetch(`${origin}/api/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  };
}

async function telegram(t, app) {
  const messages = [];
  const api = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    messages.push(message);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: messages.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: message.text,
        },
      })
    );
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const bot = createTelegramBot({
    application: app,
    token: '123:DRAFT_TEST',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Draft fixture',
      username: 'draft_fixture_bot',
    },
    client: { apiRoot: `http://127.0.0.1:${api.address().port}`, fetch },
  });
  let nextUpdate = 0;
  return async (payload, userId = 777, type = 'private') => {
    const offset = messages.length;
    await bot.handleUpdate({
      update_id: ++nextUpdate,
      message: {
        message_id: nextUpdate,
        date: 0,
        from: { id: userId, is_bot: false, first_name: 'Fixture' },
        chat: { id: userId, type },
        text: `/operation ${JSON.stringify(payload)}`,
        entities: [{ type: 'bot_command', offset: 0, length: 10 }],
      },
    });
    return messages.slice(offset);
  };
}

function prices(report) {
  return report.reports.map((set) => ({
    quantity: set.quantity,
    rows: set.rows.map((row) => ({
      sku: row.sku,
      category: row.category,
      quantities: row.quantities,
      metrics: row.metrics,
    })),
  }));
}

test('readiness gates are identical in the library, CLI, HTTP and Telegram while a challenge prevents requests', async (t) => {
  const { app, store, directory } = await draftWorkflowFixture(t);
  const stop = {
    id: COLLECTION_STOP_ID,
    active: true,
    reason: 'challenge',
    origin: 'https://manufacturer.example',
    detectedAt: new Date().toISOString(),
  };
  await store.put('collection-stop', stop);
  const input = { quantity: 3, maxPriceAgeMs: 86400000 };
  const optionsPath = join(directory, 'readiness-options.json');
  await writeFile(optionsPath, JSON.stringify(input));
  const library = await app.caseReadiness(input);
  const command = await cli(directory, 'case-readiness', [optionsPath]);
  const post = await http(t, app);
  const web = await post({ operation: 'case-readiness', input });
  assert.equal(web.status, 200);
  const send = await telegram(t, app);
  const replies = await send({ operation: 'case-readiness', input });
  const bot = JSON.parse(replies.map((message) => message.text).join(''));
  for (const result of [command, web.body, bot]) {
    assert.deepEqual(result.evidenceGates, library.evidenceGates);
    assert.equal(result.quantity, 3);
    assert.equal(
      result.purchaseReadinessScope,
      'explicitly-reviewed-captured-inventory'
    );
    assert.equal(result.purchaseReady, false);
    assert.equal(result.wholeMarketBestPriceProven, false);
    assert.equal(result.productionReady, false);
    assert.equal(result.allRequirementsDelivered, false);
    assert.equal(result.collectionStop.active, true);
  }
  assert.deepEqual(
    await store.get('collection-stop', COLLECTION_STOP_ID),
    stop
  );
  assert.equal(app.cache.stats.downloads, 0);
});

// Every source request is disabled; the interfaces use retained originals.
test('library, executable CLI, HTTP and Telegram preserve identical target prices/units with zero website requests', async (t) => {
  const { app, store, directory } = await draftWorkflowFixture(t);
  await store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    origin: 'https://manufacturer.example',
    reason: 'challenge',
    detectedAt: new Date().toISOString(),
  });
  const options = { quantities: [1, 10], limit: 10 };
  const path = join(directory, 'report-options.json');
  await writeFile(path, JSON.stringify({ options }));
  const library = await app.shoppingReport(options);
  const command = await cli(directory, 'shopping-report', [path]);
  const post = await http(t, app);
  const request = { operation: 'shopping-report', options };
  const web = await post(request);
  assert.equal(web.status, 200);
  const send = await telegram(t, app);
  const replies = await send(request);
  assert.ok(replies.length > 1);
  assert.ok(
    replies.every(
      (message) => message.text.length <= 3500 && !message.parse_mode
    )
  );
  const botResult = JSON.parse(replies.map((message) => message.text).join(''));
  assert.deepEqual(prices(command), prices(library));
  assert.deepEqual(prices(web.body), prices(library));
  assert.deepEqual(prices(botResult), prices(library));
  assert.equal(
    library.reports[0].rankings.whey.costPerGramBeforeDelivery.top.length,
    2
  );
  assert.equal(
    library.reports[0].rankings['chocolate-ice-cream'].costPerMlBeforeDelivery
      .top.length,
    1
  );
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
  assert.equal(app.cache.stats.downloads, 0);
  assert.deepEqual(await send(request, 999), []);
  assert.deepEqual(await send(request, 777, 'group'), []);
});

test('case plan, persisted status and requirement registry are shared across every interface', async (t) => {
  const { app, directory } = await draftWorkflowFixture(t);
  const plan = {
    queries: ['fixture whey'],
    categoryUrls: [],
    quantities: [1, 10],
  };
  const path = join(directory, 'plan.json');
  await writeFile(path, JSON.stringify(plan));
  const created = await cli(directory, 'plan-case-workflow', [path]);
  const id = created.workflow.id;
  const post = await http(t, app);
  const status = await post({
    operation: 'case-workflow-status',
    input: { workflowId: id },
  });
  assert.equal(status.status, 200);
  assert.deepEqual(
    status.body,
    JSON.parse(JSON.stringify(await app.caseWorkflowStatus(id)))
  );
  assert.deepEqual(
    await cli(directory, 'case-workflow-status', [id]),
    status.body
  );
  const send = await telegram(t, app);
  const replies = await send({
    operation: 'case-workflow-status',
    input: { workflowId: id },
  });
  assert.deepEqual(
    JSON.parse(replies.map((reply) => reply.text).join('')),
    status.body
  );
  const registry = await executeOperation(app, {
    operation: 'requirement-draft-status',
  });
  assert.equal(registry.mappedRequirements, 49);
  assert.equal(registry.allRequirementsDelivered, false);
  assert.equal(registry.testsExecuted, true);
  assert.equal(registry.codeValidation, 'automated-local-tests-passed');
  assert.deepEqual(
    (await post({ operation: 'requirement-draft-status' })).body,
    registry
  );
});

test('structured interfaces reject credential destination overrides and persistent CAPTCHA blocks online runs', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  const created = await app.planCaseWorkflow({
    queries: ['fixture whey'],
    categoryUrls: [],
  });
  const post = await http(t, app);
  const rejected = await post({
    operation: 'run-manufacturer-workflow',
    input: { workflowId: 'untrusted' },
    options: {
      searchConfiguration: {
        endpoint: 'https://untrusted.example/search',
        tokenEnv: 'SECRET_TOKEN',
      },
    },
  });
  assert.equal(rejected.status, 400);
  assert.match(
    rejected.body.error,
    /application startup|credential destinations/
  );
  const send = await telegram(t, app);
  const unauthorized = await send({
    operation: 'run-case-workflow',
    input: { workflowId: created.workflow.id },
    options: { searchProvider: { origin: 'https://untrusted.example' } },
  });
  assert.match(
    unauthorized.map((reply) => reply.text).join(''),
    /Command failed:.*application startup/
  );
  await store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    reason: 'challenge',
    origin: 'https://manufacturer.example',
  });
  const stopped = await post({
    operation: 'run-case-workflow',
    input: { workflowId: created.workflow.id },
    options: { allowNetwork: true, maxTasks: 1 },
  });
  assert.equal(stopped.status, 400);
  assert.match(stopped.body.error, /stop|challenge/i);
  assert.equal(
    (await store.get('collection-stop', COLLECTION_STOP_ID)).active,
    true
  );
});

async function importSyntheticCaseInventory(store, data, directory, post) {
  const at = new Date().toISOString();
  await store.put('crawl', {
    id: `crawl:${at}`,
    startedAt: at,
    queries: ['fixture whey'],
    categoryUrls: [],
    scopes: [{ query: 'fixture whey', terminalConfirmed: true }],
    failures: [],
    uncollectedUrls: [],
  });
  for (const offer of data.offers) {
    await store.put('sku-inventory', {
      id: offer.url,
      url: offer.url,
      inventoryObserved: true,
      observedAt: at,
      skus: [{ sku: offer.sku, url: offer.url }],
    });
  }
  const blob = await store.putBlob(
    Buffer.from(
      JSON.stringify({
        rows: data.offers.map(({ url, sku }) => ({ url, sku })),
        total: data.offers.length,
        next: null,
      })
    )
  );
  const evidence = await store.put('evidence', {
    id: 'synthetic-inventory-original',
    url: 'https://www.lazada.vn/catalog/?q=fixture+whey',
    role: 'inventory',
    blob,
    observedAt: at,
  });
  const scope = (await post({ operation: 'case-coverage-status' })).body.scope;
  const manifestInput = {
    evidenceId: evidence.id,
    sourceSha256: blob.sha256,
    reviewedBy: 'Synthetic fixture reviewer',
    scope,
    mapping: {
      rowsPointer: '/rows',
      urlPointer: '/url',
      skuPointer: '/sku',
      reportedTotalPointer: '/total',
      terminalPointer: '/next',
      terminalValue: null,
    },
  };
  const manifestFile = join(directory, 'inventory.json');
  await writeFile(manifestFile, JSON.stringify(manifestInput));
  const manifest = await cli(directory, 'import-case-inventory', [
    manifestFile,
  ]);
  const coverage = await post({
    operation: 'case-coverage-status',
    input: { inventoryId: manifest.id },
  });
  assert.equal(coverage.status, 200);
  assert.equal(coverage.body.manifest.declaredRows, 8);
  assert.equal(coverage.body.manifest.scopedPricesComplete, true);
  assert.deepEqual(coverage.body.manifest.missing, []);
  assert.equal(coverage.body.manifest.allMarketCoverageProven, false);
  return { scope, coverage, evidence, blob, manifestInput };
}

test('cached case batches resume across library, CLI, HTTP and Telegram with exact inventory and manual-review originals', async (t) => {
  const { app, store, directory, data } = await draftWorkflowFixture(t);
  const post = await http(t, app);
  const { scope, coverage, evidence, blob, manifestInput } =
    await importSyntheticCaseInventory(store, data, directory, post);
  const reviewed = await post({
    operation: 'record-case-manual-review',
    input: {
      review: {
        scope,
        scopeFingerprint: coverage.body.scopeFingerprint,
        reviewedBy: 'Synthetic fixture reviewer',
        reason: 'All synthetic original item/SKU prices and units checked',
        evidence: [{ evidenceId: evidence.id, sourceSha256: blob.sha256 }],
        exactPriceExtractionReviewed: true,
        quantityExtractionReviewed: true,
        classificationReviewed: true,
        listPaginationReviewed: true,
      },
    },
  });
  assert.equal(reviewed.status, 200);
  const planned = await app.planCaseWorkflow({
    queries: ['fixture whey'],
    categoryUrls: [],
    quantities: [1],
    recollectAfterInitialPass: false,
  });
  const id = planned.workflow.id;
  assert.ok(planned.tasks.every((task) => task.stage !== 'discovery'));
  const options = { maxTasks: 1, manualReviewId: reviewed.body.id };
  const first = await app.runCaseWorkflow(id, options);
  assert.equal(first.executed, 1);
  const optionsFile = join(directory, 'resume-options.json');
  await writeFile(optionsFile, JSON.stringify(options));
  const command = await cli(directory, 'run-case-workflow', [id, optionsFile]);
  assert.equal(command.executed, 1);
  const web = await post({
    operation: 'run-case-workflow',
    input: { workflowId: id },
    options,
  });
  assert.equal(web.status, 200);
  assert.equal(web.body.executed, 1);
  const send = await telegram(t, app);
  const replies = await send({
    operation: 'run-case-workflow',
    input: { workflowId: id },
    options: { ...options, maxTasks: 50 },
  });
  const last = JSON.parse(replies.map((reply) => reply.text).join(''));
  assert.ok(last.executed > 0);
  const completed = last.tasks.filter((task) => task.status === 'succeeded');
  assert.ok(completed.some((task) => task.stage === 'manual-review'));
  assert.ok(completed.some((task) => task.stage === 'report'));
  const taskIds = new Set(last.tasks.map((task) => task.id));
  assert.equal(taskIds.size, last.tasks.length);
  for (const result of [first, command, web.body, last]) {
    assert.ok(await store.get('shopping-report', result.reportId));
    assert.equal(result.cache.downloads, 0);
    assert.equal(result.allTargetProductsCollected, false);
    assert.equal(result.purchaseReady, false);
  }
  const report = await app.shoppingReport({ quantities: [1] });
  const ice = report.reports[0].rows.find(
    (row) => row.category === 'chocolate-ice-cream'
  );
  assert.equal(ice.metrics.costPerGramBeforeDelivery, 200);
  assert.equal(ice.metrics.costPerMlBeforeDelivery, 100);
  assert.equal(ice.metrics.costPerProteinGramBeforeDelivery, 4000);
  assert.equal(ice.metrics.costPerGramAfterDelivery, 250);
  assert.equal(ice.metrics.costPerMlAfterDelivery, 125);
  assert.equal(ice.metrics.costPerProteinGramAfterDelivery, 5000);
  await store.put('invalidation', {
    id: 'recollect-synthetic-inventory',
    evidenceIds: [evidence.id],
    invalidatedAt: new Date().toISOString(),
  });
  const revoked = await post({
    operation: 'case-coverage-status',
    input: { manualReviewId: reviewed.body.id },
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.manualReview, null);
  assert.equal(revoked.body.observedScopeReady, false);
  const stale = await post({
    operation: 'import-case-inventory',
    input: { inventory: manifestInput },
  });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /recollection/u);
  assert.equal(app.cache.stats.downloads, 0);
});
