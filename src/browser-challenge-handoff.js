import {
  COLLECTION_STOP_ID,
  stopForChallenge,
  mutateCollectionStop,
} from './page-challenge.js';
import { browserWindowStatus } from './persistent-browser.js';

export async function pageTargetId(page) {
  const session = await page.context().newCDPSession(page);
  try {
    return (await session.send('Target.getTargetInfo')).targetInfo.targetId;
  } finally {
    await session.detach();
  }
}

// Retain the existing page only. No navigation, launch, focus or CAPTCHA action.
export async function retainChallengePage(collector, challenge) {
  const stop = await stopForChallenge(collector.store, challenge);
  const page = collector.runtime?.page;
  if (
    !page ||
    page.isClosed() ||
    !stop.origin ||
    stop.origin !== new URL(page.url()).origin
  ) {
    return;
  }
  const targetId = await pageTargetId(page).catch(() => undefined);
  const headless = await page
    .evaluate(() => /HeadlessChrome/u.test(globalThis.navigator.userAgent))
    .catch(() => undefined);
  const retained = await mutateCollectionStop(collector.store, (current) => {
    if (
      !current?.active ||
      current.origin !== stop.origin ||
      (current.browser?.targetId && current.browser.targetId !== targetId)
    ) {
      return current;
    }
    return {
      ...current,
      browser: {
        targetId,
        mode: collector.persistent
          ? 'persistent'
          : collector.attached
            ? 'attached'
            : 'ephemeral',
        headless,
      },
    };
  });
  if (
    retained?.active &&
    retained.browser?.targetId &&
    retained.browser.targetId === targetId
  ) {
    collector.challengePage = page;
  }
}

async function retainedPageStatus(store, collector, browser) {
  if (!browser) {
    return { status: 'no-browser-page', pageOpen: false };
  }
  if (
    collector?.runtime &&
    collector.challengePage === collector.runtime.page &&
    browser.targetId &&
    (await pageTargetId(collector.runtime.page).catch(() => null)) ===
      browser.targetId
  ) {
    const pageOpen =
      !collector.challengePage.isClosed() &&
      (collector.runtime.browser.isConnected?.() ??
        collector.challengePage.context().browser()?.isConnected() ??
        false);
    return { status: pageOpen ? 'page-open' : 'window-closed', pageOpen };
  }
  if (browser.mode === 'persistent' && browser.targetId) {
    return browserWindowStatus(store.directory, browser.targetId);
  }
  return { status: 'window-unavailable', pageOpen: false };
}

export async function collectionStatus(store, collector) {
  const stop = (await store.get('collection-stop', COLLECTION_STOP_ID)) || {
    id: COLLECTION_STOP_ID,
    active: false,
  };
  if (!stop.active) {
    return stop;
  }
  const handoff = await retainedPageStatus(store, collector, stop.browser);
  if (handoff.pageOpen) {
    handoff.status =
      stop.browser.headless === false
        ? 'awaiting-user'
        : stop.browser.headless === true
          ? 'headless-page'
          : 'visibility-unconfirmed';
  }
  return { ...stop, handoff };
}
