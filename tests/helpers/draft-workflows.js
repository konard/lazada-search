import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssociativeStore, LazadaSearch } from '../../src/index.js';

/** Synthetic financial fixtures; no manufacturer acceptance is implied. */
export async function draftWorkflowFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-draft-workflows-'));
  const store = new AssociativeStore({ directory });
  const app = new LazadaSearch({ store, offline: true, ocr: false });
  const data = JSON.parse(
    await readFile(
      new URL('../fixtures/draft-workflows/products.json', import.meta.url),
      'utf8'
    )
  );
  const observedAt = new Date().toISOString();
  data.offers = data.offers.map((offer) => ({
    ...offer,
    observedAt,
    quoteObservedAt: observedAt,
  }));
  await app.importRecords(data);
  app.collector.start = () => {
    throw new Error('Offline draft acceptance must not start a browser');
  };
  app.cache.get = () => {
    throw new Error('Offline draft acceptance must not request a website');
  };
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { app, store, directory, data };
}
