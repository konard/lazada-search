import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { startServer, createTelegramBot } from '../../src/index.js';
import {
  scenarioFixture,
  scenarioPlan,
  capturedScenario,
} from '../helpers/checkout-scenarios.js';

const execute = promisify(execFile);

function telegramApi(replies) {
  return createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    replies.push(input.text);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: replies.length,
          date: 0,
          chat: { id: 777, type: 'private' },
          text: input.text,
        },
      })
    );
  });
}

async function operation(origin, request) {
  const response = await fetch(`${origin}/api/operations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('real CLI, local HTTP and mock Telegram share durable prepared scenario validation and offline replay without marketplace calls', async (t) => {
  const { app, store, directory, mapping } = await scenarioFixture(t);
  const planPath = join(directory, 'plan.json');
  await writeFile(planPath, JSON.stringify(scenarioPlan()));
  const flags = [
    '--data-dir',
    directory,
    '--no-archive',
    '--offline',
    '--no-ocr',
  ];
  const created = JSON.parse(
    (
      await execute(process.execPath, [
        'bin/lazada-search.js',
        'plan-checkout-scenarios',
        planPath,
        ...flags,
      ])
    ).stdout
  );
  assert.equal(created.coverage.planned, 8);
  const batch = {
    planId: created.plan.id,
    captures: [{ scenarioId: capturedScenario(created).id, mapping }],
  };
  const server = await startServer({ application: app, port: 0 });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const replies = [];
  const api = telegramApi(replies);
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => api.close(resolve));
  });
  const first = await operation(origin, {
    operation: 'run-checkout-scenarios',
    input: { batch },
  });
  assert.equal(first.counts.validated, 1);
  assert.equal(first.downloads, 0);
  assert.equal(first.results[0].reused, false);
  const bot = createTelegramBot({
    application: app,
    token: '123:TEST',
    allowedUserIds: [777],
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Fixture',
      username: 'fixture_bot',
    },
    client: { apiRoot: `http://127.0.0.1:${api.address().port}`, fetch },
  });
  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 777, type: 'private' },
      from: { id: 777, is_bot: false, first_name: 'Fixture' },
      text: `/operation ${JSON.stringify({ operation: 'run-checkout-scenarios', input: { batch } })}`,
      entities: [{ type: 'bot_command', offset: 0, length: 10 }],
    },
  });
  const telegram = JSON.parse(replies.join(''));
  assert.equal(telegram.results[0].reused, true);
  assert.equal(telegram.counts.pending, 7);
  const batchPath = join(directory, 'batch.json');
  await writeFile(batchPath, JSON.stringify(batch));
  const cli = JSON.parse(
    (
      await execute(process.execPath, [
        'bin/lazada-search.js',
        'run-checkout-scenarios',
        batchPath,
        ...flags,
      ])
    ).stdout
  );
  assert.equal(cli.results[0].reused, true);
  const status = JSON.parse(
    (
      await execute(process.execPath, [
        'bin/lazada-search.js',
        'checkout-scenario-status',
        created.plan.id,
        ...flags,
      ])
    ).stdout
  );
  const httpStatus = await operation(origin, {
    operation: 'checkout-scenario-status',
    input: { planId: created.plan.id },
  });
  assert.deepEqual(httpStatus, status);
  assert.deepEqual(
    await app.checkoutScenarioStatus({ planId: created.plan.id }),
    status
  );
  assert.equal(status.coverage.purchaseReady, false);
  assert.equal((await store.list('checkout-scenario-attempt')).length, 1);
  const quote = (await store.list('basket-quote'))[0];
  assert.equal(quote.checkoutConditions.paymentMethod, 'Cash on delivery');
  assert.equal(quote.total, 285000);
});
