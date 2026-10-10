import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';

const directory = 'docs/acceptance/urgent-icecream';
const archive = 'data/cases/vietnam-nha-trang';
const targets = [
  'https://ngoinhadinhduong.com/pages/chinh-sach-giao-hang',
  'https://aicevietnam.vn/danh-muc-san-pham/kem-que-stick/kem-so-co-la/',
  'https://happygelato.vn/',
  'https://aicevietnam.vn/san-pham/kem-que-socola-gion/',
  'https://aicevietnam.vn/san-pham/kem-que-ca-phe-gion/',
  'https://aicevietnam.vn/san-pham/kem-que-khoai-mon-gion/',
  'https://aicevietnam.vn/san-pham/kem-que-miki-miki/',
];
await mkdir(`${directory}/sources`, { recursive: true });
const records = [];
for (const name of (await readdir(`${archive}/records`)).filter((name) =>
  name.startsWith('evidence.')
)) {
  records.push(
    ...JSON.parse(gunzipSync(await readFile(`${archive}/records/${name}`)))
  );
}
let existing = [];
try {
  existing = JSON.parse(
    await readFile(`${directory}/source-cache.json`, 'utf8')
  );
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
const output = [];
for (const url of targets) {
  const saved = existing.find((source) => source.url === url);
  if (saved) {
    output.push({ ...saved, reused: true });
    continue;
  }
  const archived = records.find((record) => record.url === url && record.html);
  if (archived) {
    output.push({
      url,
      reused: true,
      archiveEvidenceId: archived.id,
      archiveBlob: archived.html,
    });
    continue;
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      redirect: 'follow',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `${directory}/sources/${sha256}.html.gz`;
    await writeFile(path, gzipSync(bytes));
    output.push({
      url,
      finalUrl: response.url,
      observedAt: new Date().toISOString(),
      status: response.status,
      sha256,
      bytes: bytes.length,
      path,
      reused: false,
    });
  } catch (error) {
    output.push({
      url,
      observedAt: new Date().toISOString(),
      error: error.message,
      causeCode: error.cause?.code,
      reused: false,
    });
  }
  await writeFile(
    `${directory}/source-cache.json`,
    `${JSON.stringify(output, null, 2)}\n`
  );
  if (url !== targets.at(-1)) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
await writeFile(
  `${directory}/source-cache.json`,
  `${JSON.stringify(output, null, 2)}\n`
);
console.log(JSON.stringify(output));
