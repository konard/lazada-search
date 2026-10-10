import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DomainScheduler } from '../src/cache.js';

// Public manufacturer sources only. Never requests Lazada or writes its store.
const directory = 'docs/acceptance/urgent-whey-reviews/low-price-sources';
const scheduler = new DomainScheduler({ intervalMs: 60000 });
const sources = [
  {
    name: 'nzmp-wpc-range',
    url: 'https://www.nzmp.com/global/en/ingredients/proteins/whey-protein-concentrates.html',
  },
  {
    name: 'critical-whey',
    url: 'https://appliednutrition.uk/products/critical-whey',
  },
  {
    name: 'warrior-whey',
    url: 'https://teamwarrior.com/products/warrior-whey-protein-2kg',
  },
  {
    name: 'mutant-whey',
    url: 'https://mutantnation.com/products/whey-protein-mix?currency=USD&variant=41772084854881',
  },
  {
    name: 'ostrovit-wpc80-natural-700g',
    url: 'https://ostrovit.com/en/products/ostrovit-wpc-80-700-g-26507.html',
  },
  {
    name: 'critical-whey-official-nutrition',
    url: 'https://cdn.shopify.com/s/files/1/0454/0871/4919/files/Nutritional_PanelWCP.jpg?v=1756716488',
    referringSource: 'critical-whey.html.gz',
    extension: 'jpg',
  },
  {
    name: 'critical-whey-chocolate-official-macros',
    url: 'https://appliednutrition.uk/cdn/shop/files/Critical_Whey_Protein_2kg_Chocolate_Milkshake_Macros.webp?v=1775606863&width=1946',
    referringSource: 'critical-whey.html.gz',
    extension: 'webp',
  },
  {
    name: 'warrior-double-chocolate-official-front',
    url: 'https://teamwarrior.com/cdn/shop/files/b201-dc-2-pd-1.png?v=1756713848&width=3840&quality=75',
    referringSource: 'warrior-whey.html.gz',
    extension: 'png',
  },
  {
    name: 'mutant-triple-chocolate-official-back',
    url: 'https://mutantnation.com/cdn/shop/files/31052USMUTANTWHEYTripleChocolateFlavor5LB_2.27KG_v2.00_back_NS-L3.png?v=1749755931&width=1080',
    referringSource: 'mutant-whey.html.gz',
    extension: 'png',
  },
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(directory, { recursive: true });
const results = await Promise.allSettled(
  sources.map(async (source) => {
    const receiptPath = `${directory}/${source.name}.json`;
    try {
      const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
      if (!previous.successful && !previous.filename) {
        console.log(JSON.stringify({ name: source.name, cachedFailure: true }));
        return;
      }
      const stored = await readFile(`${directory}/${previous.filename}`);
      const bytes = previous.encoding === 'gzip' ? gunzipSync(stored) : stored;
      if (digest(bytes) !== previous.sha256) {
        throw new Error(`Cached source hash mismatch: ${source.name}`);
      }
      console.log(JSON.stringify({ name: source.name, cacheHit: true }));
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (process.argv.includes('--offline')) {
      throw new Error(`Offline source cache miss: ${source.name}`);
    }
    let response;
    try {
      response = await scheduler.run(source.url, () =>
        fetch(source.url, {
          headers: { 'User-Agent': 'lazada-search manufacturer evidence/0.1' },
          signal: AbortSignal.timeout(45000),
        })
      );
    } catch (error) {
      const failure = {
        ...source,
        observedAt: new Date().toISOString(),
        successful: false,
        transportError: error.cause?.code || error.message,
        method:
          'Transport failure for the retained attempt; no original source bytes were available. Cache this failure and do not repeat automatically.',
      };
      await writeFile(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
      console.log(JSON.stringify(failure));
      return;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const compressed = !source.extension;
    const filename = `${source.name}.${source.extension || 'html.gz'}`;
    await writeFile(
      `${directory}/${filename}`,
      compressed ? gzipSync(bytes) : bytes
    );
    const receipt = {
      ...source,
      finalUrl: response.url,
      observedAt: new Date().toISOString(),
      status: response.status,
      successful: response.ok,
      contentType: response.headers.get('content-type'),
      filename,
      encoding: compressed ? 'gzip' : 'original',
      sha256: digest(bytes),
      bytes: bytes.length,
      method:
        'Public HTTP GET response whose original bytes are retained. Cached receipts prevent automatic repeat requests, including unsuccessful responses.',
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt));
  })
);
const failures = results.filter((result) => result.status === 'rejected');
if (failures.length) {
  throw new AggregateError(
    failures.map((failure) => failure.reason),
    'Manufacturer source cache validation failed'
  );
}
