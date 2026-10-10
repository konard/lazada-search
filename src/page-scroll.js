import { resolvePageDialogs } from './page-dialogs.js';
import { waitForPageReady } from './page-readiness.js';

// Serialized into the browser realm. Measure content, not the document footer.
export function inspectScrollBoundary() {
  const document = globalThis.document;
  const visible = (element) => {
    const style = globalThis.getComputedStyle(element);
    return (
      !element.hidden &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  };
  const bounds = (selector) =>
    [...document.querySelectorAll(selector)]
      .filter(visible)
      .map((element) => element.getBoundingClientRect());
  const productPage = /\/products\//u.test(globalThis.location.pathname);
  const cards = productPage
    ? []
    : bounds('[data-qa-locator="product-item"], .Bm3ON, [data-product-card]');
  const pager = cards.length
    ? bounds('.ant-pagination, [data-pagination]')
    : [];
  const content = cards.length
    ? [...cards, ...pager]
    : bounds(
        '.pdp-product-detail, .pdp-product-detail-v2, .pdp-product-desc, .pdp-product-desc-v2, .pdp-mod-specification, [data-description], [data-product-title], .pdp-mod-product-badge-title, [data-product-price], .gallery-preview-panel, .gallery-preview-panel-v2, .product__info-wrapper, .product__media-wrapper, .product-description, .product-description-wrapper, #product-description, .product-tabs-section, .nut-facts, main'
      );
  // A generic main can include recommendations. Prefer explicit PDP sections.
  if (productPage && content.length > 1) {
    const main = document.querySelector('main');
    if (main && visible(main)) {
      const mainBounds = main.getBoundingClientRect();
      const index = content.findIndex(
        (entry) =>
          entry.top === mainBounds.top && entry.bottom === mainBounds.bottom
      );
      if (index >= 0) {
        content.splice(index, 1);
      }
    }
  }
  const viewport = globalThis.innerHeight;
  const position = globalThis.scrollY;
  const bottom = content.length
    ? Math.max(...content.map((entry) => entry.bottom + position))
    : position + viewport;
  const footer = bounds('footer, [role="contentinfo"], #footer');
  const footerTop = footer.length
    ? Math.min(...footer.map((entry) => entry.top + position))
    : Infinity;
  // Lazada's minimized chat button can cover the final pagination controls.
  const bottomInset = Math.max(
    16,
    ...bounds('.im-app__cont-minimize, [data-scroll-overlay]')
      .filter(
        (entry) =>
          entry.top >= 0 &&
          entry.bottom >= viewport - 80 &&
          pager.some(
            (control) =>
              control.left < entry.right && control.right > entry.left
          )
      )
      .map((entry) => viewport - entry.top + 16)
  );
  const target = Math.max(
    0,
    Math.min(bottom + bottomInset, footerTop - 8) - viewport
  );
  const headerBottom = Math.max(
    0,
    ...bounds('header, [role="banner"], .lzd-header, .lzd-header-content')
      .filter((entry) => entry.top <= 1 && entry.bottom < viewport)
      .map((entry) => entry.bottom)
  );
  return {
    known: content.length > 0,
    kind: cards.length ? 'product-grid' : 'product-content',
    position,
    target,
    step: Math.max(80, Math.floor((viewport - headerBottom) * 0.65)),
    pagerObserved: pager.length > 0,
    bottomInset,
  };
}

export async function animateScroll({ target, durationMs }) {
  const start = globalThis.scrollY;
  const started = globalThis.performance.now();
  await new Promise((resolve) => {
    const frame = (time) => {
      const progress = Math.min(1, (time - started) / durationMs);
      const eased = progress * progress * (3 - 2 * progress);
      globalThis.scrollTo({
        top: start + (target - start) * eased,
        behavior: 'instant',
      });
      if (progress < 1) {
        globalThis.requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    globalThis.requestAnimationFrame(frame);
  });
}

export async function scrollProductContent(
  page,
  { maxSteps = 20, durationMs = 650 } = {}
) {
  let boundary;
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    await resolvePageDialogs(page);
    boundary = await page.evaluate(inspectScrollBoundary);
    if (!boundary.known || Math.abs(boundary.target - boundary.position) < 2) {
      break;
    }
    const distance = boundary.target - boundary.position;
    const target =
      boundary.position +
      Math.sign(distance) * Math.min(Math.abs(distance), boundary.step);
    await page.evaluate(animateScroll, { target, durationMs });
    await waitForPageReady(page);
  }
  boundary = await page.evaluate(inspectScrollBoundary);
  return {
    ...boundary,
    steps,
    settled:
      boundary.known && Math.abs(boundary.target - boundary.position) < 2,
  };
}
