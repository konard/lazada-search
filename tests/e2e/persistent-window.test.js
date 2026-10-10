import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import {
  acquireBrowserWindow,
  BROWSER_IDLE_MS,
  closeBrowserWindow,
} from '../../src/persistent-browser.js';

const execute = promisify(execFile);

test('one browser and tab survive client restarts, reject concurrent use, and close after inactivity', async (t) => {
  assert.equal(BROWSER_IDLE_MS, 1800000);
  const directory = await mkdtemp(join(tmpdir(), 'lazada-persistent-window-'));
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
    persistSessionCookies: true,
    preferences: { translate: { enabled: false } },
  };
  const source = `import {acquireBrowserWindow} from ${JSON.stringify(new URL('../../src/persistent-browser.js', import.meta.url).href)};
  const runtime = await acquireBrowserWindow(process.argv[1], JSON.parse(process.argv[2]));
  console.log(JSON.stringify(await runtime.page.evaluate(()=>globalThis.__windowReuseMarker)));
  await runtime.release();`;
  runtime = await acquireBrowserWindow(directory, options);
  const initial = JSON.parse(
    await readFile(join(directory, 'browser-window.json'), 'utf8')
  );
  assert.equal(
    (await stat(join(directory, 'browser-window.json'))).mode & 0o777,
    0o600
  );
  await runtime.page.evaluate(() => {
    globalThis.__windowReuseMarker = 'same-page-and-window';
  });
  await assert.rejects(
    execute(process.execPath, [
      '--input-type=module',
      '-e',
      source,
      directory,
      JSON.stringify(options),
    ]),
    /busy in another collector/
  );
  await runtime.release();
  runtime = undefined;
  const restarted = await execute(process.execPath, [
    '--input-type=module',
    '-e',
    source,
    directory,
    JSON.stringify(options),
  ]);
  assert.equal(JSON.parse(restarted.stdout), 'same-page-and-window');
  assert.equal(
    JSON.parse(await readFile(join(directory, 'browser-window.json'), 'utf8'))
      .pid,
    initial.pid
  );
  runtime = await acquireBrowserWindow(directory, {
    ...options,
    idleTimeoutMs: 2000,
  });
  await runtime.pace('https://www.lazada.vn/test', 0);
  const first = JSON.parse(
    await readFile(join(directory, 'browser-request-times.json'), 'utf8')
  )['www.lazada.vn'];
  await runtime.release();
  runtime = await acquireBrowserWindow(directory, {
    ...options,
    idleTimeoutMs: 2000,
  });
  await runtime.pace('https://www.lazada.vn/test', 1500);
  const second = JSON.parse(
    await readFile(join(directory, 'browser-request-times.json'), 'utf8')
  )['www.lazada.vn'];
  assert.ok(second - first >= 1500, 'request pacing survives client restart');
  await runtime.release();
  runtime = undefined;
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (
      !(await stat(join(directory, 'browser-window.json')).catch(
        () => undefined
      ))
    ) {
      break;
    }
    await delay(100);
  }
  assert.equal(
    await stat(join(directory, 'browser-window.json')).catch(() => undefined),
    undefined
  );
  await delay(1000);
  assert.throws(() => process.kill(initial.pid, 0), { code: 'ESRCH' });
  assert.ok(
    await stat(options.userDataDir),
    'the reusable signed-in profile remains'
  );
  const preferences = JSON.parse(
    await readFile(join(options.userDataDir, 'Default', 'Preferences'), 'utf8')
  );
  assert.equal(preferences.translate.enabled, false);
});
