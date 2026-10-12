import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { expect } from 'test-anywhere';

const config = JSON.parse(readFileSync('.changeset/config.json', 'utf8'));

async function terminateReleaseTree(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
    return;
  }
  await new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    let failure;
    killer.once('error', (error) => {
      failure = error;
    });
    killer.once('close', (code, signal) => {
      if (failure || code !== 0 || signal) {
        reject(
          failure ||
            new Error(
              `Owned release tree termination failed: ${code}/${signal}`
            )
        );
      } else {
        resolve();
      }
    });
  });
}

async function runReleaseChild(args, { cwd, env, signal, onStdout } = {}) {
  signal?.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const child = spawn('node', args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let failure;
    let termination;
    const abort = () => {
      if (termination || !child.pid) {
        return;
      }
      failure = Object.assign(
        new Error('Release test cancelled', { cause: signal.reason }),
        {
          name: 'AbortError',
          code: 'ABORT_ERR',
        }
      );
      termination = terminateReleaseTree(child.pid).catch((error) => {
        failure.cleanupSafe = false;
        failure.cleanupError = error;
      });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', async (exitCode, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      await termination;
      const result = { exitCode, exitSignal, stdout, stderr, pid: child.pid };
      if (failure || exitCode !== 0 || exitSignal) {
        const error =
          failure ||
          new Error(
            `Release child exited with ${exitCode}/${exitSignal}\n${stdout}\n${stderr}`
          );
        reject(Object.assign(error, result));
      } else {
        resolve(result);
      }
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}

function processCanWrite(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
  if (process.platform === 'win32') {
    return true;
  }
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (state.error) {
    throw state.error;
  }
  if (state.status === 1 && !state.stdout.trim() && !state.stderr.trim()) {
    return false;
  }
  assert.equal(state.status, 0, `Owned process state failed: ${state.stderr}`);
  assert.equal(state.signal, null);
  assert.equal(state.stderr.trim(), '');
  const value = state.stdout.trim();
  assert.match(value, /^[A-Za-z][A-Za-z0-9+<]*$/);
  return !value.startsWith('Z');
}

describe('Changesets release formatter', () => {
  it('uses the same formatter as the project formatting check', () => {
    expect(config.format).toBe('prettier');
  });

  it('references the release Changesets config schema', () => {
    const isDeno = typeof Deno !== 'undefined';
    const metadata = JSON.parse(
      readFileSync(
        isDeno
          ? 'package-lock.json'
          : 'node_modules/@changesets/config/package.json',
        'utf8'
      )
    );
    const version = isDeno
      ? metadata.packages['node_modules/@changesets/config'].version
      : metadata.version;
    expect(config.$schema).toBe(
      `https://unpkg.com/@changesets/config@${version}/schema.json`
    );
  });

  it('versions and formats the real package with Deno absent from PATH', async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'changeset-version-'));
    let cleanupSafe = true;
    try {
      for (const file of [
        'package.json',
        'deno.json',
        'deno.lock',
        '.prettierrc',
      ]) {
        copyFileSync(file, join(cwd, file));
      }
      mkdirSync(join(cwd, '.changeset'));
      copyFileSync(
        '.changeset/config.json',
        join(cwd, '.changeset/config.json')
      );
      // Match the Linux release runner even when the checkout uses Windows CRLF.
      const manifest = readFileSync(
        join(cwd, 'package.json'),
        'utf8'
      ).replaceAll('\r\n', '\n');
      writeFileSync(join(cwd, 'package.json'), manifest);
      const pkg = JSON.parse(manifest);
      writeFileSync(
        join(cwd, '.changeset/release-check.md'),
        `---\n"${pkg.name}": patch\n---\n\nCheck release versioning.\n`
      );
      writeFileSync(join(cwd, 'CHANGELOG.md'), `# ${pkg.name}\n`);
      symlinkSync(
        resolve('node_modules'),
        join(cwd, 'node_modules'),
        'junction'
      );
      const env = { ...process.env };
      const pathKey = Object.keys(env).find(
        (key) => key.toUpperCase() === 'PATH'
      );
      assert.ok(pathKey, 'The release fixture needs Node and npm on PATH');
      env[pathKey] = env[pathKey]
        .split(delimiter)
        .filter(
          (dir) =>
            !['deno', 'deno.exe', 'deno.cmd'].some((name) =>
              existsSync(join(dir, name))
            )
        )
        .join(delimiter);
      assert.equal(
        spawnSync('deno', ['--version'], { env }).error?.code,
        'ENOENT'
      );
      const run = async (file, args) => {
        const result = await runReleaseChild([resolve(file), ...args], {
          cwd,
          env,
          signal: t.signal,
        }).catch((error) => {
          cleanupSafe = error.cleanupSafe !== false;
          throw error;
        });
        assert.equal(result.exitCode, 0, `${result.stdout}\n${result.stderr}`);
      };
      await run('node_modules/@changesets/cli/bin.js', ['version']);
      const versionParts = pkg.version.split('.').map(Number);
      versionParts[2] += 1;
      expect(
        JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).version
      ).toBe(versionParts.join('.'));
      expect(existsSync(join(cwd, '.changeset/release-check.md'))).toBe(false);
      expect(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8')).toContain(
        'Check release versioning.'
      );
      await run('node_modules/prettier/bin/prettier.cjs', [
        '--check',
        'package.json',
        'CHANGELOG.md',
      ]);
    } finally {
      if (cleanupSafe) {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});

describe('release child completion', () => {
  it('waits for actual close even after completion text is written', async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'changeset-child-completion-'));
    let cleanupSafe = true;
    const controller = new AbortController();
    let started;
    let complete = false;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const operation = runReleaseChild(
      [
        '-e',
        `const fs=require('node:fs');process.stdout.write('All files have been updated.\\n');const timer=setInterval(()=>{if(fs.existsSync('release')){fs.writeFileSync('closed-output','verified');clearInterval(timer);}},5);`,
      ],
      {
        cwd,
        signal: AbortSignal.any([t.signal, controller.signal]),
        onStdout: started,
      }
    ).then((result) => {
      complete = true;
      return result;
    });
    try {
      await Promise.race([ready, operation]);
      assert.equal(complete, false);
      assert.equal(existsSync(join(cwd, 'closed-output')), false);
      writeFileSync(join(cwd, 'release'), 'continue');
      const result = await operation;
      assert.equal(result.exitCode, 0);
      assert.equal(
        readFileSync(join(cwd, 'closed-output'), 'utf8'),
        'verified'
      );
    } finally {
      controller.abort();
      await operation.catch((error) => {
        cleanupSafe = error.cleanupSafe !== false;
      });
      if (cleanupSafe) {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });

  it('retains nonzero failure even after completion output', async (t) => {
    await assert.rejects(
      runReleaseChild(
        [
          '-e',
          "process.stdout.write('All files have been updated.\\n');process.exitCode=29;",
        ],
        { signal: t.signal }
      ),
      (error) =>
        error.exitCode === 29 &&
        error.exitSignal === null &&
        error.stdout.includes('All files have been updated.')
    );
  });

  it('cancellation kills and drains the child before cleanup without accepting completion output', async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'changeset-child-cancel-'));
    let cleanupSafe = true;
    const controller = new AbortController();
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const operation = runReleaseChild(
      [
        '-e',
        "process.stdout.write('All files have been updated.\\n');setInterval(()=>{},1000);",
      ],
      {
        cwd,
        signal: AbortSignal.any([t.signal, controller.signal]),
        onStdout: started,
      }
    );
    try {
      await Promise.race([ready, operation]);
      controller.abort(new Error('Release test cancelled'));
      await assert.rejects(operation, (error) => {
        assert.equal(error.name, 'AbortError');
        if (process.platform !== 'win32') {
          assert.equal(error.exitCode, null);
          assert.equal(error.exitSignal, 'SIGKILL');
        } else {
          assert.notEqual(error.exitCode, 0);
        }
        assert.notEqual(error.cleanupSafe, false);
        assert.ok(error.stdout.includes('All files have been updated.'));
        assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' });
        return true;
      });
    } finally {
      controller.abort();
      await operation.catch((error) => {
        cleanupSafe = error.cleanupSafe !== false;
      });
      if (cleanupSafe) {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});

describe('release formatter descendants', () => {
  it('cancellation stops the actual owned grandchild before temporary package removal', async (t) => {
    const cwd = mkdtempSync(join(tmpdir(), 'changeset-child-tree-'));
    const controller = new AbortController();
    let descendantPid;
    let cleanupSafe = true;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const grandchild = `const fs=require('node:fs');fs.writeFileSync('descendant-ready.tmp',String(process.pid));fs.renameSync('descendant-ready.tmp','descendant-ready');const timer=setInterval(()=>{if(fs.existsSync('release-descendant')){fs.writeFileSync('late-output','unsafe write after parent close');clearInterval(timer);}},5);`;
    const parent = `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});const timer=setInterval(()=>{if(fs.existsSync('descendant-ready')){process.stdout.write('All files have been updated.\\n');clearInterval(timer);setInterval(()=>{},1000);}},5);`;
    const operation = runReleaseChild(['-e', parent], {
      cwd,
      signal: AbortSignal.any([t.signal, controller.signal]),
      onStdout: started,
    });
    try {
      await Promise.race([ready, operation]);
      descendantPid = Number(
        readFileSync(join(cwd, 'descendant-ready'), 'utf8')
      );
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
      assert.equal(processCanWrite(descendantPid), true);
      controller.abort(new Error('Cancel release with a live formatter'));
      await assert.rejects(operation, (error) => {
        cleanupSafe = error.cleanupSafe !== false;
        assert.equal(error.name, 'AbortError');
        assert.equal(cleanupSafe, true);
        assert.throws(() => process.kill(error.pid, 0), { code: 'ESRCH' });
        return true;
      });
      while (processCanWrite(descendantPid)) {
        t.signal.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      writeFileSync(
        join(cwd, 'release-descendant'),
        'parent close already drained'
      );
      assert.equal(existsSync(join(cwd, 'late-output')), false);
    } finally {
      controller.abort();
      await operation.catch((error) => {
        cleanupSafe = error.cleanupSafe !== false;
      });
      if (descendantPid && processCanWrite(descendantPid)) {
        process.kill(descendantPid, 'SIGKILL');
      }
      if (cleanupSafe) {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });
});

describe('credential-free PR release versioning', () => {
  it('checks the fresh merge in the independent lint job and discards changes', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const lint = workflow.split('\n  lint:')[1].split('\n  test:')[0];
    expect(lint).toContain('needs: [detect-changes]');
    expect(lint).toContain('Dry-run release versioning');
    expect(lint).toContain('npm run changeset:version');
    expect(lint).toContain(
      "trap 'git restore --source=HEAD --staged --worktree -- .' EXIT"
    );
    expect(lint.indexOf('Dry-run release versioning')).toBeGreaterThan(
      lint.indexOf('Simulate fresh merge')
    );
  });
});
