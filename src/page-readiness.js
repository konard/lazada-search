import { resolvePageDialogs } from './page-dialogs.js';

// This function is serialized into the browser realm and also used on saved HTML.
export function inspectPageReadiness(context) {
  const document = context?.document || globalThis.document;
  const url = context?.url || globalThis.location.href;
  const visible = (element) => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    if (!globalThis.getComputedStyle || !element.getBoundingClientRect) {
      return !/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(
        element.getAttribute('style') || ''
      );
    }
    const style = globalThis.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  };
  const blockers = [
    ...document.querySelectorAll(
      '[aria-busy="true"], [data-loading="true"], [data-page-loading], .iweb-loading-container, .next-loading, .ant-spin-spinning'
    ),
  ]
    .filter(visible)
    .map((element) => element.className || element.tagName);
  const productPage =
    /lazada\./u.test(new URL(url).hostname) &&
    /\/products\//u.test(new URL(url).pathname);
  const searchPage =
    /lazada\./u.test(new URL(url).hostname) &&
    /\/(?:catalog|protein|bach-hoa-online-kem-(?:cac-loai|daua))\//u.test(
      new URL(url).pathname
    );
  const searchCards = [
    ...document.querySelectorAll(
      '[data-qa-locator="product-item"], .Bm3ON, [data-product-card]'
    ),
  ].filter(visible);
  const emptyResults = [
    ...document.querySelectorAll(
      '[data-empty-results], .search-no-result, .search-no-results'
    ),
  ].some(visible);
  const missingSearch = searchPage && searchCards.length === 0 && !emptyResults;
  const title = document
    .querySelector('.pdp-mod-product-badge-title, [data-product-title], h1')
    ?.textContent?.trim();
  const price = document
    .querySelector(
      '.pdp-price_type_normal, .pdp-v2-product-price-content-salePrice-amount, [data-product-price]'
    )
    ?.textContent?.trim();
  const missingProduct = productPage && (!title || !/\d/u.test(String(price)));
  const content = [
    ...document.querySelectorAll(
      '.pdp-product-desc, .pdp-product-desc-v2, [data-description], .key-li, [data-product-price], .pdp-mod-product-price-v2'
    ),
  ]
    .map((element) => element.textContent)
    .join('|');
  return {
    ready: [
      document.readyState !== 'loading',
      blockers.length === 0,
      !missingProduct,
      !missingSearch,
    ].every(Boolean),
    blockers,
    missingProduct,
    missingSearch,
    fingerprint: `${title}|${price}|${content}|${searchCards.map((card) => card.textContent).join('|')}`,
  };
}

export async function waitForPageReady(
  page,
  { timeoutMs = 30000, intervalMs = 500, stableMs = 1000, now = Date.now } = {}
) {
  const deadline = now() + timeoutMs;
  let previous;
  let stableSince;
  let readiness;
  do {
    await resolvePageDialogs(page);
    readiness = await page.evaluate(inspectPageReadiness);
    if (readiness.ready && readiness.fingerprint === previous) {
      if (now() - stableSince >= stableMs) {
        return readiness;
      }
    } else {
      stableSince = now();
    }
    previous = readiness.ready ? readiness.fingerprint : undefined;
    await page.waitForTimeout(intervalMs);
  } while (now() < deadline);
  throw new Error(
    `Page loading did not settle within ${timeoutMs} ms: ${readiness.blockers.join(', ') || (readiness.missingSearch ? 'search cards or explicit empty-results message are still missing' : 'product title or price is still missing')}`
  );
}
