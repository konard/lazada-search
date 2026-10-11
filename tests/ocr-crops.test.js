import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { TesseractOcr, parseTsv } from '../src/ocr.js';
import { AssociativeStore } from '../src/store.js';
import { sha256 } from '../src/util.js';

const run = promisify(execFile);
const label = await readFile(
  new URL(
    '../docs/acceptance/ice-dual-units/expanded-hd-sg-belgian-label.png',
    import.meta.url
  )
);
const baseline = JSON.parse(
  await readFile(
    new URL(
      '../docs/acceptance/manufacturer-research/second-ocr-pass.json',
      import.meta.url
    )
  )
)[0];
const originalTsv = await readFile(
  new URL('../docs/acceptance/decimal-ocr/original-psm11.tsv', import.meta.url)
);
const croppedTsv = await readFile(
  new URL(
    '../docs/acceptance/decimal-ocr/protein-per100g-crop.tsv',
    import.meta.url
  ),
  'utf8'
);
const transform = (changes = {}) => ({
  crop: { left: 801, top: 517, width: 82, height: 68 },
  resize: { width: 164, height: 136, kernel: 'lanczos3' },
  grayscale: true,
  ...changes,
});

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-ocr-crops-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AssociativeStore({ directory });
  const modelDirectory = join(directory, 'models');
  await mkdir(modelDirectory);
  await writeFile(
    join(modelDirectory, 'eng.traineddata'),
    'fixture model bytes'
  );
  const fixtureOcr = (calls = []) =>
    new TesseractOcr({
      store,
      execute: cachedExecutor(calls),
      tessdataDir: modelDirectory,
    });
  const blob = await store.putBlob(label);
  await store.putBlob(originalTsv);
  await store.put('ocr', baseline);
  return { store, blob, fixtureOcr };
}

function cachedExecutor(calls) {
  return async (_command, args) => {
    calls.push(args);
    return {
      stdout: args[0] === '--version' ? 'fixture-tesseract\n' : croppedTsv,
    };
  };
}

test('real committed manufacturer label and raw TSV reproduce missing decimal marks', () => {
  assert.equal(
    sha256(label),
    '67907ce23aa9ff33a8431ad6ebe68289d842ab83f14586abf9d5ac7a5ab3c9e8'
  );
  assert.equal(sha256(originalTsv), baseline.rawTsv.sha256);
  assert.equal(baseline.imageHash, sha256(label));
  const parsed = parseTsv(originalTsv.toString());
  assert.match(parsed.text, /Protein\n45g\n40g/u);
  assert.match(parseTsv(croppedTsv).text, /^4\.5$/u);
});

test('bounded transforms cache lossless derived bytes and preserve original OCR provenance', async (t) => {
  const { store, blob, fixtureOcr } = await setup(t);
  const calls = [];
  const ocr = fixtureOcr(calls);
  const options = { psm: 7, transform: transform(), sourceOcrId: baseline.id };
  const result = await ocr.recognize(blob, options);
  assert.equal(result.cacheHit, false);
  assert.equal(result.transformCacheHit, false);
  assert.notEqual(result.imageHash, blob.sha256);
  assert.equal(result.originalImageHash, blob.sha256);
  assert.equal(result.imageTransform.originalImage.sha256, blob.sha256);
  assert.equal(result.imageTransform.sourceOcr.id, baseline.id);
  assert.equal(
    result.imageTransform.sourceOcr.rawTsv.sha256,
    baseline.rawTsv.sha256
  );
  assert.deepEqual(
    result.imageTransform.transform.crop,
    options.transform.crop
  );
  assert.equal(result.imageTransform.renderer.sharp, sharp.versions.sharp);
  assert.equal(result.imageTransform.renderer.vips, sharp.versions.vips);
  assert.equal(sha256(await store.blob(result.imageHash)), result.imageHash);
  assert.equal(
    sha256(await store.blob(result.rawTsv.sha256)),
    result.rawTsv.sha256
  );
  assert.equal(result.requiresReview, true);
  assert.equal(result.manufacturerVerification, undefined);
  assert.equal(result.proteinPer100g, undefined);
  const pixels = await sharp(await store.blob(result.imageHash)).metadata();
  assert.equal(pixels.format, 'png');
  assert.equal(pixels.width, 164);
  assert.equal(pixels.height, 136);
  const replay = await ocr.recognize(blob, options);
  assert.equal(replay.cacheHit, true);
  assert.equal(replay.transformCacheHit, true);
  assert.equal(replay.id, result.id);
  assert.equal(calls.length, 2);
  assert.deepEqual(await store.blob(blob.sha256), label);
  assert.deepEqual(await store.blob(baseline.rawTsv.sha256), originalTsv);
});

test('normalized option ordering replays one crop while changed crop and output create distinct evidence', async (t) => {
  const { blob, fixtureOcr } = await setup(t);
  const calls = [];
  const ocr = fixtureOcr(calls);
  const first = await ocr.recognize(blob, { psm: 7, transform: transform() });
  const reordered = await ocr.recognize(blob, {
    psm: 7,
    transform: {
      grayscale: true,
      resize: { height: 136, width: 164 },
      crop: { width: 82, height: 68, top: 517, left: 801 },
    },
  });
  assert.equal(reordered.id, first.id);
  assert.equal(reordered.cacheHit, true);
  const moved = await ocr.recognize(blob, {
    psm: 7,
    transform: transform({
      crop: { left: 802, top: 517, width: 82, height: 68 },
    }),
  });
  const resized = await ocr.recognize(blob, {
    psm: 7,
    transform: transform({ resize: { width: 246, height: 204 } }),
  });
  assert.notEqual(moved.imageTransform.id, first.imageTransform.id);
  assert.notEqual(resized.imageTransform.id, first.imageTransform.id);
  assert.notEqual(moved.id, first.id);
  assert.notEqual(resized.id, first.id);
  assert.equal(calls.length, 4);
});

test('a missing cached derived image cannot reuse its OCR as an intact crop', async (t) => {
  const { store, blob, fixtureOcr } = await setup(t);
  const calls = [];
  const ocr = fixtureOcr(calls);
  const options = { psm: 7, transform: transform() };
  const result = await ocr.recognize(blob, options);
  const readBlob = store.blob.bind(store);
  store.blob = async (id) =>
    id === result.imageHash ? undefined : await readBlob(id);
  await assert.rejects(
    ocr.recognize(blob, options),
    /cached OCR transform image/u
  );
  assert.equal(calls.length, 2);
});

test('invalid transform dimensions and unknown options fail before invoking OCR', async (t) => {
  const { blob, fixtureOcr } = await setup(t);
  const calls = [];
  const ocr = fixtureOcr(calls);
  for (const invalid of [
    null,
    false,
    [],
    { unknown: true },
    transform({ crop: null }),
    transform({ resize: null }),
    transform({ grayscale: 'true' }),
    transform({ crop: { left: -1, top: 0, width: 1, height: 1 } }),
    transform({ crop: { left: 0.5, top: 0, width: 1, height: 1 } }),
    transform({ crop: { left: 0, top: 0, width: 0, height: 1 } }),
    transform({ crop: { left: 1499, top: 0, width: 2, height: 1 } }),
    transform({ crop: { left: 0, top: NaN, width: 1, height: 1 } }),
    transform({ resize: { width: 8193, height: 1 } }),
    transform({ resize: { width: 4096, height: 4096 } }),
    transform({ resize: { width: 164, height: 136, kernel: 'invented' } }),
    transform({ resize: { width: 164, height: 136, kernel: null } }),
  ]) {
    await assert.rejects(ocr.recognize(blob, { psm: 7, transform: invalid }));
  }
  assert.equal(calls.length, 0);
});

test('original input byte and pixel limits apply even to a tiny requested crop', async (t) => {
  const { store, fixtureOcr } = await setup(t);
  const calls = [];
  const ocr = fixtureOcr(calls);
  const oversizedBytes = await store.putBlob(
    Buffer.concat([label, Buffer.alloc(25 * 1024 ** 2)])
  );
  await assert.rejects(
    ocr.recognize(oversizedBytes, { psm: 7, transform: transform() }),
    /byte limit/u
  );
  const oversizedPixels = await store.putBlob(
    await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer()
  );
  await assert.rejects(
    ocr.recognize(oversizedPixels, {
      psm: 7,
      transform: { crop: { left: 0, top: 0, width: 1, height: 1 } },
    }),
    /pixel limit/u
  );
  assert.equal(calls.length, 0);
});

test('crop source binds the original OCR image and validates its actual raw TSV bytes', async (t) => {
  const { store, blob, fixtureOcr } = await setup(t);
  const ocr = fixtureOcr();
  await assert.rejects(
    ocr.recognize(blob, {
      psm: 7,
      transform: transform(),
      sourceOcrId: 'missing',
    }),
    /original image/u
  );
  await store.put('ocr', {
    ...baseline,
    id: 'other-image',
    imageHash: '0'.repeat(64),
  });
  await assert.rejects(
    ocr.recognize(blob, {
      psm: 7,
      transform: transform(),
      sourceOcrId: 'other-image',
    }),
    /original image/u
  );
  await store.put('ocr', {
    ...baseline,
    id: 'missing-tsv',
    rawTsv: { sha256: '0'.repeat(64) },
  });
  await assert.rejects(
    ocr.recognize(blob, {
      psm: 7,
      transform: transform(),
      sourceOcrId: 'missing-tsv',
    }),
    /original OCR TSV/u
  );
  await assert.rejects(
    ocr.recognize(blob, { sourceOcrId: baseline.id }),
    /requires an image transform/u
  );
});

test('historical unbound OCR remains available but does not attest current trained models', async (t) => {
  const { store, blob, fixtureOcr } = await setup(t);
  const engine = 'fixture-tesseract';
  const id = sha256(
    JSON.stringify(['tsv-v2', blob.sha256, engine, 'eng', 6, 'system'])
  );
  await store.put('ocr', {
    id,
    imageHash: blob.sha256,
    text: 'cached original',
    engine,
  });
  const calls = [];
  const ocr = fixtureOcr(calls);
  const result = await ocr.recognize(blob);
  assert.notEqual(result.id, id);
  assert.equal(result.cacheHit, false);
  assert.equal((await store.get('ocr', id)).text, 'cached original');
  assert.equal(result.modelProvenance.models[0].language, 'eng');
  assert.equal(result.imageTransform, undefined);
  assert.equal(calls.length, 2);
});

test('unsafe animated image declarations and mismatched original digest are rejected', async (t) => {
  const { store, blob, fixtureOcr } = await setup(t);
  const ocr = fixtureOcr();
  // acTL declares PNG animation. No frame selection may happen implicitly.
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write('acTL', 4);
  chunk.writeUInt32BE(2, 8);
  const animated = await store.putBlob(
    Buffer.concat([label.subarray(0, 33), chunk, label.subarray(33)])
  );
  await assert.rejects(
    ocr.recognize(animated, { psm: 7, transform: transform() }),
    /animated PNG/u
  );
  await assert.rejects(
    ocr.recognize(
      { ...blob, sha256: '0'.repeat(64) },
      { psm: 7, transform: transform() }
    ),
    /original image/u
  );
});

test('actual local line OCR recovers source-image protein decimals without numeric inference', async (t) => {
  try {
    await run('tesseract', ['--version']);
  } catch (error) {
    if (error.code === 'ENOENT') {
      t.skip(
        'Tesseract is unavailable; cached actual-image provenance tests remain active'
      );
      return;
    }
    throw error;
  }
  const { store, blob } = await setup(t);
  let recognitionCalls = 0;
  const execute = (command, args, options) => {
    if (!args[0].startsWith('--')) {
      recognitionCalls += 1;
    }
    return run(command, args, options);
  };
  const ocr = new TesseractOcr({ store, execute });
  const gramOptions = {
    psm: 7,
    transform: transform({
      resize: { width: 164, height: 136, kernel: 'nearest' },
    }),
    sourceOcrId: baseline.id,
  };
  const volumeOptions = {
    psm: 7,
    sourceOcrId: baseline.id,
    transform: transform({
      crop: { left: 1074, top: 512, width: 83, height: 73 },
      resize: { width: 166, height: 146, kernel: 'nearest' },
    }),
  };
  const per100g = await ocr.recognize(blob, gramOptions);
  const per100ml = await ocr.recognize(blob, volumeOptions);
  assert.equal(per100g.text.trim(), '4.5');
  assert.equal(per100ml.text.trim(), '4.0');
  assert.equal(per100g.requiresReview, true);
  assert.equal(per100ml.requiresReview, true);
  assert.equal(per100g.proteinPer100g, undefined);
  assert.equal(per100ml.proteinPer100ml, undefined);
  assert.equal(per100g.manufacturerVerification, undefined);
  assert.equal(per100ml.manufacturerVerification, undefined);
  assert.equal(recognitionCalls, 2);
  const restarted = new TesseractOcr({
    store: new AssociativeStore({ directory: store.directory }),
    execute,
  });
  for (const [original, options] of [
    [per100g, gramOptions],
    [per100ml, volumeOptions],
  ]) {
    const replay = await restarted.recognize(blob, options);
    assert.equal(replay.cacheHit, true);
    assert.equal(replay.transformCacheHit, true);
    assert.equal(replay.id, original.id);
    assert.equal(replay.text, original.text);
    assert.deepEqual(replay.modelProvenance, original.modelProvenance);
    assert.deepEqual(replay.rawTsv, original.rawTsv);
    assert.equal(replay.requiresReview, true);
    assert.equal(replay.manufacturerVerification, undefined);
  }
  assert.equal(recognitionCalls, 2, 'native OCR must not run again on restart');
});
