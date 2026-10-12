import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

test('the CI compilation gate checks real public declarations for every relevant code change', async () => {
  const workflow = parse(
    await readFile(
      new URL('../.github/workflows/release.yml', import.meta.url),
      'utf8'
    )
  );
  const gate = workflow.jobs['test-compilation'];
  assert.match(gate.if, /any-code-changed == 'true'/u);
  assert.match(gate.if, /!cancelled\(\)/u);
  assert.match(gate.if, /workflow_dispatch/u);
  assert.match(gate.if, /release_mode == 'instant'/u);
  const commands = gate.steps.map((step) => step.run).filter(Boolean);
  const install = commands.indexOf('npm ci');
  const types = commands.indexOf('npm run test:types');
  assert.ok(install >= 0 && types > install);
  assert.ok(workflow.jobs.test.needs.includes('test-compilation'));
  assert.ok(
    workflow.jobs['pipeline-status'].needs.includes('test-compilation')
  );
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url))
  );
  assert.equal(
    pkg.scripts['test:types'],
    'tsc -p tests/tsconfig.public-api.json'
  );
  assert.ok(pkg.devDependencies.typescript);
  assert.ok(pkg.devDependencies['@types/node']);
  const config = JSON.parse(
    await readFile(new URL('./tsconfig.public-api.json', import.meta.url))
  );
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.skipLibCheck, false);
  assert.deepEqual(config.files, ['fixtures/public-api-types.ts']);
});
