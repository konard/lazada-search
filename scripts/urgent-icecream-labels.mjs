import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = 'docs/acceptance/urgent-icecream';
const targets = [
  'https://aicevietnam.vn/wp-content/uploads/2025/12/10.-SOCOLA-GION.png',
  'https://aicevietnam.vn/wp-content/uploads/2025/12/19.-MIKI-MIKI-1.png',
  'https://aicevietnam.vn/wp-content/uploads/2025/12/MIki-Miki.png',
];
await mkdir(`${directory}/labels`, { recursive: true });
let previous = [];
try {
  previous = JSON.parse(
    await readFile(`${directory}/label-cache.json`, 'utf8')
  );
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
const report = [];
for (const url of targets) {
  const saved = previous.find((source) => source.url === url);
  if (saved) {
    report.push({ ...saved, reused: true });
    continue;
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `${directory}/labels/${sha256}.png`;
    await writeFile(path, bytes);
    const text = execFileSync(
      'tesseract',
      [path, 'stdout', '-l', 'eng+vie', '--psm', '11'],
      {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    report.push({
      url,
      observedAt: new Date().toISOString(),
      status: response.status,
      sha256,
      bytes: bytes.length,
      path,
      ocrText: text,
      reused: false,
    });
  } catch (error) {
    report.push({
      url,
      observedAt: new Date().toISOString(),
      error: error.message,
      reused: false,
    });
  }
  await writeFile(
    `${directory}/label-cache.json`,
    `${JSON.stringify(report, null, 2)}\n`
  );
  if (url !== targets.at(-1)) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
await writeFile(
  `${directory}/label-cache.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report));
