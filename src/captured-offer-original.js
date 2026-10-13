import { parseHTML } from 'linkedom';
import { extractPage } from './browser.js';
import { parseProduct } from './products.js';
import { parsePrice } from './nutrition.js';

/** Re-extract ordinary listing evidence without running page scripts or requests. */
export function selectedPriceOriginalMatches(bytes, sourceUrl, offer) {
  const { document } = parseHTML(bytes.toString('utf8'));
  const snapshot = extractPage({ document, url: sourceUrl });
  const parsed = parseProduct(snapshot, { currency: offer.currency }).offer;
  return (
    parsed.sku === offer.sku &&
    parsed.variantConfirmed === true &&
    parsed.price === offer.price &&
    parsed.available === true
  );
}

/** A product-page estimate prices one package; bulk freight requires checkout. */
export function deliveryOriginalMatches(bytes, source, offer) {
  if (source.shippingQuantity !== 1 || offer.shippingQuantity !== 1) {
    return false;
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const destination = document
    .querySelector('.location-v2__address, .location__address')
    ?.textContent?.trim();
  const text =
    document.querySelector('.delivery-v2, .delivery')?.textContent || '';
  const amount = text.match(/phí vận chuyển\s*([\d.,]+)\s*(?:₫|đ)/iu);
  return (
    destination === offer.shippingDestination &&
    source.shippingDestination === destination &&
    Boolean(amount) &&
    parsePrice(amount[1], offer.currency) === offer.shipping &&
    selectedPriceOriginalMatches(bytes, source.url || source.sourceUrl, offer)
  );
}
