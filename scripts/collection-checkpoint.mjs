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

export async function publishCollectionCheckpoint({
  cwd = process.cwd(),
  paths = COLLECTION_CHECKPOINT_PATHS,
  push = false,
  remote = 'origin',
  message = 'Publish verified cached Lazada collection checkpoint',
} = {}) {
  validatePaths(paths);
  const git = async (...args) =>
    (
      await execute('git', args, { cwd, maxBuffer: 16 * 1024 ** 2 })
    ).stdout.trim();
  const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD');
  if (!branch) {
    throw new Error('Collection checkpoint requires an attached branch');
  }
  if (await git('diff', '--cached', '--name-only')) {
    throw new Error(
      'Finish the existing staged changes before publishing a collection checkpoint'
    );
  }
  const present = [];
  for (const path of paths) {
    try {
      await access(`${cwd}/${path}`);
      present.push(path);
    } catch {
      // A case may not have emitted every optional report directory yet.
    }
  }
  if (present.length) {
    await git('add', '--', ...present);
  }
  const changed = Boolean(await git('diff', '--cached', '--name-only'));
  if (changed) {
    await git('commit', '-m', message);
  }
  const commit = await git('rev-parse', 'HEAD');
  // A retry also pushes a checkpoint whose earlier push failed after commit.
  if (push) {
    await git('push', remote, `HEAD:refs/heads/${branch}`);
  }
  return { changed, commit, branch, pushed: push, paths: present };
}
