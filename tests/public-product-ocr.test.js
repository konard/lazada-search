import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseHTML } from 'linkedom';
import sharp from 'sharp';
import { AssociativeStore } from '../src/store.js';
import { LazadaSearch } from '../src/application.js';
import { TesseractOcr } from '../src/ocr.js';
import { extractPage } from '../src/browser.js';
import { publishAccountCaptures } from '../src/public-captures.js';
import { publishPublicProductImageOcr } from '../src/public-product-ocr.js';
import { verifyOriginalBoundOcr } from '../src/ocr-evidence.js';
import { exportRepositoryArchive, RepositoryArchive } from '../src/archive.js';
import { sha256 } from '../src/util.js';

const url = 'https://www.lazada.vn/products/pdp-i100-s11.html';
const imageUrl = 'https://img.lazcdn.com/g/nutrition-label.png';
const tsv =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t1\t1\t12\t8\t95\tProtein\n5\t1\t1\t1\t1\t2\t14\t1\t12\t8\t96\t25g\n';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-public-image-ocr-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = new AssociativeStore({ directory: join(directory, 'public') });
  const account = new AssociativeStore({
    directory: join(directory, 'account'),
    visibility: 'private',
    fallback: shared,
  });
  const app = new LazadaSearch({ store: shared, offline: true, ocr: false });
  t.after(() => app.close());
  app.collector.start = () =>
    assert.fail('No browser starts during publication');
  const original = await account.putBlob(
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#eeeeee' },
    })
      .png()
      .toBuffer()
  );
  const screenshot = await account.putBlob(
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer()
  );
  const html = `<h1>Chocolate whey protein 500g</h1><div data-product-price>250.000 ₫</div><div class="key-li"><span class="key-title">SKU</span><span class="key-value">100_VNAMZ-11</span></div><img data-product-image src="${imageUrl}"><div id="topActionHeaderWrapper">Private account customer</div>`;
  const { document } = parseHTML(html);
  const capture = await account.put('cache', {
    id: `lazada:vn:Nha Trang:${url}`,
    url,
    status: 'ok',
    snapshot: extractPage({ document, url }),
    html: await account.putBlob(html),
    screenshot,
    fetchedAt: Date.parse('2026-10-13T08:00:00.000Z'),
  });
  await account.put('cache', {
    id: `image:${imageUrl}`,
    url: imageUrl,
    status: 'captured',
    blob: original,
    contentType: 'image/png',
    fetchedAt: 1,
  });
  const models = join(directory, 'private-model-directory');
  await mkdir(models);
  await writeFile(
    join(models, 'eng.traineddata'),
    'fixture model original bytes'
  );
  const ocr = new TesseractOcr({
    store: account,
    tessdataDir: models,
    execute: async (_command, args) => ({
      stdout: args[0] === '--version' ? 'tesseract 5.5.2\n' : tsv,
    }),
  });
  const recognize = (blob = original, options = {}) =>
    ocr.recognize(blob, options);
  return {
    directory,
    shared,
    account,
    app,
    original,
    screenshot,
    capture,
    recognize,
    models,
  };
}

test('public product-image raw OCR, TSV and model hashes publish without account viewports or product-fact promotion and replay from the archive', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const privateView = await context.recognize(context.screenshot);
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 1);
  assert.equal(result.ocrPublication.reused, 0);
  assert.deepEqual(result.ocrPublication.rejected, []);
  const publicOcr = await context.shared.get('ocr', raw.id);
  assert.equal(publicOcr.imageHash, context.original.sha256);
  assert.equal(publicOcr.rawTsv.sha256, raw.rawTsv.sha256);
  assert.deepEqual(publicOcr.modelProvenance, raw.modelProvenance);
  assert.equal(publicOcr.requiresReview, true);
  assert.equal(publicOcr.visibility, undefined);
  assert.equal(await context.shared.get('ocr', privateView.id), undefined);
  assert.equal(await context.shared.blob(context.screenshot.sha256), undefined);
  assert.equal(
    await context.shared.blob(raw.modelProvenance.models[0].sha256),
    undefined
  );
  assert.doesNotMatch(
    JSON.stringify(publicOcr),
    /private-model-directory|Private account customer/u
  );
  assert.equal(
    (await verifyOriginalBoundOcr(context.shared, context.original, raw.id))
      .rawTsvSha256,
    raw.rawTsv.sha256
  );
  const product = (await context.shared.list('product'))[0];
  assert.equal(product.proteinPer100g, undefined);
  assert.equal(product.manufacturerVerification, undefined);
  const replay = await publishAccountCaptures(context.app, context.account);
  assert.equal(replay.reused, 1);
  assert.equal(replay.ocrPublication.published, 0);
  assert.equal(replay.ocrPublication.reused, 1);
  const archivePath = join(context.directory, 'archive');
  await exportRepositoryArchive({
    store: context.shared,
    directory: archivePath,
  });
  const archive = new RepositoryArchive({ directory: archivePath });
  assert.equal((await archive.verify()).valid, true);
  assert.equal(
    (await verifyOriginalBoundOcr(archive, context.original, raw.id))
      .modelFingerprint,
    raw.modelProvenance.fingerprint
  );
  assert.equal(
    (await archive.graph('ocr', raw.id)).names.has(`record:ocr:${raw.id}`),
    true
  );
});

test('valid cropped OCR preserves exact derived-image and original-TSV chains while dropping filesystem paths', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const cropped = await context.recognize(context.original, {
    psm: 7,
    sourceOcrId: raw.id,
    transform: {
      crop: { left: 0, top: 0, width: 40, height: 20 },
      resize: { width: 80, height: 40 },
      grayscale: true,
    },
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 2);
  assert.equal(result.ocrPublication.transforms, 1);
  assert.deepEqual(result.ocrPublication.rejected, []);
  const copied = await context.shared.get('ocr', cropped.id);
  assert.equal(copied.originalImageHash, context.original.sha256);
  assert.equal(copied.imageHash, cropped.imageHash);
  assert.equal(copied.rawTsv.sha256, cropped.rawTsv.sha256);
  assert.equal(
    copied.modelProvenance.fingerprint,
    cropped.modelProvenance.fingerprint
  );
  assert.equal(
    copied.sourceParametersSha256,
    sha256(JSON.stringify(cropped.parameters))
  );
  assert.equal(copied.parameters.tessdataDir, undefined);
  assert.equal(copied.imageTransform.visibility, undefined);
  assert.equal(copied.imageTransform.sourceOcr.id, raw.id);
  assert.deepEqual(
    await context.shared.blob(copied.derivedImage.sha256),
    await context.account.blob(cropped.derivedImage.sha256)
  );
  assert.equal(
    (await verifyOriginalBoundOcr(context.shared, context.original, cropped.id))
      .transformationId,
    cropped.imageTransform.id
  );
});

test('cached OCR added after an unchanged capture is published without reloading product pages', async (t) => {
  const context = await setup(t);
  const first = await publishAccountCaptures(context.app, context.account);
  assert.equal(first.ocrPublication.published, 0);
  const raw = await context.recognize();
  const second = await publishAccountCaptures(context.app, context.account);
  assert.equal(second.reused, 1);
  assert.equal(second.ocrPublication.published, 1);
  assert.equal(
    (await context.shared.get('ocr', raw.id)).imageHash,
    context.original.sha256
  );
  assert.equal(second.downloads, 0);
});

test('mismatched TSV or model fingerprint, missing original and invalidated image sources cannot publish OCR artifacts', async (t) => {
  for (const problem of ['tsv', 'model', 'original', 'invalidated']) {
    const context = await setup(t);
    const raw = await context.recognize();
    if (problem === 'tsv') {
      await context.account.put('ocr', {
        ...(await context.account.get('ocr', raw.id)),
        text: 'Unproven private text',
      });
    } else if (problem === 'model') {
      const changed = await context.account.get('ocr', raw.id);
      changed.modelProvenance.models[0].sha256 = 'f'.repeat(64);
      await context.account.put('ocr', changed);
    } else if (problem === 'original') {
      const source = await context.account.get('cache', `image:${imageUrl}`);
      await context.account.put('cache', {
        ...source,
        blob: await context.account.putBlob('mismatched public image'),
      });
    } else {
      await context.account.put('invalidation', {
        id: imageUrl,
        url: imageUrl,
        invalidatedAt: '2026-10-13T09:00:00.000Z',
      });
    }
    const result = await publishAccountCaptures(context.app, context.account);
    assert.equal(result.ocrPublication.published, 0, problem);
    assert.equal(await context.shared.get('ocr', raw.id), undefined, problem);
    assert.equal(
      await context.shared.blob(raw.rawTsv.sha256),
      undefined,
      problem
    );
  }
});

test('existing public OCR with equivalent raw provenance reuses its preserved record despite transient metadata differences', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const existing = {
    ...(await context.account.get('ocr', raw.id)),
    cacheHit: true,
  };
  delete existing.visibility;
  await context.shared.putBlob(await context.account.blob(raw.rawTsv.sha256));
  await context.shared.put('ocr', existing);
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 0);
  assert.equal(result.ocrPublication.reused, 1);
  assert.deepEqual(await context.shared.get('ocr', raw.id), existing);
  assert.equal(
    (await verifyOriginalBoundOcr(context.shared, context.original, raw.id))
      .rawTsvSha256,
    raw.rawTsv.sha256
  );
});

test('valid nested image transforms preserve each intermediate original and raw OCR dependency', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const first = await context.recognize(context.original, {
    psm: 7,
    sourceOcrId: raw.id,
    transform: {
      crop: { left: 0, top: 0, width: 40, height: 20 },
      resize: { width: 80, height: 40 },
      grayscale: true,
    },
  });
  const second = await context.recognize(first.derivedImage, {
    psm: 11,
    sourceOcrId: first.id,
    transform: {
      crop: { left: 0, top: 0, width: 20, height: 10 },
      resize: { width: 60, height: 30 },
    },
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 3);
  assert.equal(result.ocrPublication.transforms, 2);
  assert.deepEqual(result.ocrPublication.rejected, []);
  assert.equal(
    (
      await verifyOriginalBoundOcr(
        context.shared,
        first.derivedImage,
        second.id
      )
    ).transformationId,
    second.imageTransform.id
  );
});

test('a recorded public image hash that is also an account viewport is excluded even with valid native OCR', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  await context.account.put('cache', {
    ...context.capture,
    screenshot: context.original,
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 0);
  assert.match(result.ocrPublication.rejected[0].reason, /account viewport/u);
  assert.equal(await context.shared.get('ocr', raw.id), undefined);
  assert.equal(await context.shared.blob(raw.rawTsv.sha256), undefined);
});

test('a derived OCR source already published in the fallback store remains a verified dependency', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  await publishAccountCaptures(context.app, context.account);
  await rm(context.account.recordPath('ocr', raw.id));
  const cropped = await context.recognize(context.original, {
    psm: 7,
    sourceOcrId: raw.id,
    transform: {
      crop: { left: 0, top: 0, width: 40, height: 20 },
      resize: { width: 80, height: 40 },
    },
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 1);
  assert.equal(result.ocrPublication.reused, 1);
  assert.deepEqual(result.ocrPublication.rejected, []);
  assert.equal(
    (await verifyOriginalBoundOcr(context.shared, context.original, cropped.id))
      .rawTsvSha256,
    cropped.rawTsv.sha256
  );
});

test('conflicting public transcription is rejected before artifact writes and never overwrites its retained record', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const conflicting = {
    ...(await context.account.get('ocr', raw.id)),
    text: 'Corrupt public transcription',
  };
  delete conflicting.visibility;
  await context.shared.put('ocr', conflicting);
  await assert.rejects(
    publishAccountCaptures(context.app, context.account),
    /conflicts with its original/u
  );
  assert.deepEqual(await context.shared.get('ocr', raw.id), conflicting);
  assert.equal(await context.shared.blob(raw.rawTsv.sha256), undefined);
});

test('forged derived-image bytes cannot publish under a valid recipe ID or leak unrelated private images', async (t) => {
  const context = await setup(t);
  const raw = await context.recognize();
  const cropped = await context.recognize(context.original, {
    psm: 7,
    sourceOcrId: raw.id,
    transform: {
      crop: { left: 0, top: 0, width: 40, height: 20 },
      resize: { width: 80, height: 40 },
    },
  });
  const forgedImage = await context.account.putBlob(
    await sharp({
      create: { width: 80, height: 40, channels: 3, background: '#abcdef' },
    })
      .png()
      .toBuffer()
  );
  const transformed = {
    ...(await context.account.get(
      'image-transform',
      cropped.imageTransform.id
    )),
    derivedImage: forgedImage,
  };
  await context.account.put('image-transform', transformed);
  await context.account.put('ocr', {
    ...(await context.account.get('ocr', cropped.id)),
    imageHash: forgedImage.sha256,
    derivedImage: forgedImage,
    imageTransform: transformed,
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 1);
  assert.match(result.ocrPublication.rejected[0].reason, /does not reproduce/u);
  assert.equal(await context.shared.get('ocr', cropped.id), undefined);
  assert.equal(await context.shared.blob(forgedImage.sha256), undefined);
  assert.equal(
    await context.shared.get('image-transform', transformed.id),
    undefined
  );
});

test('private screenshots and their derived OCR are skipped without public product-image ancestry', async (t) => {
  const context = await setup(t);
  const cropped = await context.recognize(context.screenshot, {
    psm: 7,
    transform: {
      crop: { left: 0, top: 0, width: 40, height: 20 },
      resize: { width: 80, height: 40 },
    },
  });
  const result = await publishAccountCaptures(context.app, context.account);
  assert.equal(result.ocrPublication.published, 0);
  assert.equal(await context.shared.get('ocr', cropped.id), undefined);
  assert.equal(
    await context.shared.blob(cropped.derivedImage.sha256),
    undefined
  );
  assert.equal(await context.shared.blob(cropped.rawTsv.sha256), undefined);
  await assert.rejects(
    publishPublicProductImageOcr(context.account, context.account),
    /public output/u
  );
});
