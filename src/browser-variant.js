import { resolvePageDialogs } from './page-dialogs.js';
import { waitForPageReady } from './page-readiness.js';
import { animateScroll } from './page-scroll.js';

const selector =
  '[data-sku-option], .sku-variable-size, .sku-variable-img-wrap, .sku-variable-img-wrap-selected, .sku-variable-name, .sku-variable-name-selected';

async function visibleChoice(page, option) {
  const choices = page.locator(selector);
  const index = await choices.evaluateAll(
    (elements, requested) =>
      elements.findIndex((element) => {
        const bounds = element.getBoundingClientRect();
        const labels = [
          element.textContent?.trim(),
          element.getAttribute('title'),
          element.querySelector('img')?.alt,
        ];
        const group = element.closest('.sku-prop-selection, [data-sku-group]');
        const groupLabel = group
          ?.querySelector(
            '.section-title, .section-title-v2, [data-sku-group-name]'
          )
          ?.textContent?.replace(/[:：]\s*$/u, '')
          .trim();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          labels.includes(requested.value) &&
          (!groupLabel || groupLabel === requested.name)
        );
      }),
    option
  );
  if (index < 0) {
    throw new Error('Requested SKU option has no visible selector');
  }
  return choices.nth(index);
}

export async function selectVariantOptions({
  page,
  target,
  url,
  scheduler,
  runtime,
  settleMs,
  assertActive = () => {},
}) {
  for (const option of target.options) {
    assertActive();
    await resolvePageDialogs(page, { assertActive });
    const choice = await visibleChoice(page, option);
    if (
      await choice.evaluate(
        (element) =>
          /(?:selected|active)/iu.test(element.className) ||
          element.getAttribute('aria-checked') === 'true'
      )
    ) {
      continue;
    }
    await scheduler.pace(url);
    await runtime.pace?.(url, scheduler.intervalMs);
    assertActive();
    await resolvePageDialogs(page, { assertActive });
    // Move the actual option into view with the same animation used for product
    // content, avoiding Playwright's abrupt automatic scroll before a click.
    const position = await choice.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top < 180 || bounds.bottom > globalThis.innerHeight - 24
        ? Math.max(
            0,
            globalThis.scrollY + bounds.top - globalThis.innerHeight / 2
          )
        : undefined;
    });
    if (position !== undefined) {
      assertActive();
      await page.evaluate(animateScroll, { target: position, durationMs: 650 });
    }
    assertActive();
    await choice.click();
    await page.waitForTimeout(Math.max(500, settleMs));
    await resolvePageDialogs(page, { assertActive });
    await waitForPageReady(page, { assertActive });
  }
}
