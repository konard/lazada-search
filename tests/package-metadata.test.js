import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../bin/lazada-search.js';

test('package identity, installed executable and library export are usable', async () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.equal(manifest.name, 'lazada-search');
  assert.equal(lock.name, manifest.name);
  assert.deepEqual(manifest.bin, { 'lazada-search': './bin/lazada-search.js' });
  const lines = [];
  assert.equal(
    await runCli(['--help'], { stdout: (line) => lines.push(line) }),
    0
  );
  assert.ok(lines[0].includes('compare'));
  const root = mkdtempSync(join(tmpdir(), 'lazada-bin-'));
  try {
    const bin = join(root, 'lazada-search');
    symlinkSync(resolve('bin/lazada-search.js'), bin);
    const result = spawnSync(process.execPath, [bin, '--version'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), manifest.version);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local and explicit .lenv configuration keep CLI JSON stdout machine-readable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lazada-config-'));
  try {
    writeFileSync(
      join(directory, '.lenv'),
      "LAZADA_DELIVERY_AREA: 'Nha Trang'\n"
    );
    writeFileSync(
      join(directory, 'custom.lenv'),
      "LAZADA_DELIVERY_AREA: 'Custom area'\n"
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('LAZADA_'))
    );
    for (const config of [[], ['--configuration', 'custom.lenv']]) {
      const result = spawnSync(
        process.execPath,
        [
          resolve('bin/lazada-search.js'),
          'compare',
          '--data-dir',
          join(directory, 'data'),
          ...config,
        ],
        { cwd: directory, env, encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(
        report.assumptions.deliveryArea,
        config.length ? 'Custom area' : 'Nha Trang'
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
