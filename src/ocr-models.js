import { createHash } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './util.js';

export const OCR_MODEL_LIMITS = Object.freeze({
  perModelBytes: 64 * 1024 ** 2,
  totalBytes: 128 * 1024 ** 2,
  models: 16,
});

export function nativeTessdataDirectory(output) {
  const match = output.match(
    /^List of available languages in "([^\r\n]+)" \(\d+\):\r?$/mu
  );
  if (!match) {
    throw new Error('Cannot determine the native Tesseract model directory');
  }
  return match[1];
}

function selectedModels(languages, psm) {
  if (!/^[a-z_]+(?:\+[a-z_]+)*$/u.test(languages)) {
    throw new Error('Invalid OCR model languages');
  }
  const selected = [...new Set(languages.split('+'))].map((language) => ({
    language,
    role: 'language',
  }));
  if (psm === 12 && !selected.some((item) => item.language === 'osd')) {
    selected.push({ language: 'osd', role: 'orientation' });
  }
  if (selected.length > OCR_MODEL_LIMITS.models) {
    throw new Error('Too many selected OCR models');
  }
  return selected;
}

async function writeChunk(file, bytes) {
  let position = 0;
  while (position < bytes.length) {
    const written = await file.write(bytes, position, bytes.length - position);
    if (!written.bytesWritten) {
      throw new Error('Cannot write the OCR model snapshot');
    }
    position += written.bytesWritten;
  }
}

// Every lookup hashes the bytes. File timestamps cannot attest a replacement.
async function inspectModel(path, maximum, destination) {
  const input = await open(path, 'r');
  let output;
  try {
    const details = await input.stat();
    if (!details.isFile() || !details.size || details.size > maximum) {
      throw new Error('OCR model must be a nonempty bounded regular file');
    }
    if (destination) {
      output = await open(destination, 'wx', 0o600);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer);
      if (!bytesRead) {
        break;
      }
      bytes += bytesRead;
      if (bytes > maximum) {
        throw new Error('OCR model exceeds its byte limit');
      }
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (output) {
        await writeChunk(output, chunk);
      }
    }
    if (bytes !== details.size) {
      throw new Error('OCR model changed during its source read');
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    try {
      await output?.close();
    } finally {
      await input.close();
    }
  }
}

export async function resolveOcrModels({
  command,
  execute,
  languages,
  psm,
  tessdataDir,
}) {
  const selected = selectedModels(languages, psm);
  let directory = tessdataDir;
  if (
    directory !== undefined &&
    (typeof directory !== 'string' || !directory)
  ) {
    throw new Error('OCR model directory must be a nonempty path');
  }
  if (directory === undefined) {
    const result = await execute(command, ['--list-langs'], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    directory = nativeTessdataDirectory(
      `${result.stdout || ''}\n${result.stderr || ''}`
    );
  }
  directory = await realpath(directory);
  const models = [];
  let total = 0;
  for (const model of selected) {
    const sourcePath = join(directory, `${model.language}.traineddata`);
    const physical = await inspectModel(
      sourcePath,
      Math.min(
        OCR_MODEL_LIMITS.perModelBytes,
        OCR_MODEL_LIMITS.totalBytes - total
      )
    );
    total += physical.bytes;
    models.push({ ...model, ...physical, sourcePath });
  }
  const provenance = {
    version: 'tesseract-traineddata-v1',
    requestedLanguages: languages,
    directorySelection: tessdataDir === undefined ? 'native' : 'explicit',
    models: models.map(({ language, role, sha256: digest, bytes }) => ({
      language,
      role,
      sha256: digest,
      bytes,
    })),
  };
  provenance.fingerprint = sha256(JSON.stringify(provenance));
  return { directory, models, provenance };
}

export async function snapshotOcrModels(plan, directory) {
  await mkdir(directory, { mode: 0o700 });
  let total = 0;
  for (const model of plan.models) {
    if (!/^[a-z_]+$/u.test(model.language)) {
      throw new Error('Invalid snapshot model language');
    }
    const physical = await inspectModel(
      model.sourcePath,
      Math.min(
        OCR_MODEL_LIMITS.perModelBytes,
        OCR_MODEL_LIMITS.totalBytes - total
      ),
      join(directory, `${model.language}.traineddata`)
    );
    total += physical.bytes;
    if (physical.sha256 !== model.sha256 || physical.bytes !== model.bytes) {
      throw new Error('OCR model changed before its execution snapshot');
    }
  }
  return directory;
}

export function assertTesseractModelsLoaded(stderr = '') {
  // Combined-language native OCR can exit successfully after dropping a corrupt
  // model. Such output does not attest the requested language manifest.
  if (
    /Error opening data file|Failed loading language|Could not initialize tesseract|Tesseract couldn't load any languages/iu.test(
      stderr
    )
  ) {
    throw new Error('Tesseract did not load every required trained model');
  }
}
