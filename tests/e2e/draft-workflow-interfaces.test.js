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

// These local end-to-end test drafts have not been executed.
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
  assert.deepEqual(status.body, await app.caseWorkflowStatus(id));
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
  assert.equal(registry.testsExecuted, false);
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
