import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { sha256 } from '../src/util.js';

const directory = 'docs/acceptance/ice-dual-units';
const receiptPath = `${directory}/expanded-root-sources.json`;
const targets = [
  'https://aicevietnam.vn/san-pham/kem-oc-que-socola/',
  'https://moonmilk.vn/collections/kem-ice-cream/products.json?limit=250',
  'https://www.bachhoaxanh.com/kem/kem-ly-chocolate-walls-46g/',
  'https://aicevietnam.vn/san-pham/mooochii-socola/',
  'https://moonmilk.vn/pages/chinh-sach-gia',
  'https://aicevietnam.vn/wp-content/uploads/2025/12/Image_20220318121826.png',
  'https://aicevietnam.vn/wp-content/uploads/2025/12/Chocolate.png',
  'https://img.lazcdn.com/g/p/3f4bcde8e33c279472c765ce656e5ec0.jpg_720x720q80.jpg_.webp',
];
await mkdir(directory, { recursive: true });
let captures = [];
try {
  captures = JSON.parse(await readFile(receiptPath, 'utf8')).captures;
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
const lastByDomain = new Map();
for (const url of targets) {
  if (captures.some((capture) => capture.url === url)) {
    console.log(JSON.stringify({ url, reused: true }));
    continue;
  }
  const domain = new URL(url).hostname;
  const delay = Math.max(
    0,
    (lastByDomain.get(domain) || 0) + 60000 - Date.now()
  );
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastByDomain.set(domain, Date.now());
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 25 * 1024 ** 2) {
      throw new Error('Public source exceeds25MiB');
    }
    const digest = sha256(bytes);
    const artifactPath = `${directory}/expanded-root-${digest}.source.gz`;
    await writeFile(artifactPath, gzipSync(bytes));
    const capture = {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get('content-type'),
      observedAt: new Date().toISOString(),
      artifactPath,
      artifactSha256: digest,
      byteLength: bytes.length,
    };
    captures.push(capture);
    console.log(JSON.stringify(capture));
  } catch (error) {
    captures.push({
      url,
      observedAt: new Date().toISOString(),
      error: error.message,
    });
    console.log(JSON.stringify({ url, error: error.message }));
  }
  await writeFile(receiptPath, `${JSON.stringify({ captures }, null, 2)}\n`);
}
