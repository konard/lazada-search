import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireBrowserWindow,
  closeBrowserWindow,
} from '../../src/persistent-browser.js';

test('an orphaned supervisor is replaced while retaining its browser and page', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-window-recover-'));
  let runtime;
  t.after(async () => {
    await runtime?.release().catch(() => {});
    await closeBrowserWindow(directory);
    await rm(directory, { recursive: true, force: true });
  });
  const options = {
    channel: 'chrome',
    headless: true,
    userDataDir: join(directory, 'browser-profile'),
    idleTimeoutMs: 30000,
    persistSessionCookies: true,
  };
  runtime = await acquireBrowserWindow(directory, options);
  const file = join(directory, 'browser-window-recovery.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await runtime.page.context().addCookies([
    {
      name: 'recovery-test',
      value: 'retained',
      domain: '127.0.0.1',
      path: '/',
    },
  ]);
  await runtime.page.evaluate(() => {
    globalThis.__recoveryMarker = 'retained-page';
  });
  await runtime.release();
  runtime = undefined;
  process.kill(original.pid, 'SIGKILL');
  await delay(100);
  process.kill(original.browserPid, 0);
  runtime = await acquireBrowserWindow(directory, options);
  assert.equal(
    await runtime.page.evaluate(() => globalThis.__recoveryMarker),
    'retained-page'
  );
  const recovered = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(recovered.browserPid, original.browserPid);
  assert.equal(
    new URL(recovered.cdpEndpoint).href,
    new URL(original.cdpEndpoint).href
  );
  assert.notEqual(recovered.pid, original.pid);
  await runtime.release();
  runtime = undefined;
  await closeBrowserWindow(directory);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(original.browserPid, 0);
    } catch {
      break;
    }
    await delay(100);
  }
  assert.throws(() => process.kill(original.browserPid, 0), { code: 'ESRCH' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  const sessionFile = join(
    options.userDataDir,
    'browser-commander-session.json'
  );
  assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(sessionFile, 'utf8'));
  assert.ok(saved.cookies.some((cookie) => cookie.name === 'recovery-test'));
  runtime = await acquireBrowserWindow(directory, options);
  assert.ok(
    (await runtime.page.context().cookies()).some(
      (cookie) => cookie.name === 'recovery-test' && cookie.value === 'retained'
    )
  );
});
