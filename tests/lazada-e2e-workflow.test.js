import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = parse(
  await readFile('.github/workflows/lazada-e2e.yml', 'utf8')
);
const steps = workflow.jobs.e2e.steps;
const profileStep = steps.find((step) =>
  step.name?.startsWith('Allow sandbox')
);
const smokeStep = steps.find((step) => step.name?.startsWith('Verify normal'));

async function executable(path, source = '#!/bin/bash\nexit 0\n') {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, source);
  await chmod(path, 0o755);
  return path;
}

async function fixture({
  missingHeadless = false,
  unsafe = false,
  parserFails = false,
} = {}) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'lazada-ci-sandbox-'))
  );
  const cache = join(directory, 'lazada-playwright');
  const bin = join(directory, 'bin');
  const installed = join(directory, 'installed-profile');
  const receipt = join(directory, 'parser-receipt');
  await executable(
    join(
      cache,
      unsafe ? 'chromium*' : 'chromium-1248',
      'chrome-linux64',
      'chrome'
    )
  );
  if (!missingHeadless) {
    await executable(
      join(
        cache,
        'chromium_headless_shell-1248',
        'chrome-headless-shell-linux64',
        'chrome-headless-shell'
      )
    );
  }
  await executable(join(cache, 'not-a-browser'));
  await executable(
    join(bin, 'sudo'),
    '#!/bin/bash\ncase "$1" in\ninstall) cp "${@: -2:1}" "${@: -1}" ;;\napparmor_parser) shift; exec apparmor_parser "$@" ;;\n*) exit 17 ;;\nesac\n'
  );
  await executable(
    join(bin, 'apparmor_parser'),
    parserFails
      ? '#!/bin/bash\nexit 42\n'
      : '#!/bin/bash\ncat "$2" > "$APPARMOR_RECEIPT"\n'
  );
  const enabled = join(directory, 'apparmor-enabled');
  await writeFile(enabled, 'Y\n');
  const source = profileStep.run
    .replaceAll('/sys/module/apparmor/parameters/enabled', enabled)
    .replaceAll('/etc/apparmor.d/lazada-playwright-userns', installed);
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', source], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: directory,
      PLAYWRIGHT_BROWSERS_PATH: cache,
      APPARMOR_RECEIPT: receipt,
    },
  });
  return { directory, cache, installed, receipt, result };
}

test('runner profile attaches only exact canonical normal and headless browser files', async () => {
  const value = await fixture();
  try {
    assert.equal(
      value.result.status,
      0,
      value.result.stderr || value.result.stdout
    );
    const profile = await readFile(value.installed, 'utf8');
    const attachments = [
      ...profile.matchAll(
        /profile lazada-playwright-\d+ "([^"]+)" flags=\(unconfined\) \{\n {2}userns,\n\}/g
      ),
    ].map((match) => match[1]);
    assert.equal(attachments.length, 2);
    assert.ok(
      attachments.includes(
        join(value.cache, 'chromium-1248/chrome-linux64/chrome')
      )
    );
    assert.ok(
      attachments.includes(
        join(
          value.cache,
          'chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'
        )
      )
    );
    assert.equal(await readFile(value.receipt, 'utf8'), profile);
    assert.ok(!profile.includes('not-a-browser'));
    assert.ok(!/[?*]/.test(profile));
    assert.ok(
      !/sysctl|--no-sandbox|CHROME_DEVEL_SANDBOX/.test(profileStep.run)
    );
    assert.match(profileStep.run, /sudo install -o root -g root -m 0644/);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

for (const [name, options, error] of [
  [
    'missing headless browser',
    { missingHeadless: true },
    'Expected installed Chromium and headless-shell',
  ],
  [
    'unsafe attachment syntax',
    { unsafe: true },
    'Unsafe browser attachment path',
  ],
]) {
  test(`profile preflight rejects ${name} before installing any exception`, async () => {
    const value = await fixture(options);
    try {
      assert.notEqual(value.result.status, 0);
      assert.ok(value.result.stdout.includes(error));
      assert.equal(await stat(value.installed).catch(() => null), null);
      assert.equal(await stat(value.receipt).catch(() => null), null);
    } finally {
      await rm(value.directory, { recursive: true, force: true });
    }
  });
}

test('profile load errors fail with a clear diagnostic', async () => {
  const value = await fixture({ parserFails: true });
  try {
    assert.equal(value.result.status, 1);
    assert.ok(
      value.result.stdout.includes(
        'Failed to load the exact Chromium sandbox namespace profile'
      )
    );
    assert.equal(await stat(value.receipt).catch(() => null), null);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});

async function executeSmoke(args = []) {
  const launches = [];
  let closes = 0;
  const source = smokeStep.run
    .replace("node --input-type=module <<'NODE'\n", '')
    .replace("import { chromium } from 'playwright';\n", '')
    .replace(/\nNODE\s*$/, '');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const chromium = {
    launch: async (options) => {
      launches.push(options);
      return {
        newBrowserCDPSession: async () => ({
          send: async () => ({ arguments: args }),
        }),
        newPage: async () => ({
          setContent: async () => {},
          locator: () => ({ textContent: async () => 'Sandbox smoke check' }),
        }),
        close: async () => {
          closes += 1;
        },
      };
    },
  };
  try {
    await new AsyncFunction('chromium', 'console', source)(chromium, {
      log: () => {},
    });
    return { launches, closes };
  } catch (error) {
    return { error, launches, closes };
  }
}

test('smoke gate launches both downloaded runtimes and installed Chrome with sandbox explicitly enabled', async () => {
  const result = await executeSmoke();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.launches, [
    { headless: true, chromiumSandbox: true, args: ['--enable-automation'] },
    {
      headless: true,
      chromiumSandbox: true,
      args: ['--enable-automation'],
      channel: 'chromium',
    },
    {
      headless: true,
      chromiumSandbox: true,
      args: ['--enable-automation'],
      channel: 'chrome',
    },
  ]);
  assert.equal(result.closes, 3);
  assert.ok(
    steps.indexOf(profileStep) >
      steps.findIndex((step) => step.name === 'Install Chromium and local OCR')
  );
  assert.ok(steps.indexOf(smokeStep) > steps.indexOf(profileStep));
  assert.ok(
    steps.findIndex(
      (step) => step.name === 'Run complete deterministic E2E tests'
    ) > steps.indexOf(smokeStep)
  );
});

for (const flag of [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-namespace-sandbox',
  '--disable-seccomp-filter-sandbox',
]) {
  test(`smoke gate rejects ${flag} and closes the launched browser`, async () => {
    const result = await executeSmoke([flag]);
    assert.match(result.error.message, /disabled sandbox/);
    assert.equal(result.launches.length, 1);
    assert.equal(result.closes, 1);
  });
}
