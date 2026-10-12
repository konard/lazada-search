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
    const previous = await readFile(join(directory, 'owner.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (!previous || alive(previous.pid)) {
      const busy = new Error(
        'Case workflow is already running; reuse its checkpoint'
      );
      busy.code = 'WORKFLOW_BUSY';
      throw busy;
    }
    await rm(directory, { recursive: true });
    return acquireCaseLease(application, workflowId);
  }
  await writeFile(join(directory, 'owner.json'), JSON.stringify(owner), {
    mode: 0o600,
  });
  return async () => {
    const current = await readFile(join(directory, 'owner.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (current?.nonce === owner.nonce) {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
