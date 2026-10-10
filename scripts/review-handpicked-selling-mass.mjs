import assert from 'node:assert/strict';
import { LazadaSearch } from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { sha256 } from '../src/util.js';

const options = parseArguments(process.argv.slice(2));
assert.ok(
  options.offline && !options.account,
  'Use offline public product evidence'
);
const app = new LazadaSearch({
  store: configuredStore(options),
  offline: true,
  ocr: false,
});
try {
  const row = (await app.compare({ allowStale: true })).comparisons.find(
    (r) => r.offer.sku === '3265021607_VNAMZ-15762183506'
  );
  assert.ok(row);
  const source = await app.store.get('evidence', row.offer.evidenceId);
  const html = await app.store.blob(source.html.sha256);
  assert.equal(
    sha256(html),
    '7020b63493f5878b2509f19fde2ca420521434f77776fd8bfeff0f6b17bb8ea3'
  );
  assert.match(html.toString(), /900\s*gam/iu);
  if (row.product.netMassG !== 900) {
    await app.review(row.product.id, 'netMassG', 900, source.id);
  }
  if (row.product.packCount !== 1) {
    await app.review(row.product.id, 'packCount', 1, source.id);
  }
  console.log(
    JSON.stringify({
      sku: row.offer.sku,
      massG: 900,
      packages: 1,
      price: row.offer.price,
      beforePerGram: row.offer.price / 900,
      authority: 'seller selected900g repack, not sealed factory2lb package',
      downloads: 0,
    })
  );
  const levels = (await app.compare({ allowStale: true })).comparisons.find(
    (r) => r.offer.sku === '13451810835_VNAMZ-117268785502'
  );
  assert.ok(levels);
  const image = await app.store.blob(
    'f3b45798247995109d7f4279e7cd4b3c184f51a7adc589cfd8f3df737c28dc2d'
  );
  assert.ok(image);
  assert.equal(
    sha256(image),
    'f3b45798247995109d7f4279e7cd4b3c184f51a7adc589cfd8f3df737c28dc2d'
  );
  if (levels.product.netMassG !== 2560) {
    await app.review(
      levels.product.id,
      'netMassG',
      2560,
      levels.offer.evidenceId
    );
  }
  console.log(
    JSON.stringify({
      sku: levels.offer.sku,
      massG: 2560,
      price: levels.offer.price,
      beforePerGram: levels.offer.price / 2560,
      available: levels.offer.available,
      authority:
        'selectedVanillaBean seller label, not manufacturer-hosted verification',
      downloads: 0,
    })
  );
} finally {
  await app.close();
}
