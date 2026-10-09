import { createElement as h, useState } from 'react';
import { compareOffers } from '../../../src/compare.js';

export function App() {
  const [records, setRecords] = useState({ products: [], offers: [] });
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  let report;
  let displayError = error;
  try {
    report = compareOffers(records.products, records.offers, { quantity });
  } catch (failure) {
    report = { ranked: [], excluded: [] };
    displayError ||= failure.message;
  }
  const load = async (event) => {
    try {
      setRecords(JSON.parse(await event.target.files[0].text()));
      setError('');
    } catch (failure) {
      setError(failure.message);
    }
  };
  return h(
    'main',
    { className: 'app-shell' },
    h(
      'section',
      { className: 'workspace' },
      h('h1', null, 'Lazada protein comparison'),
      h(
        'p',
        null,
        'Import product and offer JSON to compare an order on web, desktop or mobile.'
      ),
      h(
        'label',
        null,
        'Product records',
        h('input', { type: 'file', accept: '.json', onChange: load })
      ),
      h(
        'label',
        null,
        'Packages',
        h('input', {
          type: 'number',
          min: 1,
          value: quantity,
          onChange: (event) => setQuantity(Number(event.target.value)),
        })
      ),
      h('p', { role: 'status' }, displayError),
      h(
        'ul',
        null,
        ...report.ranked.map(({ product, offer, metrics }) =>
          h(
            'li',
            { key: offer.id },
            `${product.title}: ${metrics.costPer25gProtein.toFixed(2)} ${metrics.currency}/25 g protein`
          )
        )
      ),
      h('h2', null, 'Offers needing information'),
      h(
        'ul',
        null,
        ...report.excluded.map(({ offer, problems }) =>
          h('li', { key: offer.id }, problems.join('; '))
        )
      )
    )
  );
}
