const document = globalThis.document;
const form = document.querySelector('#calculator');
const status = document.querySelector('#status');
const number = (value) =>
  !Number.isFinite(value)
    ? 'Unknown'
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value
      );
const element = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

function productDetails(product) {
  const details = document.createElement('details');
  details.append(element('summary', 'View label & sources'));
  details.append(
    element(
      'p',
      `Mass: ${number(product.netMassG ?? null)} g; volume: ${number(product.netVolumeMl ?? null)} ml; protein: ${number(product.proteinPer100g ?? null)} g/100 g; sugar: ${number(product.sugarPer100g ?? null)} g/100 g; saturated fat: ${number(product.saturatedFatPer100g ?? null)} g/100 g`
    )
  );
  details.append(
    element('p', product.ingredients?.join(', ') || 'Ingredients unknown')
  );
  for (const warning of product.warnings || []) {
    details.append(element('p', warning));
  }
  for (const [index, id] of (product.evidenceIds || []).entries()) {
    const link = element('a', `Source evidence ${index + 1}`);
    link.href = `/api/evidence?id=${encodeURIComponent(id)}`;
    details.append(link, document.createElement('br'));
  }
  return details;
}

function listingLink(product, offer) {
  const anchor = element('a', product.title);
  anchor.href = offer.url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

async function calculate(event) {
  event?.preventDefault();
  status.textContent = 'Recalculating…';
  try {
    const params = new URLSearchParams(new globalThis.FormData(form));
    const response = await fetch(`/api/compare?${params}`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error);
    }
    const rows = result.comparisons.map(
      ({ product, offer, metrics, eligible, problems }) => {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.append(
          listingLink(product, offer),
          element('small', `${offer.seller} · ${product.proteinType}`),
          element(
            'small',
            `${number(product.netMassG)} g · ${number(product.netVolumeMl)} ml · ${[...new Set((product.selectedVariant || []).map((variant) => variant.text))].join(' / ')}`
          ),
          element(
            'small',
            metrics.shippingDestination
              ? `Delivery: ${metrics.shippingDestination}; quote for ${metrics.shippingQuantity} package(s)`
              : 'Delivery quote pending'
          ),
          element(
            'small',
            eligible ? 'Confirmed comparison' : problems.join('; ')
          )
        );
        row.append(cell);
        for (const value of [
          metrics.proteinPer100g,
          metrics.totalBeforeDelivery,
          metrics.totalAfterDelivery,
          metrics.costPerGramBeforeDelivery,
          metrics.costPerGramAfterDelivery,
          metrics.costPerMlBeforeDelivery,
          metrics.costPerMlAfterDelivery,
          metrics.costPerProteinGramBeforeDelivery,
          metrics.costPerProteinGramAfterDelivery,
          metrics.costPer25gProteinBeforeDelivery,
          metrics.costPer25gProteinAfterDelivery,
        ]) {
          row.append(element('td', number(value)));
        }
        const evidence = document.createElement('td');
        evidence.append(productDetails(product));
        row.append(evidence);
        return row;
      }
    );
    document.querySelector('#offers').replaceChildren(...rows);
    document.querySelector('#excluded').replaceChildren(
      ...result.excluded.map(({ product, offer, problems, metrics }) => {
        const entry = document.createElement('li');
        entry.append(
          listingLink(product, offer),
          element(
            'p',
            `${number(offer.price ?? null)} ${offer.currency} per package · ${problems.join('; ')}`
          ),
          element(
            'p',
            `Calculation for ${metrics.quantity} packages: ${number(metrics.totalCost)} ${metrics.currency}${metrics.shippingKnown ? '' : ' before shipping'} · ${number(metrics.costPer25gProtein)} ${metrics.currency} per 25 g protein`
          ),
          productDetails(product)
        );
        return entry;
      })
    );
    status.textContent = `${result.comparisons.length} compared · ${result.ranked.length} eligible offers · ${result.excluded.length} need information · Prices in ${result.assumptions.currency} · ${new Date(result.calculatedAt).toLocaleString()}`;
  } catch (error) {
    status.textContent = error.message;
  }
}

form.addEventListener('submit', calculate);
calculate();
