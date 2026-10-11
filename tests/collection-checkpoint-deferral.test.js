import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { publishCollectionCheckpoint } from '../scripts/collection-checkpoint.mjs';
import { runAccountCase } from '../scripts/account-case-workflow.mjs';

const execute = promisify(execFile);
const publisher = fileURLToPath(
  new URL('../scripts/publish-collection-checkpoint.mjs', import.meta.url)
);

async function repository(t) {
  const directory = await mkdtemp(
    join(tmpdir(), 'lazada-checkpoint-deferral-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const work = join(directory, 'working');
  const remote = join(directory, 'origin.git');
  await mkdir(work);
  const git = async (...args) =>
    (await execute('git', args, { cwd: work })).stdout.trim();
  await execute('git', ['init', '--bare', remote]);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Deferral fixture');
  await git('config', 'user.email', 'deferral@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.hooksPath', '.git/hooks');
  await writeFile(join(work, 'README.md'), 'Checkpoint fixture\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'Initialize checkpoint fixture');
  await git('remote', 'add', 'origin', remote);
  await mkdir(join(work, 'docs/tables'), { recursive: true });
  await writeFile(join(work, 'docs/tables/report.md'), 'Verified report\n');
  await mkdir(join(work, 'src'));
  await writeFile(
    join(work, 'src/in-progress.js'),
    'export const pending = true;\n'
  );
  const checkpoint = async (...flags) =>
    JSON.parse(
      (await execute(process.execPath, [publisher, ...flags], { cwd: work }))
        .stdout
    );
  return { directory, work, remote, git, checkpoint };
}

test('explicit staged deferral preserves the exact index and public work without committing or pushing', async (t) => {
  const ctx = await repository(t);
  await ctx.git('add', 'src/in-progress.js');
  const beforeIndex = await readFile(join(ctx.work, '.git/index'));
  const beforeHead = await ctx.git('rev-parse', 'HEAD');
  const sourceBlob = await ctx.git('rev-parse', ':src/in-progress.js');
  await assert.rejects(publishCollectionCheckpoint({ cwd: ctx.work }), {
    code: 'CHECKPOINT_STAGED_CHANGES',
  });
  const result = await ctx.checkpoint('--push', '--defer-staged');
  assert.equal(result.deferred, true);
  assert.equal(result.reason, 'existing-staged-changes');
  assert.equal(result.retry, 'next-batch');
  assert.equal(result.changed, false);
  assert.equal(result.pushed, false);
  assert.deepEqual(result.paths, []);
  assert.equal(await ctx.git('rev-parse', 'HEAD'), beforeHead);
  assert.equal(await ctx.git('rev-parse', ':src/in-progress.js'), sourceBlob);
  assert.deepEqual(await readFile(join(ctx.work, '.git/index')), beforeIndex);
  assert.equal(
    await ctx.git('diff', '--cached', '--name-only'),
    'src/in-progress.js'
  );
  assert.equal(await ctx.git('ls-remote', 'origin'), '');
  assert.equal(
    await readFile(join(ctx.work, 'docs/tables/report.md'), 'utf8'),
    'Verified report\n'
  );
});

test('continuous collection retries a deferred checkpoint at the next batch and commits only public reports', async (t) => {
  const ctx = await repository(t);
  await ctx.git('add', 'src/in-progress.js');
  let batches = 0;
  const receipts = [];
  const result = await runAccountCase({
    discover: async () => {},
    publish: async () => {},
    audit: async () => ({
      discoveryComplete: true,
      failures: [],
      collectableUrls: batches ? [] : ['pending'],
      deferredUrls: [],
      categoryReview: [],
    }),
    collect: async () => {
      batches++;
      await ctx.git('reset', '--', 'src/in-progress.js');
      await writeFile(
        join(ctx.work, 'docs/tables/report.md'),
        'Verified next batch\n'
      );
    },
    checkpoint: async () =>
      receipts.push(await ctx.checkpoint('--push', '--defer-staged')),
  });
  assert.equal(result.passes, 1);
  assert.equal(batches, 1);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].deferred, true);
  assert.equal(receipts[1].changed, true);
  assert.equal(receipts[1].pushed, true);
  assert.equal(
    await ctx.git('show', 'HEAD:docs/tables/report.md'),
    'Verified next batch'
  );
  assert.doesNotMatch(
    await ctx.git('ls-tree', '-r', '--name-only', 'HEAD'),
    /in-progress/u
  );
  assert.equal(
    await ctx.git('status', '--short', '--', 'src/in-progress.js'),
    '?? src/in-progress.js'
  );
});

test('staged checkpoint deferral cannot swallow a challenged collection failure', async (t) => {
  const ctx = await repository(t);
  await ctx.git('add', 'src/in-progress.js');
  const challenge = Object.assign(new Error('CAPTCHA stopped collection'), {
    code: 'COLLECTION_STOPPED',
  });
  const receipts = [];
  await assert.rejects(
    runAccountCase({
      discover: async () => {},
      publish: async () => {},
      audit: async () => ({
        discoveryComplete: true,
        failures: [],
        collectableUrls: ['pending'],
      }),
      collect: async () => {
        throw challenge;
      },
      checkpoint: async () =>
        receipts.push(await ctx.checkpoint('--push', '--defer-staged')),
    }),
    (error) => error === challenge
  );
  assert.equal(receipts.length, 2);
  assert.ok(
    receipts.every((result) => result.reason === 'existing-staged-changes')
  );
  assert.equal(
    await ctx.git('diff', '--cached', '--name-only'),
    'src/in-progress.js'
  );
});

test('deferral mode propagates real commit errors and preserves the failed stage for inspection', async (t) => {
  const ctx = await repository(t);
  const hook = join(ctx.work, '.git/hooks/pre-commit');
  await writeFile(hook, '#!/bin/sh\nexit 19\n');
  await chmod(hook, 0o700);
  const head = await ctx.git('rev-parse', 'HEAD');
  await assert.rejects(
    publishCollectionCheckpoint({ cwd: ctx.work, deferStaged: true }),
    /commit/u
  );
  assert.equal(await ctx.git('rev-parse', 'HEAD'), head);
  assert.equal(
    await ctx.git('diff', '--cached', '--name-only'),
    'docs/tables/report.md'
  );
});

test('real push failures remain failures and a later checkpoint retries the committed public snapshot', async (t) => {
  const ctx = await repository(t);
  await ctx.git('remote', 'remove', 'origin');
  await assert.rejects(
    publishCollectionCheckpoint({
      cwd: ctx.work,
      push: true,
      deferStaged: true,
    }),
    /push/u
  );
  const committed = await ctx.git('rev-parse', 'HEAD');
  assert.equal(
    await ctx.git('show', 'HEAD:docs/tables/report.md'),
    'Verified report'
  );
  await ctx.git('remote', 'add', 'origin', ctx.remote);
  const retry = await ctx.checkpoint('--push', '--defer-staged');
  assert.equal(retry.changed, false);
  assert.equal(retry.commit, committed);
  assert.equal(retry.pushed, true);
});

async function raceWrapper(ctx, stageBefore) {
  // Intercept the command boundary and still execute genuine Git commands.
  // Windows cannot use a PATH shell wrapper to intercept git.exe; pre-commit
  // hooks run after Git locks its index, too late for this staging race.
  return publishCollectionCheckpoint({
    cwd: ctx.work,
    deferStaged: true,
    executeGit: async (command, args, options) => {
      if (args[0] === stageBefore) {
        await ctx.git('add', '--', 'src/in-progress.js');
      }
      return execute(command, args, options);
    },
  });
}

test('code staged during publication is deferred without clearing any staged source', async (t) => {
  const ctx = await repository(t);
  const beforeHead = await ctx.git('rev-parse', 'HEAD');
  const receipt = await raceWrapper(ctx, 'add');
  assert.equal(receipt.deferred, true);
  assert.equal(receipt.reason, 'staged-changes-during-checkpoint');
  assert.equal(await ctx.git('rev-parse', 'HEAD'), beforeHead);
  assert.deepEqual(
    (await ctx.git('diff', '--cached', '--name-only')).split('\n'),
    ['docs/tables/report.md', 'src/in-progress.js']
  );
});

test('partial commit isolates the final staging race and retains source code in the original index', async (t) => {
  const ctx = await repository(t);
  const receipt = await raceWrapper(ctx, 'commit');
  assert.equal(receipt.changed, true);
  assert.doesNotMatch(
    await ctx.git('ls-tree', '-r', '--name-only', 'HEAD'),
    /in-progress/u
  );
  assert.equal(
    await ctx.git('show', ':src/in-progress.js'),
    'export const pending = true;'
  );
  assert.equal(
    await ctx.git('diff', '--cached', '--name-only'),
    'src/in-progress.js'
  );
  assert.equal(
    await ctx.git('show', 'HEAD:docs/tables/report.md'),
    'Verified report'
  );
});

test('deferral requires explicit boolean configuration and genuine Git failures remain rejected', async (t) => {
  const ctx = await repository(t);
  await assert.rejects(
    publishCollectionCheckpoint({ cwd: ctx.work, deferStaged: 'true' }),
    /must be boolean/u
  );
  await ctx.git('checkout', '--detach');
  await assert.rejects(
    publishCollectionCheckpoint({ cwd: ctx.work, deferStaged: true }),
    /symbolic-ref/u
  );
});
