import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encode, decode } from 'lino-objects-codec';
import {
  patchLinoLargeDocuments,
  readPristineLinoSource,
  LINO_PRISTINE_SHA256,
  LINO_PATCHED_SHA256,
  LINO_PREVIOUS_PATCH_SHA256,
  buildPatchedLinoSource,
} from '../scripts/patch-lino-large-documents.mjs';

const installed = resolve(
  dirname(fileURLToPath(import.meta.resolve('lino-objects-codec'))),
  '..'
);
const pristine = await readPristineLinoSource(installed);
const digest = (source) => createHash('sha256').update(source).digest('hex');
const execute = promisify(execFile);

async function fixture(t, { version = '0.9.0', source = pristine } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-lino-patch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'src'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'lino-objects-codec', version, type: 'module' })
  );
  await writeFile(join(directory, 'src/readable.js'), source);
  await writeFile(
    join(directory, 'src/debug.js'),
    await readFile(join(installed, 'src/debug.js'))
  );
  return directory;
}

async function patchedDecoder(t) {
  const directory = await fixture(t);
  await patchLinoLargeDocuments({ packageDirectory: directory });
  return import(pathToFileURL(join(directory, 'src/readable.js')).href);
}

test('installer checks exact pristine/patched hashes, caches official original and is idempotent without changing patched source', async (t) => {
  const directory = await fixture(t);
  const first = await patchLinoLargeDocuments({ packageDirectory: directory });
  assert.equal(first.applied, true);
  assert.equal(first.pristineSha256, LINO_PRISTINE_SHA256);
  assert.equal(first.patchedSha256, LINO_PATCHED_SHA256);
  const path = join(directory, 'src/readable.js');
  assert.equal(digest(await readFile(path)), LINO_PATCHED_SHA256);
  assert.equal(
    digest(await readPristineLinoSource(directory)),
    LINO_PRISTINE_SHA256
  );
  const before = (await stat(path)).mtimeMs;
  const again = await patchLinoLargeDocuments({ packageDirectory: directory });
  assert.equal(again.applied, false);
  assert.equal((await stat(path)).mtimeMs, before);
  assert.equal(again.globalMonkeyPatch, false);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(directory, 'lazada-large-document-patch.json'))
    ),
    again
  );
});

test('unknown0.9.0 content and unsupported versions fail closed; future official versions remain byte-identical', async (t) => {
  const unknown = await fixture(t, {
    source: `${pristine}\n//unexpected source\n`,
  });
  const before = await readFile(join(unknown, 'src/readable.js'));
  await assert.rejects(
    patchLinoLargeDocuments({ packageDirectory: unknown }),
    /Unknown/u
  );
  assert.deepEqual(await readFile(join(unknown, 'src/readable.js')), before);
  const older = await fixture(t, { version: '0.8.9' });
  await assert.rejects(
    patchLinoLargeDocuments({ packageDirectory: older }),
    /Unsupported/u
  );
  const future = await fixture(t, {
    version: '0.9.1',
    source: 'export const official = true;\n',
  });
  assert.deepEqual(
    await patchLinoLargeDocuments({ packageDirectory: future }),
    { version: '0.9.1', status: 'official-decoder', applied: false }
  );
  assert.equal(
    await readFile(join(future, 'src/readable.js'), 'utf8'),
    'export const official = true;\n'
  );
});

test('known earlier patch upgrades only from its verified pristine backup and refuses missing or changed backup', async (t) => {
  const start = '  if (opening === 1) {';
  const end = '\n\n  let i = start + opening;';
  const patched = buildPatchedLinoSource(pristine);
  const previous =
    patched.slice(0, patched.indexOf(start)) +
    pristine.slice(pristine.indexOf(start), pristine.indexOf(end)) +
    patched.slice(patched.indexOf(end));
  assert.equal(digest(previous), LINO_PREVIOUS_PATCH_SHA256);
  for (const original of [undefined, `${pristine}\n`, pristine]) {
    const directory = await fixture(t, { source: previous });
    if (original) {
      await writeFile(
        join(directory, '.lazada-readable-0.9.0.original.js'),
        original
      );
    }
    if (original === pristine) {
      const receipt = await patchLinoLargeDocuments({
        packageDirectory: directory,
      });
      assert.equal(receipt.sourceSha256, LINO_PREVIOUS_PATCH_SHA256);
      assert.equal(receipt.patchedSha256, LINO_PATCHED_SHA256);
      assert.equal(receipt.patchVersion, 2);
      assert.equal(receipt.applied, true);
    } else {
      await assert.rejects(
        patchLinoLargeDocuments({ packageDirectory: directory })
      );
      assert.equal(
        digest(await readFile(join(directory, 'src/readable.js'))),
        LINO_PREVIOUS_PATCH_SHA256
      );
    }
  }
});

test('temporary patched decoder preserves Unicode, nested records, quote runs and escaped control characters', async (t) => {
  const patched = await patchedDecoder(t);
  for (const value of [
    { text: 'Tiếng Việt 🍫 日本語\nSecond line\tend' },
    { text: `'single' and "double" and '''triple'''` },
    { text: `"begins with delimiter and ends with '"` },
    {
      text: '\r\u0001🍫%AA',
      nested: [{ unicode: '😀' }, ['🍫', null, false, 12.5], {}],
    },
  ]) {
    assert.deepEqual(patched.decode(encode({ obj: value })), value);
  }
  const lone = { text: '\r\ud800' };
  assert.deepEqual(
    patched.decode(encode({ obj: lone })),
    decode({ notation: encode({ obj: lone }) })
  );
});

test('valid notation beyond the old32MiB character-array boundary decodes without whole-document character allocation', async (t) => {
  const patched = await patchedDecoder(t);
  const value = { id: 'large-document-fixture', text: '🍫 Việt Nam', count: 5 };
  const notation = `${' '.repeat(2 ** 25 + 1024)}${encode({ obj: value })}`;
  assert.ok(Buffer.byteLength(notation) > 2 ** 25);
  assert.deepEqual(patched.decode(notation), value);
});

test('a long single-quoted value decodes in a bounded heap without per-character ropes, preserving legacy doubled quotes', async (t) => {
  const directory = await fixture(t);
  await patchLinoLargeDocuments({ packageDirectory: directory });
  const url = pathToFileURL(join(directory, 'src/readable.js')).href;
  const script = `
    import assert from 'node:assert/strict';
    import {decode} from ${JSON.stringify(url)};
    const text = 'a'.repeat(16 * 1024 ** 2) + '🍫';
    assert.ok(decode('text "' + text + '"').text === text);
    assert.equal(decode('text "legacy ""value"" finish"').text, 'legacy "value" finish');
    assert.throws(() => decode('text "unterminated'), SyntaxError);
    console.log('bounded-heap round-trip passed');
  `;
  const result = await execute(
    process.execPath,
    ['--max-old-space-size=128', '--input-type=module', '-e', script],
    { timeout: 15000, maxBuffer: 1024 * 1024 }
  );
  assert.equal(result.stdout.trim(), 'bounded-heap round-trip passed');
});

test('escaped UTF8 streaming preserves codepoints crossing64KiB boundaries and rejects malformed values without contaminating the next decode', async (t) => {
  const patched = await patchedDecoder(t);
  const value = { text: `${'a'.repeat(65535)}🍫${'b'.repeat(65535)}\r\u0001` };
  assert.deepEqual(patched.decode(encode({ obj: value })), value);
  for (const notation of [
    '(escaped "%F0%9F")',
    '(escaped "%FF")',
    '(escaped "%0")',
    '(escaped "%GG")',
  ]) {
    assert.throws(() => patched.decode(notation), SyntaxError);
    assert.equal(patched.decode('(escaped "%F0%9F%8D%AB")'), '🍫');
  }
});

test('published package includes exact postinstall installer and preserves prepare hook', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url))
  );
  assert.equal(
    metadata.scripts.postinstall,
    'node scripts/patch-lino-large-documents.mjs'
  );
  assert.equal(metadata.scripts.prepare, 'node scripts/install-git-hooks.mjs');
  assert.ok(metadata.files.includes('scripts/patch-lino-large-documents.mjs'));
});
