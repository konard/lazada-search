import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8'));
const config = JSON.parse(await readFile('deno.json', 'utf8'));
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const job = workflow.jobs.test;
const named = (name) => job.steps.find((step) => step.name === name);

test('all matrix runtimes install one reviewed npm lock graph with lifecycle repairs', () => {
  assert.deepEqual(job.strategy.matrix.runtime, ['node', 'bun', 'deno']);
  const setup = named('Setup Node.js');
  const install = named('Install locked dependencies');
  assert.equal(setup.if, undefined);
  assert.equal(install.if, undefined);
  assert.equal(install.run, 'npm ci');
  assert.ok(job.steps.indexOf(setup) < job.steps.indexOf(install));
  assert.ok(
    packageJson.scripts.postinstall.includes('patch-lino-large-documents.mjs')
  );
  for (const step of job.steps) {
    assert.ok(!/\b(?:bun|npm) install\b/.test(step.run ?? ''));
  }
});

test('Bun and Deno run the same complete top-level unit manifest as Node', () => {
  assert.match(packageJson.scripts.test, /tests\/\*\.test\.js$/);
  const bun = named('Run tests (Bun)');
  const deno = named('Run tests (Deno)');
  assert.match(bun.run, /bun test --timeout 300000 \.\/tests\/\*\.test\.js$/);
  assert.match(deno.run, /deno test .* tests\/\*\.test\.js$/);
  assert.equal(bun.if, "matrix.runtime == 'bun'");
  assert.equal(deno.if, "matrix.runtime == 'deno'");
  assert.deepEqual(config.test.include, ['tests/*.test.js']);
  assert.ok(config.test.exclude.includes('tests/e2e/'));
  assert.ok(!/--filter|--ignore|--permit-no-files/.test(bun.run + deno.run));
});

test('Deno manual dependencies stay offline without disabling package freshness checks', () => {
  assert.equal(config.nodeModulesDir, 'manual');
  assert.equal(config.minimumDependencyAge, undefined);
  const step = named('Run tests (Deno)');
  assert.ok(step.run.includes('--cached-only'));
  assert.ok(
    !/--(?:min-dep-age|minimum-dependency-age)|NPM_CONFIG_MIN_RELEASE_AGE/.test(
      step.run
    )
  );
  assert.ok(
    job.steps.indexOf(named('Install locked dependencies')) <
      job.steps.indexOf(step)
  );
});

test('Deno runtime assertions grant explicit fixture capabilities and only loopback networking', () => {
  const step = named('Run tests (Deno)');
  for (const flag of [
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-run',
    '--allow-sys',
    '--allow-ffi',
  ]) {
    assert.ok(step.run.includes(flag));
  }
  assert.ok(step.run.includes('--allow-net=127.0.0.1,localhost'));
  assert.ok(
    !/--allow-all|(?:^|\s)-A(?:\s|$)|--allow-net(?:\s|$)/.test(step.run)
  );
  assert.ok(step.run.includes('--no-check'));
  assert.equal(step.env.DENO_JOBS, '4');
  assert.ok(step.run.includes('--parallel'));
  assert.ok(workflow.jobs['test-compilation']);
});

test('large cached fixture deadlines stay bounded by the matrix job backstop', () => {
  const allowed = job['timeout-minutes'] * 60 * 0.7;
  for (const runtime of ['Node.js', 'Bun', 'Deno']) {
    const step = named(`Run tests (${runtime})`);
    const budget = Number(
      step.run.match(/run-with-budget-warning\.sh (\d+)/)?.[1]
    );
    assert.equal(budget, 600);
    assert.ok(budget <= allowed);
  }
});
