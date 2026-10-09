import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LazadaSearch,
  AssociativeStore,
  createTelegramBot,
} from '../../src/index.js';

test('Telegram delivers every comparison row, refuses incomplete audits and isolates unauthorized chats', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-telegram-'));
  const app = new LazadaSearch({
    store: new AssociativeStore({ directory }),
    offline: true,
    ocr: false,
  });
  const data = JSON.parse(
    await readFile(new URL('../fixtures/products.json', import.meta.url))
  );
  const products = [],
    offers = [];
  for (let index = 0; index < 18; index += 1) {
    const id = `telegram-product-${index}`;
    const url = `https://www.lazada.vn/products/fixture-i${index + 1000}.html`;
    products.push({
      ...data.products[0],
      id,
      title: `Telegram fixture ${index}`,
      url,
    });
    offers.push({
      ...data.offers[0],
      id: `telegram-offer-${index}`,
      productId: id,
      url,
      observedAt: new Date().toISOString(),
    });
  }
  await app.importRecords({ products, offers });
  const messages = [];
  const api = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const message = JSON.parse(body);
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
  t.after(async () => {
    await new Promise((resolve) => api.close(resolve));
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
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
  let nextUpdate = 0;
  const update = (text, userId = 777, type = 'private') => ({
    update_id: ++nextUpdate,
    message: {
      message_id: nextUpdate,
      date: 0,
      from: { id: userId, is_bot: false, first_name: 'Tester' },
      chat: { id: userId, type },
      text,
      entities: [
        { offset: 0, length: text.split(' ')[0].length, type: 'bot_command' },
      ],
    },
  });
  await bot.handleUpdate(update('/compare --category whey'));
  assert.ok(
    messages.length > 1,
    'large comparison must be split into deliverable messages'
  );
  const full = messages.map((message) => message.text).join('');
  for (const product of products) {
    assert.ok(full.includes(`${product.title}\n`), `missing ${product.title}`);
  }
  assert.ok(
    messages.every(
      (message) => message.text.length <= 3500 && !message.parse_mode
    )
  );
  assert.ok(full.includes('18 eligible offers'));
  await bot.handleUpdate(update('/audit --strict'));
  assert.match(messages.at(-1).text, /Command failed: Incomplete catalog/);
  const count = messages.length;
  await bot.handleUpdate(update('/compare', 999));
  await bot.handleUpdate(update('/compare', 777, 'group'));
  assert.equal(messages.length, count);
  const pending = { ...products[0] };
  delete pending.manufacturerVerification;
  await app.store.put('product', pending);
  await bot.handleUpdate(update('/compare --category whey'));
  assert.match(
    messages
      .slice(count)
      .map((message) => message.text)
      .join(''),
    /Captured price: Telegram fixture 0/
  );
});
