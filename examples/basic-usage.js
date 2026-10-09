import { AssociativeStore, LazadaSearch } from '../src/index.js';
const app = new LazadaSearch({
  store: new AssociativeStore(),
  market: 'vn',
  deliveryArea: 'Nha Trang',
});
try {
  const results = await app.compare({
    category: 'whey',
    quantity: 10,
    proteinType: 'isolate',
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await app.close();
}
