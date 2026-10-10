import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { DomainScheduler } from '../src/cache.js';

// Public manufacturer sources only. This script does not read or write accounts.
const directory = 'docs/acceptance/urgent-whey-reviews/factory-lead-sources';
const sources = [
  {
    name: 'nutrabolics-public-products',
    url: 'https://nutrabolics.com/products.json?limit=250',
    extension: 'json.gz',
  },
  {
    name: 'nutrabolics-hydropure-current-product',
    url: 'https://nutrabolics.com/products/hydropure-ultra-pure-hydrolyzed-whey-protein',
    referringSource: 'nutrabolics-public-products.json.gz',
    extension: 'html.gz',
  },
  {
    name: 'warrior-500g-original-formula',
    url: 'https://teamwarrior.com/products/warrior-whey-protein-500g?variant=54832659235193',
    extension: 'html.gz',
  },
  {
    name: 'mutant-triple-chocolate-legacy-back',
    url: 'https://mutantnation.com/cdn/shop/files/Whey_5lb_TripleChoc_back.png?v=1722544028&width=2550',
    referringSource: '../low-price-sources/mutant-whey.html.gz',
    extension: 'png',
  },
  {
    name: 'nutrabolics-extreme-chocolate-4-5lb-nutrition',
    url: 'https://nutrabolics.com/cdn/shop/files/Hydropure_4.5lb_Chocolate_Extreme_Nutritional_inf-1.png?v=1790277591&width=1200',
    referringSource: 'nutrabolics-hydropure-current-product.html.gz',
    extension: 'png',
  },
  {
    name: 'nutrabolics-current-three-sizes-front',
    url: 'https://nutrabolics.com/cdn/shop/files/HYDROPURE_3_x_SIZES_2.0.png?v=1790159568&width=1200',
    referringSource: 'nutrabolics-hydropure-current-product.html.gz',
    extension: 'png',
  },
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scheduler = new DomainScheduler({ intervalMs: 60000 });
const run = promisify(execFile);
await mkdir(directory, { recursive: true });
// Preserve manufacturer cadence across process restarts, including failed HTTP.
const lastObservedByHost = new Map();
for (const filename of (await readdir(directory)).filter((name) =>
  name.endsWith('.json')
)) {
  const receipt = JSON.parse(
    await readFile(`${directory}/${filename}`, 'utf8')
  );
  const recordedAt = receipt.observedAt || receipt.attemptCompletedAt;
  if (!receipt.url || !recordedAt) {
    continue;
  }
  const host = new URL(receipt.url).hostname;
  const observedAt = Date.parse(recordedAt);
  lastObservedByHost.set(
    host,
    Math.max(lastObservedByHost.get(host) || 0, observedAt)
  );
}
const results = await Promise.allSettled(
  sources.map(async (source) => {
    const receiptPath = `${directory}/${source.name}.json`;
    try {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      if (!receipt.filename) {
        console.log(JSON.stringify({ name: source.name, cachedFailure: true }));
        return;
      }
      const stored = await readFile(`${directory}/${receipt.filename}`);
      const bytes = receipt.encoding === 'gzip' ? gunzipSync(stored) : stored;
      if (hash(bytes) !== receipt.sha256) {
        throw new Error(`Cached source digest mismatch: ${source.name}`);
      }
      console.log(
        JSON.stringify({
          name: source.name,
          cacheHit: true,
          status: receipt.status,
        })
      );
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (process.argv.includes('--offline')) {
      throw new Error(`Offline source cache miss: ${source.name}`);
    }
    const temporary = `${directory}/.${source.name}.response`;
    let metadata;
    try {
      const { stdout } = await scheduler.run(source.url, async () => {
        const host = new URL(source.url).hostname;
        const remaining = Math.max(
          0,
          (lastObservedByHost.get(host) || 0) + 60000 - Date.now()
        );
        if (remaining > 0) {
          await delay(remaining);
        }
        const response = await run('curl', [
          '--location',
          '--connect-timeout',
          '15',
          '--max-time',
          '45',
          '--silent',
          '--show-error',
          source.url,
          '--output',
          temporary,
          '--write-out',
          '%{json}',
        ]);
        lastObservedByHost.set(host, Date.now());
        return response;
      });
      metadata = JSON.parse(stdout);
    } catch (error) {
      lastObservedByHost.set(new URL(source.url).hostname, Date.now());
      const failure = {
        ...source,
        attemptCompletedAt: new Date().toISOString(),
        successful: false,
        transportError: error.message,
        method:
          'Public manufacturer request failed. No complete source response is claimed; cached failure prevents automatic retries.',
      };
      await rm(temporary, { force: true });
      await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
      console.log(JSON.stringify({ name: source.name, successful: false }));
      return;
    }
    const bytes = await readFile(temporary);
    const compressed = source.extension.endsWith('.gz');
    const filename = `${source.name}.${source.extension}`;
    await writeFile(
      `${directory}/${filename}`,
      compressed ? gzipSync(bytes) : bytes
    );
    const receipt = {
      ...source,
      finalUrl: metadata.url_effective,
      status: metadata.http_code,
      successful: metadata.http_code >= 200 && metadata.http_code < 300,
      observedAt: new Date().toISOString(),
      contentType: metadata.content_type,
      filename,
      encoding: compressed ? 'gzip' : 'original',
      sha256: hash(bytes),
      bytes: bytes.length,
      method:
        'Original public manufacturer response bytes retained; existing receipts prevent repeat requests including HTTP failures. No Lazada request or associative-store mutation.',
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await rm(temporary, { force: true });
    console.log(
      JSON.stringify({
        name: source.name,
        status: receipt.status,
        bytes: bytes.length,
      })
    );
  })
);
const failures = results.filter((result) => result.status === 'rejected');
if (failures.length) {
  throw new AggregateError(
    failures.map((failure) => failure.reason),
    'Factory lead source cache validation failed'
  );
}
