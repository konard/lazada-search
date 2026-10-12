import { sha256 } from './util.js';
import {
  assertCollectionRunning,
  assertPageNotChallenged,
  stopForChallenge,
} from './page-challenge.js';
import { importLazadaCheckoutSnapshot } from './lazada-checkout-adapter.js';
import { assertLiveCheckoutBindings } from './lazada-checkout-line-bindings.js';

// Serialized into the page realm. It reads only; no dialogs are clicked.
export function inspectPreparedCheckoutPage() {
  const document = globalThis.document;
  const visible = (element) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const style = globalThis.getComputedStyle(parent);
      if (
        style.display === 'none' ||
        ['hidden', 'collapse'].includes(style.visibility)
      ) {
        return false;
      }
    }
    return element.getClientRects().length > 0;
  };
  const dialogSelectors =
    'dialog[open], [role="dialog"], [aria-modal="true"], .next-dialog, .ant-modal, .medical-disclaimer-modal';
  const selectors = `${dialogSelectors}, [aria-busy="true"], [data-loading="true"], [data-page-loading], .next-loading, .ant-spin-spinning`;
  const blockers = [...document.querySelectorAll(selectors)]
    .filter(visible)
    .map((element) => ({
      tag: element.tagName,
      role: element.getAttribute('role'),
      kind: element.matches(dialogSelectors) ? 'dialog' : 'loading',
      text: element.innerText?.slice(0, 300) || '',
    }));
  const inputs = [...document.querySelectorAll('input, select')]
    .filter(visible)
    .map((input) => [
      input.getAttribute('type'),
      input.value,
      input.checked,
      input.getAttribute('aria-checked'),
    ]);
  return {
    ready: document.readyState !== 'loading' && blockers.length === 0,
    blockers,
    fingerprint: JSON.stringify([
      (document.body?.innerText || '').slice(0, 1000000),
      inputs,
    ]),
    url: globalThis.location.href,
  };
}

export async function requirePreparedCheckoutPage(application) {
  if (application.store.visibility !== 'private') {
    throw new Error(
      'Prepared checkout capture and actions require a private account store'
    );
  }
  await assertCollectionRunning(application.store);
  const page = application.collector?.runtime?.page;
  if (!page || page.isClosed?.()) {
    throw new Error(
      'Reuse an already-open persistent prepared checkout; this adapter never launches a browser or navigates'
    );
  }
  const url = new URL(page.url());
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !/(?:^|\.)lazada\.vn$/u.test(url.hostname) ||
    !/\/(?:cart|checkout)(?:\/|$)/u.test(url.pathname)
  ) {
    throw new Error(
      'Existing browser page must be a credential-free Lazada Vietnam cart or checkout'
    );
  }
  await application.collector.runtime.touch?.();
  await assertPageNotChallenged(page);
  return page;
}

export async function waitPreparedCheckoutStable(
  application,
  page,
  { timeoutMs = 30000, stableMs = 2000, sourceUrl = page.url() } = {}
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 2000 ||
    timeoutMs > 60000 ||
    !Number.isSafeInteger(stableMs) ||
    stableMs < 2000 ||
    stableMs > 10000 ||
    timeoutMs < stableMs
  ) {
    throw new Error(
      'Checkout readiness requires bounded timeout and at least two seconds of stable state'
    );
  }
  const deadline = Date.now() + timeoutMs;
  let previous, stableSince;
  while (Date.now() <= deadline) {
    await assertCollectionRunning(application.store);
    await assertPageNotChallenged(page);
    const state = await page.evaluate(inspectPreparedCheckoutPage);
    if (state.url !== sourceUrl) {
      throw new Error(
        'Prepared checkout URL changed; capture and actions stopped'
      );
    }
    if (state.blockers.some((blocker) => blocker.kind === 'dialog')) {
      throw new Error(
        'Resolve the existing checkout dialog before any capture or action'
      );
    }
    if (state.ready && state.fingerprint === previous) {
      if (Date.now() - stableSince >= stableMs) {
        return state;
      }
    } else {
      stableSince = Date.now();
    }
    previous = state.ready ? state.fingerprint : undefined;
    await page.waitForTimeout(500);
  }
  throw new Error(
    'Prepared checkout loading or totals did not settle; no quote was accepted'
  );
}

async function captureCurrent(application, input) {
  const page = await requirePreparedCheckoutPage(application);
  const sourceUrl = page.url();
  await application.collector.runtime.pace?.(
    sourceUrl,
    Math.max(60000, application.cache?.scheduler?.intervalMs || 0)
  );
  await waitPreparedCheckoutStable(application, page, {
    ...input.readiness,
    sourceUrl,
  });
  await assertLiveCheckoutBindings(page, input.layout?.lines);
  const selectors = [
    ...Object.values(input.layout?.selectors || {}),
    ...(input.layout?.lines || []).flatMap((line) =>
      Object.values(line.selectors || {})
    ),
    ...(input.layout?.appliedDiscounts || []).flatMap((discount) => [
      discount.selector,
      discount.identitySelector,
    ]),
  ].filter(Boolean);
  for (const selector of selectors) {
    const field = page.locator(selector);
    if ((await field.count()) !== 1 || !(await field.isVisible())) {
      throw new Error(
        'Every original quoted checkout field must be uniquely visible in the current rendered page'
      );
    }
  }
  const html = Buffer.from(await page.content());
  await assertCollectionRunning(application.store);
  await assertPageNotChallenged(page);
  if (page.url() !== sourceUrl) {
    throw new Error('Checkout URL changed while preserving original HTML');
  }
  const observedAt = new Date().toISOString();
  const sourceSha256 = sha256(html);
  return importLazadaCheckoutSnapshot(application, {
    html,
    layout: input.layout,
    metadata: {
      sourceUrl,
      sourceSha256,
      observedAt,
      evidenceId: `checkout-evidence:${sha256(JSON.stringify([sourceSha256, observedAt]))}`,
      market: 'vn',
      currency: 'VND',
      deliveryArea: input.deliveryArea,
    },
  });
}

/** Readonly, queued current-page capture; no launch, navigation, clicks or screenshots. */
export function capturePreparedLazadaCheckout(application, input = {}) {
  const collector = application.collector;
  if (!collector?.tail) {
    throw new Error(
      'Prepared checkout capture requires an existing browser collector'
    );
  }
  const action = async () => {
    try {
      return await captureCurrent(application, input);
    } catch (error) {
      if (error.challenge) {
        await stopForChallenge(application.store, error.challenge);
      }
      throw error;
    }
  };
  const pending = collector.tail.then(action, action);
  collector.tail = pending.catch(() => {});
  return pending;
}
