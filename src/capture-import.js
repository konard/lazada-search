import { parseHTML } from 'linkedom';
import { extractPage, classifyPage, EXTRACTOR_VERSION } from './browser.js';
import { parseProduct } from './products.js';
import { parsePrice } from './nutrition.js';
import { canonicalUrl } from './util.js';

// An existing browser can export DOM evidence without giving this application
// its cookies. Keep the selected SKU, its source URL and observation time.
export async function importBrowserCapture(application, capture) {
  const sourceUrl = canonicalUrl(capture.url);
  application.assertMarket(sourceUrl);
  const observed = Date.parse(capture.observedAt);
  if (!Number.isFinite(observed) || observed > Date.now() + 60000) {
    throw new Error('Capture requires a valid observation timestamp');
  }
  const bytes = Buffer.from(capture.html);
  if (!bytes.length || bytes.includes('[Truncated]')) {
    throw new Error('Capture HTML is incomplete');
  }
  const { document } = parseHTML(bytes.toString('utf8'));
  const snapshot = extractPage({ document, url: sourceUrl });
  const status = classifyPage(snapshot);
  if (status !== 'ok') {
    throw new Error(`Capture stopped: ${status}`);
  }
  const parsed = parseProduct(snapshot);
  if (!snapshot.priceText || !snapshot.sku || !parsed.offer.variantConfirmed) {
    throw new Error('Capture must display the requested SKU and its own price');
  }
  const itemId = new URL(sourceUrl).pathname.match(/-i(\d+)/u)?.[1];
  if (!itemId) {
    throw new Error('Capture requires a Lazada item URL');
  }
  // URLs change when a person selects an option. One item + SKU has one
  // product identity, regardless of the seller's changing URL slug.
  const url = `https://${application.host}/products/pdp-i${itemId}.html`;
  snapshot.url = url;
  const html = await application.store.putBlob(bytes);
  const screenshot = capture.screenshot
    ? await application.store.putBlob(Buffer.from(capture.screenshot))
    : undefined;
  await application.store.put('cache', {
    id: `lazada:${application.market}:${application.deliveryArea}:${url}`,
    url,
    finalUrl: url,
    sourceUrl,
    snapshot,
    status,
    html,
    screenshot,
    extractorVersion: EXTRACTOR_VERSION,
    extractedHtmlSha256: html.sha256,
    fetchedAt: observed,
    checkedAt: observed,
    repositoryReusable: true,
  });
  const result = await application.collect(url);
  await retainDelivery(
    application,
    capture,
    document,
    html,
    screenshot,
    result
  );
  return result;
}

async function retainDelivery(
  application,
  capture,
  document,
  html,
  screenshot,
  result
) {
  const destination = document
    .querySelector('.location-v2__address, .location__address')
    ?.textContent?.trim();
  const text =
    document.querySelector('.delivery-v2, .delivery')?.textContent || '';
  // A product-page estimate is always scoped to one package. The quantity
  // picker does not supply a freight total for a larger basket.
  if (
    application.market === 'vn' &&
    application.deliveryArea === 'Nha Trang' &&
    destination === 'Khánh Hòa, Phường Nha Trang'
  ) {
    const amount = text.match(/phí vận chuyển\s*([\d.,]+)\s*(?:₫|đ)/iu);
    const shipping = amount ? parsePrice(amount[1]) : undefined;
    const evidenceId = `delivery:${html.sha256}:${result.offer.sku}`;
    await application.store.put('evidence', {
      id: evidenceId,
      role: 'delivery',
      url: canonicalUrl(capture.url),
      html,
      screenshot,
      text,
      observedAt: capture.observedAt,
      shippingQuantity: 1,
      shippingDestination: destination,
    });
    if (
      Number.isFinite(shipping) ||
      /không thể giao|cannot.*deliver/iu.test(text)
    ) {
      result.offer = await application.quote(result.offer.id, {
        ...(Number.isFinite(shipping)
          ? { shipping, shippingQuantity: 1 }
          : { deliveryAvailable: false }),
        deliveryArea: application.deliveryArea,
        shippingDestination: destination,
        quoteEvidenceId: evidenceId,
        quoteObservedAt: new Date(capture.observedAt).toISOString(),
      });
    }
  }
}
