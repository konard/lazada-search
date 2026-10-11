import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { sha256 } from '../src/util.js';

const execute = promisify(execFile);

test('Git autocrlf checkout preserves original OCR, Links Notation and cached HTML bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-source-checkout-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const attributes = await readFile(
    new URL('../.gitattributes', import.meta.url)
  );
  const tsv = await readFile(
    new URL(
      '../docs/acceptance/decimal-ocr/original-psm11.tsv',
      import.meta.url
    )
  );
  const notation = await readFile(
    new URL(
      './fixtures/public-cache/store/product/3c3cd22c52fbecdba9e230d97f19edebfe80c5998d988faef06f66d41a80bf8f.lino',
      import.meta.url
    )
  );
  const sources = new Map([
    ['docs/acceptance/decimal-ocr/original-psm11.tsv', tsv],
    ['tests/fixtures/public-cache/store/product/original.lino', notation],
    ['data/cases/source.html', Buffer.from('<p>Sô cô la</p>\r\n<p>40 g</p>\n')],
  ]);
  await writeFile(join(directory, '.gitattributes'), attributes);
  for (const [path, bytes] of sources) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), bytes);
  }
  await writeFile(join(directory, 'control.txt'), 'Ordinary text\n');
  const git = (...args) => execute('git', args, { cwd: directory });
  await git('init');
  await git('-c', 'core.autocrlf=false', 'add', '.');
  const restored = join(directory, 'restored');
  await mkdir(restored);
  await git(
    '-c',
    'core.autocrlf=true',
    'checkout-index',
    '--all',
    '--force',
    `--prefix=${restored}${sep}`
  );
  for (const [path, bytes] of sources) {
    const checkedOut = await readFile(join(restored, path));
    assert.deepEqual(checkedOut, bytes, path);
    assert.equal(sha256(checkedOut), sha256(bytes), path);
  }
  assert.equal(
    await readFile(join(restored, 'control.txt'), 'utf8'),
    'Ordinary text\r\n',
    'The control proves Git CRLF conversion was enabled'
  );
});
