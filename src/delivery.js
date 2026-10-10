import { canonicalUrl, sha256 } from './util.js';
import { extractPage, classifyPage } from './browser.js';
import { parsePrice } from './nutrition.js';
import { resolvePageDialogs } from './page-dialogs.js';

// Lazada's product-page estimate describes one selected package. Its quantity
// picker does not establish a checkout freight quote for a bulk order.
export async function captureDelivery(
  collector,
  url,
  { province, locality, refresh = false } = {}
) {
  if (!province || !locality) {
    throw new Error(
      'A province and locality are required for a public delivery estimate'
    );
  }
  const destination = `${province}, ${locality}`;
  return await collector.cache.get(canonicalUrl(url), {
    namespace: `delivery:${destination}:1`,
    ttlMs: 21600000,
    refresh,
    load: async () => {
      const action = async () => {
        await collector.start();
        await collector.runtime?.touch?.();
        if (collector.runtime?.page) {
          await resolvePageDialogs(collector.runtime.page);
        }
        await collector.runtime?.pace?.(
          url,
          collector.cache.scheduler.intervalMs
        );
        await collector.commander.goto({
          url,
          timeout: 30000,
          waitUntil: 'domcontentloaded',
          waitForNetworkIdle: false,
        });
        const page = collector.commander.page;
        await page.waitForTimeout(collector.settleMs);
        await resolvePageDialogs(page);
        let snapshot = await page.evaluate(extractPage);
        if (classifyPage(snapshot) !== 'ok') {
          throw new Error(`Delivery stopped: ${classifyPage(snapshot)}`);
        }
        await collector.selectRequestedVariant(url, snapshot);
        if (await page.locator('.popup-btn-over').isVisible()) {
          await page.locator('.popup-btn-over').click({ timeout: 5000 });
        }
        await page
          .locator('.automation-location-link-change')
          .click({ timeout: 5000 });
        await page
          .locator('.automation-location-list-item')
          .filter({
            hasText: new RegExp(
              `^${province.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
              'u'
            ),
          })
          .click({ timeout: 5000 });
        await page
          .locator('.automation-location-list-item')
          .filter({
            hasText: new RegExp(
              `^${locality.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
              'u'
            ),
          })
          .click({ timeout: 5000 });
        await page.waitForTimeout(1500);
        const address = (
          await page
            .locator('.location-v2__address, .location__address')
            .first()
            .innerText()
        ).trim();
        if (address !== destination) {
          throw new Error(`Destination did not update: ${address}`);
        }
        const text = await page
          .locator('.delivery-v2, .delivery')
          .first()
          .innerText();
        const amount = text.match(/phí vận chuyển\s*([\d.,]+)\s*(?:₫|đ)/iu);
        const shipping = amount ? parsePrice(amount[1]) : undefined;
        snapshot = await page.evaluate(extractPage);
        const html = await collector.store.putBlob(
          Buffer.from(await page.content())
        );
        const screenshot = await collector.store.putBlob(
          await page.screenshot({ fullPage: true })
        );
        return {
          snapshot,
          text,
          shipping,
          shippingQuantity: 1,
          shippingDestination: destination,
          html,
          screenshot,
          evidenceId: `delivery:${sha256(JSON.stringify({ url, snapshot, text, destination }))}`,
          observedAt: new Date().toISOString(),
        };
      };
      const pending = collector.tail
        .then(action, action)
        .catch(async (error) => {
          const snapshot = await collector.runtime?.page
            ?.evaluate(extractPage)
            .catch(() => undefined);
          const status = snapshot ? classifyPage(snapshot) : 'unavailable';
          const html =
            snapshot &&
            (await collector.store.putBlob(
              Buffer.from(await collector.runtime.page.content())
            ));
          return {
            status: status === 'ok' ? 'unavailable' : status,
            error: error.message,
            snapshot,
            html,
            shippingDestination: destination,
            shippingQuantity: 1,
            observedAt: new Date().toISOString(),
          };
        });
      collector.tail = pending.catch(() => {});
      return await pending;
    },
  });
}
