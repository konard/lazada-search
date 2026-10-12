import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { requirementDraftStatus } from '../src/requirement-registry.js';
import { caseReadiness } from '../src/case-readiness.js';
import { draftWorkflowFixture } from './helpers/draft-workflows.js';

test('all recorded requirements retain executable regression references or explicit external operator procedures', async () => {
  const registry = requirementDraftStatus();
  assert.deepEqual(
    registry.requirements.map((row) => row.id),
    Array.from(
      { length: 49 },
      (_, index) => `R${String(index + 1).padStart(3, '0')}`
    )
  );
  const config = JSON.parse(
    await readFile(new URL('./tsconfig.public-api.json', import.meta.url))
  );
  for (const row of registry.requirements) {
    assert.ok(row.sourceFiles.length + row.draftSourceFiles.length > 0, row.id);
    assert.ok(row.testDraftFiles.length || row.operatorSteps.length, row.id);
    for (const path of [
      ...row.sourceFiles,
      ...row.draftSourceFiles,
      ...row.testDraftFiles,
    ]) {
      if (!path.startsWith('https://')) {
        assert.ok(
          (await stat(new URL(`../${path}`, import.meta.url))).isFile(),
          `${row.id}: ${path}`
        );
      }
    }
    for (const path of row.testDraftFiles) {
      assert.ok(
        /^tests\/(?:e2e\/)?[^/]+\.test\.js$/u.test(path) ||
          (path.startsWith('tests/') && config.files.includes(path.slice(6))),
        `${row.id}: regression must participate in the actual unit/E2E/type manifest`
      );
    }
  }
  assert.equal(registry.allRequirementsDelivered, false);
  assert.equal(registry.allTargetProductsCollected, false);
  assert.equal(registry.productionReady, false);
});

test('GitHub issue coverage retains every recorded issue, current source paths and unresolved release/data gates', async () => {
  const registry = requirementDraftStatus();
  const snapshot = JSON.parse(
    await readFile(
      new URL(`../${registry.githubIssueSnapshot}`, import.meta.url)
    )
  );
  const ids = new Set(registry.requirements.map((row) => row.id));
  assert.equal(registry.githubIssues.length, snapshot.length);
  for (const issue of snapshot) {
    const mapped = registry.githubIssues.find(
      (row) => row.number === issue.number
    );
    assert.ok(mapped, `Untracked GitHub issue ${issue.number}`);
    assert.equal(mapped.state, issue.state);
    assert.ok(mapped.requirementIds.length > 0);
    assert.ok(mapped.requirementIds.every((id) => ids.has(id)));
  }
  assert.deepEqual(
    registry.githubIssues
      .filter((row) => row.state === 'OPEN')
      .map((row) => row.number),
    [3, 14, 32, 36, 42]
  );
});

test('passing synthetic arithmetic cannot certify real catalog coverage, shipping, OTP, translations or publisher access', async (t) => {
  const { app, store } = await draftWorkflowFixture(t);
  await store.put('collection-stop', {
    id: 'browser-collection',
    active: true,
    origin: 'https://manufacturer.example',
    reason: 'challenge',
    detectedAt: new Date().toISOString(),
  });
  const readiness = await caseReadiness(app);
  assert.equal(readiness.collectionStop.active, true);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.purchaseReady, false);
  assert.equal(readiness.allRequirementsDelivered, false);
  assert.ok(readiness.externalGates.some((gate) => /challenge/u.test(gate)));
  assert.ok(readiness.externalGates.some((gate) => /manufacturer/u.test(gate)));
  assert.ok(readiness.externalGates.some((gate) => /frozen/u.test(gate)));
  assert.ok(readiness.externalGates.some((gate) => /publisher/u.test(gate)));
});
