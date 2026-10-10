import { readFile } from 'node:fs/promises';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
if (options.account) {
  throw new Error('Use redacted public resolution receipts');
}
const store = configuredStore(options);
const bytes = await readFile(
  'docs/acceptance/top10-check/handpicked-links.json'
);
const resolution = JSON.parse(bytes.toString());
await store.put('handpicked-list', {
  id: 'vietnam-nha-trang:user-picked-case',
  observedAt: resolution.checkedAt,
  sourceReceipt: await store.putBlob(bytes),
  receiptSha256: sha256(bytes),
  entries: resolution.entries,
  purpose:
    'Retain exact user-selected listings and selling SKUs, resolution source evidence, duplicate identity and top-ten membership inputs without recollecting known offers',
});
console.log(
  JSON.stringify({ submitted: resolution.entries.length, downloads: 0 })
);
