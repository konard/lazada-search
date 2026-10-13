import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './util.js';

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function busy() {
  const error = new Error(
    'Case workflow is already running or its orphan lock requires inspection; reuse its checkpoint'
  );
  error.code = 'WORKFLOW_BUSY';
  return error;
}

const readOwner = (directory) =>
  readFile(join(directory, 'owner.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);

function identified(owner) {
  return Boolean(
    owner &&
    typeof owner.nonce === 'string' &&
    /^[a-f\d-]{36}$/u.test(owner.nonce) &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    Number.isFinite(Date.parse(owner.acquiredAt))
  );
}

async function recoverDeadOwner(application, workflowId, directory, previous) {
  // Only one reaper can examine and remove the old lease. Re-read its owner
  // under this claim so a contender cannot delete a newly acquired live lease.
  const recovery = `${directory}.recovery`;
  try {
    await mkdir(recovery, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw busy();
    }
    throw error;
  }
  try {
    const current = await readOwner(directory);
    if (
      !identified(current) ||
      current.nonce !== previous.nonce ||
      current.pid !== previous.pid ||
      alive(current.pid)
    ) {
      throw busy();
    }
    await rm(directory, { recursive: true });
    return await acquireCaseLease(application, workflowId);
  } finally {
    await rm(recovery, { recursive: true, force: true });
  }
}

export async function acquireCaseLease(application, workflowId) {
  const root = join(application.store.directory, '.case-workflow-locks');
  const directory = join(root, sha256(workflowId));
  const owner = {
    nonce: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    const previous = await readOwner(directory);
    if (!identified(previous) || alive(previous.pid)) {
      throw busy();
    }
    return recoverDeadOwner(application, workflowId, directory, previous);
  }
  await writeFile(join(directory, 'owner.json'), JSON.stringify(owner), {
    mode: 0o600,
  });
  return async () => {
    const current = await readOwner(directory);
    if (current?.nonce === owner.nonce) {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
