import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const LINO_PRISTINE_SHA256 =
  '48da62594f5125ce23110802a24d98996408bb516c4ff7a79933ff285396a604';
export const LINO_PATCHED_SHA256 =
  '37e3b9e0fbe7250ee7fe6103decc42f1eb21d2ab21686cbccbcf2648fa8c3122';
export const LINO_PREVIOUS_PATCH_SHA256 =
  'f3fe94603fde5aad333aadcbd44749041bdbdf0d05d8cd75b2604b27e3abb313';
const originalName = '.lazada-readable-0.9.0.original.js';
const digest = (source) => createHash('sha256').update(source).digest('hex');
const originalSingleQuoted = `  if (opening === 1) {
    let value = '';
    let i = start + 1;

    while (i < chars.length) {
      if (chars[i] === quoteChar) {
        if (chars[i + 1] === quoteChar) {
          value += quoteChar;
          i += 2;
          continue;
        }
        return [value, i + 1];
      }
      value += chars[i];
      i += 1;
    }

    throw unterminatedQuote(start);
  }`;
const singleQuoted = `  if (opening === 1) {
    let i = start + 1;
    while (i < chars.length) {
      const next = chars.indexOf(quoteChar, i);
      if (next < 0) {
        break;
      }
      if (chars[next + 1] === quoteChar) {
        i = next + 2;
        continue;
      }
      const value = chars.slice(start + 1, next);
      return [value.replaceAll(quoteChar + quoteChar, quoteChar), next + 1];
    }
    throw unterminatedQuote(start);
  }`;
const escapedDecoder = `function unescape(payload) {
  const decoder = UTF8_DECODER();
  const buffer = new Uint8Array(65536);
  const output = [];
  let used = 0;
  const flush = (stream) => {
    try {
      output.push(decoder.decode(buffer.subarray(0, used), { stream }));
    } catch {
      throw new SyntaxError('invalid UTF-8 escaped value');
    }
    used = 0;
  };
  const append = (byte) => {
    buffer[used++] = byte;
    if (used === buffer.length) {
      flush(true);
    }
  };
  let i = 0;
  while (i < payload.length) {
    if (payload[i] !== '%') {
      const code = payload.codePointAt(i);
      if (code < 128) {
        append(code);
        i += 1;
      } else {
        const character = String.fromCodePoint(code);
        for (const byte of UTF8_ENCODER.encode(character)) {
          append(byte);
        }
        i += character.length;
      }
      continue;
    }
    const escape = payload.slice(i + 1, i + 3);
    if (escape.length !== 2) {
      throw new SyntaxError(
        \`truncated escape at character \${i} of an escaped value\`
      );
    }
    if (!/^[0-9a-fA-F]{2}$/.test(escape)) {
      throw new SyntaxError(\`invalid escape '%\${escape}' in an escaped value\`);
    }
    append(Number.parseInt(escape, 16));
    i += 3;
  }
  flush(false);
  return output.join('');
}`;

function replaceOnce(source, before, after) {
  if (
    !source.includes(before) ||
    source.indexOf(before) !== source.lastIndexOf(before)
  ) {
    throw new Error('Known lino decoder patch location is not unique');
  }
  return source.replace(before, after);
}

export function buildPatchedLinoSource(pristine) {
  if (digest(pristine) !== LINO_PRISTINE_SHA256) {
    throw new Error(
      'Unknown lino-objects-codec0.9.0 source; refusing guessed patch'
    );
  }
  let source = pristine;
  for (const [before, after] of [
    ['const chars = Array.from(text);', 'const chars = text;'],
    ["value: chars.slice(start, i).join(''),", 'value: chars.slice(start, i),'],
    [
      "const value = chars.slice(start + opening, i + run - opening).join('');",
      'const value = chars.slice(start + opening, i + run - opening);',
    ],
    [
      "const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });",
      "const UTF8_DECODER = () => new TextDecoder('utf-8', { fatal: true });",
    ],
  ]) {
    source = replaceOnce(source, before, after);
  }
  source = replaceOnce(source, originalSingleQuoted, singleQuoted);
  const start = source.indexOf('function unescape(payload) {');
  const end = source.indexOf(
    '\n\n/**\n * Convert a reference to a value.',
    start
  );
  if (start < 0 || end < 0) {
    throw new Error('Known escaped-value decoder location is missing');
  }
  return source.slice(0, start) + escapedDecoder + source.slice(end);
}

function officialFuture(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return Boolean(
    match &&
    (Number(match[1]) > 0 ||
      Number(match[2]) > 9 ||
      (Number(match[2]) === 9 && Number(match[3]) > 0))
  );
}

export async function readPristineLinoSource(packageDirectory) {
  const current = await readFile(
    join(packageDirectory, 'src/readable.js'),
    'utf8'
  );
  const original =
    digest(current) === LINO_PRISTINE_SHA256
      ? current
      : await readFile(join(packageDirectory, originalName), 'utf8');
  if (digest(original) !== LINO_PRISTINE_SHA256) {
    throw new Error('Cached pristine codec source digest mismatch');
  }
  return original;
}

export async function patchLinoLargeDocuments({ packageDirectory } = {}) {
  const directory =
    packageDirectory ||
    resolve(
      dirname(fileURLToPath(import.meta.resolve('lino-objects-codec'))),
      '..'
    );
  const metadata = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8')
  );
  if (metadata.name !== 'lino-objects-codec') {
    throw new Error('Large-document patch requires the exact codec package');
  }
  if (metadata.version !== '0.9.0') {
    if (!officialFuture(metadata.version)) {
      throw new Error('Unsupported codec version; no patch was applied');
    }
    return {
      version: metadata.version,
      status: 'official-decoder',
      applied: false,
    };
  }
  const path = join(directory, 'src/readable.js');
  const original = await readFile(path, 'utf8');
  const sourceSha256 = digest(original);
  if (
    ![
      LINO_PRISTINE_SHA256,
      LINO_PREVIOUS_PATCH_SHA256,
      LINO_PATCHED_SHA256,
    ].includes(sourceSha256)
  ) {
    throw new Error(
      'Unknown lino-objects-codec0.9.0 source; refusing guessed patch'
    );
  }
  const applied = sourceSha256 !== LINO_PATCHED_SHA256;
  if (applied) {
    // Cache the installed official original; no dependency source is vendored.
    const backup = join(directory, originalName);
    const pristine =
      sourceSha256 === LINO_PRISTINE_SHA256
        ? original
        : await readPristineLinoSource(directory);
    try {
      await writeFile(backup, pristine, { flag: 'wx' });
    } catch (error) {
      if (
        error.code !== 'EEXIST' ||
        digest(await readFile(backup)) !== LINO_PRISTINE_SHA256
      ) {
        throw error;
      }
    }
    const patched = buildPatchedLinoSource(pristine);
    if (digest(patched) !== LINO_PATCHED_SHA256) {
      throw new Error('Deterministic codec patch digest mismatch');
    }
    const temporary = `${path}.lazada-patch-${process.pid}.tmp`;
    await writeFile(temporary, patched);
    await rename(temporary, path);
  }
  const receipt = {
    version: metadata.version,
    status: 'source-hash-gated-large-document-patch',
    patchVersion: 2,
    pristineSha256: LINO_PRISTINE_SHA256,
    patchedSha256: LINO_PATCHED_SHA256,
    sourceSha256,
    applied,
    globalMonkeyPatch: false,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'lazada-large-document-patch.json'),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  return receipt;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  console.log(JSON.stringify(await patchLinoLargeDocuments()));
}
