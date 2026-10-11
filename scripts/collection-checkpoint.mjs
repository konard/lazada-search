import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { isAbsolute, posix } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const COLLECTION_CHECKPOINT_PATHS = Object.freeze([
  'docs/tables',
  'docs/acceptance',
  'data/cases/vietnam-nha-trang',
]);

function validatePaths(paths) {
  if (
    !paths.length ||
    paths.some(
      (path) =>
        isAbsolute(path) ||
        posix.normalize(path) !== path ||
        !COLLECTION_CHECKPOINT_PATHS.some(
          (root) => path === root || path.startsWith(`${root}/`)
        )
    )
  ) {
    throw new Error(
      'Collection checkpoint accepts only public report and case archive paths'
    );
  }
}

function stagedCheckpoint(branch, paths, deferStaged, reason) {
  if (!deferStaged) {
    const error = new Error(
      'Finish the existing staged changes before publishing a collection checkpoint'
    );
    error.code = 'CHECKPOINT_STAGED_CHANGES';
    throw error;
  }
  return {
    changed: false,
    deferred: true,
    reason,
    retry: 'next-batch',
    branch,
    pushed: false,
    paths,
  };
}

async function presentPaths(cwd, paths) {
  const present = [];
  for (const path of paths) {
    try {
      await access(`${cwd}/${path}`);
      present.push(path);
    } catch {
      // A case may not have emitted every optional report directory yet.
    }
  }
  return present;
}

export async function publishCollectionCheckpoint({
  cwd = process.cwd(),
  paths = COLLECTION_CHECKPOINT_PATHS,
  push = false,
  remote = 'origin',
  message = 'Publish verified cached Lazada collection checkpoint',
  deferStaged = false,
  executeGit,
} = {}) {
  validatePaths(paths);
  if (typeof deferStaged !== 'boolean') {
    throw new Error('Checkpoint staged-change deferral must be boolean');
  }
  const git = async (...args) =>
    (
      await (executeGit ?? execute)('git', args, {
        cwd,
        maxBuffer: 16 * 1024 ** 2,
      })
    ).stdout.trim();
  const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (!branch) {
    throw new Error('Collection checkpoint requires an attached branch');
  }
  if (await git('diff', '--cached', '--name-only')) {
    return stagedCheckpoint(branch, [], deferStaged, 'existing-staged-changes');
  }
  const present = await presentPaths(cwd, paths);
  if (present.length) {
    await git('add', '--', ...present);
  }
  const staged = (await git('diff', '--cached', '--name-only', '-z'))
    .split('\0')
    .filter(Boolean);
  if (
    staged.some(
      (path) =>
        !present.some((root) => path === root || path.startsWith(`${root}/`))
    )
  ) {
    return stagedCheckpoint(
      branch,
      present,
      deferStaged,
      'staged-changes-during-checkpoint'
    );
  }
  const changed = staged.length > 0;
  if (changed) {
    // Git's partial commit uses a temporary index, preserving other staging
    // even if it begins after the checks above.
    await git('commit', '--only', '-m', message, '--', ...present);
  }
  const commit = await git('rev-parse', 'HEAD');
  // A retry also pushes a checkpoint whose earlier push failed after commit.
  if (push) {
    await git('push', remote, `HEAD:refs/heads/${branch}`);
  }
  return { changed, commit, branch, pushed: push, paths: present };
}
