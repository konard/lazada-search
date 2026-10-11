import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TesseractOcr } from '../src/ocr.js';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';
import {
  nativeTessdataDirectory,
  OCR_MODEL_LIMITS,
  resolveOcrModels,
} from '../src/ocr-models.js';

const tsv = (text) =>
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n' +
  `5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\t${text}\n`;

async function fixture(t, languages = 'eng', psm = 6) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-model-identity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const models = join(directory, 'native models');
  await mkdir(models);
  for (const [language, bytes] of [
    ['eng', 'model-A'],
    ['vie', 'model-V'],
    ['osd', 'model-O'],
  ]) {
    await writeFile(join(models, `${language}.traineddata`), bytes);
  }
  const store = new AssociativeStore({ directory: join(directory, 'store') });
  const blob = await store.putBlob(Buffer.from('input-image-fixture'));
  const calls = [];
  const observed = [];
  const execute = async (_command, args) => {
    calls.push(args);
    if (args[0] === '--version') {
      return { stdout: 'fixture-tesseract-model-v1\n' };
    }
    if (args[0] === '--list-langs') {
      return {
        stdout: `List of available languages in "${models}" (3):\neng\nvie\nosd\n`,
      };
    }
    const snapshot = args[args.indexOf('--tessdata-dir') + 1];
    assert.notEqual(snapshot, models);
    const names = args[args.indexOf('-l') + 1].split('+');
    if (args[args.indexOf('--psm') + 1] === '12' && !names.includes('osd')) {
      names.push('osd');
    }
    const files = [];
    for (const language of names) {
      const bytes = await readFile(join(snapshot, `${language}.traineddata`));
      files.push({ language, bytes: bytes.length, sha256: sha256(bytes) });
    }
    observed.push(files);
    return { stdout: tsv(files[0].sha256.slice(0, 8)) };
  };
  const makeOcr = (options = {}) =>
    new TesseractOcr({ store, languages, psm, execute, ...options });
  return { directory, models, store, blob, calls, observed, execute, makeOcr };
}

test('native model discovery preserves quoted POSIX, Windows and Unicode directory paths', () => {
  for (const path of [
    '/opt/homebrew/share/tessdata/',
    'C:\\Program Files\\Tesseract-OCR\\tessdata/',
    '/tmp/Nhã Trang models',
  ]) {
    assert.equal(
      nativeTessdataDirectory(
        `List of available languages in "${path}" (2):\r\neng\r\nvie\r\n`
      ),
      path
    );
  }
  assert.throws(() => nativeTessdataDirectory('eng\nvie'), /determine/u);
});

test('unchanged native model bytes reuse OCR across restart without another recognition call', async (t) => {
  const f = await fixture(t);
  const first = await f.makeOcr().recognize(f.blob);
  const second = await f.makeOcr().recognize(f.blob);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.id, first.id);
  assert.equal(f.observed.length, 1);
  assert.equal(first.modelProvenance.directorySelection, 'native');
  assert.deepEqual(
    first.modelProvenance.models.map(({ language, bytes, sha256: digest }) => ({
      language,
      bytes,
      sha256: digest,
    })),
    f.observed[0]
  );
  assert.ok(!JSON.stringify(first.modelProvenance).includes(f.directory));
  assert.equal(
    sha256(await f.store.blob(first.rawTsv.sha256)),
    first.rawTsv.sha256
  );
});

test('same-path same-length model replacement with restored mtime invalidates OCR without overwriting originals', async (t) => {
  const f = await fixture(t);
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  const original = await f.store.blob(first.rawTsv.sha256);
  const path = join(f.models, 'eng.traineddata');
  const metadata = await stat(path);
  await writeFile(path, 'model-B');
  await utimes(path, metadata.atime, metadata.mtime);
  const second = await engine.recognize(f.blob);
  assert.equal(second.cacheHit, false);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.text, second.text);
  assert.notEqual(
    first.modelProvenance.fingerprint,
    second.modelProvenance.fingerprint
  );
  assert.equal((await f.store.list('ocr')).length, 2);
  assert.deepEqual(await f.store.blob(first.rawTsv.sha256), original);
  assert.equal((await f.store.get('ocr', first.id)).text, first.text);
  assert.deepEqual(
    (await f.store.get('ocr', first.id)).modelProvenance,
    first.modelProvenance
  );
});

test('explicit eng+vie manifests bind each actual model and preserve requested language order', async (t) => {
  const f = await fixture(t, 'eng+vie');
  const first = await f.makeOcr({ tessdataDir: f.models }).recognize(f.blob);
  assert.deepEqual(
    first.modelProvenance.models.map((model) => model.language),
    ['eng', 'vie']
  );
  assert.ok(!f.calls.some((args) => args[0] === '--list-langs'));
  await writeFile(join(f.models, 'vie.traineddata'), 'model-W');
  const second = await f.makeOcr({ tessdataDir: f.models }).recognize(f.blob);
  assert.notEqual(first.id, second.id);
  const reversed = await f
    .makeOcr({ tessdataDir: f.models, languages: 'vie+eng' })
    .recognize(f.blob);
  assert.notEqual(second.id, reversed.id);
  assert.equal(reversed.modelProvenance.requestedLanguages, 'vie+eng');
});

test('sparse orientation OCR includes osd and cannot reuse a result after that model disappears', async (t) => {
  const f = await fixture(t, 'eng', 12);
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  assert.equal(first.modelProvenance.models[1].language, 'osd');
  assert.equal(first.modelProvenance.models[1].role, 'orientation');
  await rm(join(f.models, 'osd.traineddata'));
  await assert.rejects(engine.recognize(f.blob), /ENOENT/u);
  assert.equal(f.observed.length, 1);
});

test('missing or empty required models fail even with a previously cached OCR result', async (t) => {
  const f = await fixture(t, 'eng+vie');
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  const path = join(f.models, 'vie.traineddata');
  await writeFile(path, '');
  await assert.rejects(engine.recognize(f.blob), /nonempty bounded/u);
  await rm(path);
  await assert.rejects(engine.recognize(f.blob), /ENOENT/u);
  assert.deepEqual(
    (await f.store.list('ocr')).map((record) => record.id),
    [first.id]
  );
  assert.equal(f.observed.length, 1);
});

test('oversized and non-file models fail before recognition or an OCR record write', async (t) => {
  const f = await fixture(t);
  const path = join(f.models, 'eng.traineddata');
  const file = await open(path, 'w');
  await file.truncate(OCR_MODEL_LIMITS.perModelBytes + 1);
  await file.close();
  const engine = f.makeOcr({ tessdataDir: f.models });
  await assert.rejects(engine.recognize(f.blob), /nonempty bounded/u);
  await rm(path);
  await mkdir(path);
  await assert.rejects(engine.recognize(f.blob), /EISDIR|EPERM|regular file/u);
  assert.equal(f.observed.length, 0);
  assert.equal((await f.store.list('ocr')).length, 0);
});

test('total selected-model I/O is bounded independently of individual model limits', async (t) => {
  const f = await fixture(t, 'eng+vie+osd');
  for (const language of ['eng', 'vie']) {
    const file = await open(join(f.models, `${language}.traineddata`), 'w');
    await file.truncate(OCR_MODEL_LIMITS.perModelBytes);
    await file.close();
  }
  await assert.rejects(
    resolveOcrModels({
      command: 'fixture',
      execute: f.execute,
      languages: 'eng+vie+osd',
      psm: 6,
      tessdataDir: f.models,
    }),
    /nonempty bounded/u
  );
  assert.equal(f.observed.length, 0);
});

test('model replacement between identity lookup and snapshot fails without invoking or persisting OCR', async (t) => {
  const f = await fixture(t);
  const get = f.store.get.bind(f.store);
  f.store.get = async (kind, id) => {
    if (kind === 'ocr') {
      await writeFile(join(f.models, 'eng.traineddata'), 'model-B');
    }
    return await get(kind, id);
  };
  await assert.rejects(
    f.makeOcr({ tessdataDir: f.models }).recognize(f.blob),
    /execution snapshot/u
  );
  assert.equal(f.observed.length, 0);
  assert.equal((await f.store.list('ocr')).length, 0);
});

test('native invocation reads immutable snapshot bytes if the original model changes during execution', async (t) => {
  const f = await fixture(t);
  let replaced = false;
  const execute = async (command, args, options) => {
    if (args[0] !== '--version' && !replaced) {
      replaced = true;
      await writeFile(join(f.models, 'eng.traineddata'), 'model-B');
    }
    return await f.execute(command, args, options);
  };
  const engine = f.makeOcr({ tessdataDir: f.models, execute });
  const first = await engine.recognize(f.blob);
  assert.equal(first.modelProvenance.models[0].sha256, sha256('model-A'));
  assert.equal(f.observed[0][0].sha256, sha256('model-A'));
  const second = await engine.recognize(f.blob);
  assert.equal(second.modelProvenance.models[0].sha256, sha256('model-B'));
  assert.notEqual(first.id, second.id);
});

test('engine model errors and corrupted cached raw TSV never become successful cache receipts', async (t) => {
  const f = await fixture(t);
  const execute = async (command, args, options) => {
    if (args[0] !== '--version') {
      throw new Error('Native traineddata rejected');
    }
    return await f.execute(command, args, options);
  };
  await assert.rejects(
    f.makeOcr({ tessdataDir: f.models, execute }).recognize(f.blob),
    /traineddata rejected/u
  );
  assert.equal((await f.store.list('ocr')).length, 0);
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  const blob = f.store.blob.bind(f.store);
  f.store.blob = async (id) =>
    id === first.rawTsv.sha256 ? Buffer.from('corrupt') : await blob(id);
  await assert.rejects(
    engine.recognize(f.blob),
    /model-bound OCR cache evidence/u
  );
  assert.equal(f.observed.length, 1);
});

test('successful native exit with a corrupt secondary language warning remains a failed observation', async (t) => {
  const f = await fixture(t, 'eng+vie');
  const execute = async (command, args, options) => {
    const result = await f.execute(command, args, options);
    return args[0] === '--version'
      ? result
      : { ...result, stderr: "Failed loading language 'vie'\n" };
  };
  await assert.rejects(
    f.makeOcr({ tessdataDir: f.models, execute }).recognize(f.blob),
    /every required trained model/u
  );
  assert.equal((await f.store.list('ocr')).length, 0);
});

test('cached model metadata cannot retain a fingerprint after changing model bytes, roles or languages', async (t) => {
  const f = await fixture(t);
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  const original = await f.store.get('ocr', first.id);
  const raw = await f.store.blob(first.rawTsv.sha256);
  for (const change of [
    { requestedLanguages: 'vie' },
    { models: [{ ...original.modelProvenance.models[0], bytes: 123 }] },
    {
      models: [{ ...original.modelProvenance.models[0], role: 'orientation' }],
    },
    {
      models: [
        { ...original.modelProvenance.models[0], sha256: '0'.repeat(64) },
      ],
    },
  ]) {
    await f.store.put('ocr', {
      ...original,
      modelProvenance: { ...original.modelProvenance, ...change },
    });
    await assert.rejects(engine.recognize(f.blob), /model-bound OCR cache/u);
    assert.deepEqual(await f.store.blob(first.rawTsv.sha256), raw);
  }
  assert.equal(f.observed.length, 1);
});

test('cached recognition fields must match their unchanged original TSV', async (t) => {
  const f = await fixture(t);
  const engine = f.makeOcr({ tessdataDir: f.models });
  const first = await engine.recognize(f.blob);
  const original = await f.store.get('ocr', first.id);
  const raw = await f.store.blob(first.rawTsv.sha256);
  for (const change of [
    { text: 'invented nutrition' },
    { confidence: 1 },
    { words: [{ ...original.words[0], text: 'invented nutrition' }] },
  ]) {
    await f.store.put('ocr', { ...original, ...change });
    await assert.rejects(engine.recognize(f.blob), /model-bound OCR cache/u);
    assert.deepEqual(await f.store.blob(first.rawTsv.sha256), raw);
  }
  assert.equal(f.observed.length, 1);
});
