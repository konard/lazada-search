import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { publishCollectionCheckpoint } from '../scripts/collection-checkpoint.mjs';
import { runAccountCase } from '../scripts/account-case-workflow.mjs';

const execute = promisify(execFile);

test('publication pushes only verified public checkpoint paths and leaves unrelated working files untouched', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-checkpoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const work = join(directory, 'work');
  const remote = join(directory, 'remote.git');
  await mkdir(work);
  const git = async (...args) =>
    (await execute('git', args, { cwd: work })).stdout.trim();
  await execute('git', ['init', '--bare', remote]);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Checkpoint fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(work, 'README.md'), 'Fixture\n');
  await git('add', 'README.md');
  await git('commit', '-m', 'Initialize fixture');
  await git('remote', 'add', 'origin', remote);
  await mkdir(join(work, 'docs/tables'), { recursive: true });
  await mkdir(join(work, '.lazada-search'));
  await writeFile(
    join(work, 'docs/tables/report.md'),
    'Verified fixture price\n'
  );
  await writeFile(
    join(work, '.lazada-search/private.json'),
    'Private fixture\n'
  );
  await writeFile(join(work, 'unrelated.txt'), 'Unrelated user work\n');
  const result = await publishCollectionCheckpoint({ cwd: work, push: true });
  assert.equal(result.changed, true);
  assert.equal(result.pushed, true);
  const tree = await git('ls-tree', '-r', '--name-only', 'HEAD');
  assert.match(tree, /docs\/tables\/report.md/u);
  assert.doesNotMatch(tree, /private|unrelated/u);
  assert.equal(
    (
      await execute('git', [
        '--git-dir',
        remote,
        'rev-parse',
        'refs/heads/main',
      ])
    ).stdout.trim(),
    result.commit
  );
  const retry = await publishCollectionCheckpoint({ cwd: work, push: true });
  assert.equal(retry.changed, false);
  assert.equal(retry.commit, result.commit);
  await writeFile(join(work, 'unrelated.txt'), 'Staged user work\n');
  await git('add', 'unrelated.txt');
  await assert.rejects(
    publishCollectionCheckpoint({ cwd: work }),
    /existing staged changes/u
  );
  assert.equal(
    await readFile(join(work, 'unrelated.txt'), 'utf8'),
    'Staged user work\n'
  );
});

test('checkpoint path selection rejects private stores and path traversal before any Git mutation', async () => {
  for (const paths of [
    ['.lazada-search'],
    ['.git'],
    ['/tmp/report'],
    ['docs/acceptance/../../.lazada-search'],
    [],
  ]) {
    await assert.rejects(
      publishCollectionCheckpoint({ paths }),
      /only public report/u
    );
  }
});

test('every completed or challenged batch publishes its fresh audit before the Git checkpoint', async () => {
  const events = [];
  let pass = 0;
  const audit = async () => {
    events.push('audit');
    return {
      discoveryComplete: true,
      failures: [],
      collectableUrls: pass ? [] : ['pending'],
      deferredUrls: [],
      categoryReview: [],
    };
  };
  const hooks = {
    discover: async () => events.push('discover'),
    collect: async () => {
      events.push('collect');
      pass++;
    },
    audit,
    publish: async () => events.push('publish'),
    checkpoint: async () => events.push('checkpoint'),
  };
  await runAccountCase(hooks);
  assert.deepEqual(events, [
    'discover',
    'publish',
    'audit',
    'checkpoint',
    'collect',
    'publish',
    'audit',
    'checkpoint',
  ]);
  events.length = 0;
  pass = 0;
  await assert.rejects(
    runAccountCase({
      ...hooks,
      collect: async () => {
        events.push('challenge');
        throw new Error('CAPTCHA stopped');
      },
    }),
    /CAPTCHA/u
  );
  assert.deepEqual(events, [
    'discover',
    'publish',
    'audit',
    'checkpoint',
    'challenge',
    'publish',
    'audit',
    'checkpoint',
  ]);
});
