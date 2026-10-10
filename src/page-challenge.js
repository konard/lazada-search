export const COLLECTION_STOP_ID = 'browser-collection';
const challengeStores = new WeakMap();

export function registerChallengeStore(page, store) {
  challengeStores.set(page, store);
}

// Serialized into the page realm; also works against cached HTML in Node.
export function inspectPageChallenge(context) {
  const document = context?.document || globalThis.document;
  const url = context?.url || globalThis.location?.href || '';
  const visible = (element) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (
        parent.hidden ||
        parent.getAttribute('aria-hidden') === 'true' ||
        /display\s*:\s*none|visibility\s*:\s*hidden/iu.test(
          parent.getAttribute('style') || ''
        )
      ) {
        return false;
      }
    }
    if (typeof globalThis.getComputedStyle === 'function') {
      const style = globalThis.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    }
    return true;
  };
  const signals = [];
  if (
    /\/_____tmd_____\/punish|\/captcha(?:\/|\?|$)|\/secverify(?:\/|\?|$)/iu.test(
      url
    )
  ) {
    signals.push('challenge-url');
  }
  if (
    /captcha|security verification|robot check|xác minh bảo mật/iu.test(
      document.title || ''
    )
  ) {
    signals.push('challenge-title');
  }
  const markers = document.querySelectorAll(
    '[data-captcha], [data-security-challenge], #nc_1_wrapper, #nc_1_n1z, .nc-container, .nc_wrapper, #baxia-dialog, #baxia-dialog-content, .g-recaptcha, .h-captcha, .cf-turnstile, .geetest_panel, iframe[src]'
  );
  if (
    [...markers].some(
      (element) =>
        visible(element) &&
        (element.tagName !== 'IFRAME' ||
          /captcha|punish|secverify|nocaptcha|baxia|hcaptcha|challenges\.cloudflare/iu.test(
            element.getAttribute('src') || ''
          ))
    )
  ) {
    signals.push('visible-challenge-widget');
  }
  const visibleText = () => {
    const body = document.body;
    // innerText excludes hidden templates live. Offline, prune those templates.
    if (!context?.document && typeof body?.innerText === 'string') {
      return body.innerText;
    }
    if (!body) {
      return '';
    }
    const copy = body.cloneNode(true);
    for (const node of copy.querySelectorAll(
      'script, style, [hidden], [aria-hidden="true"], [style]'
    )) {
      if (['SCRIPT', 'STYLE'].includes(node.tagName) || !visible(node)) {
        node.remove();
      }
    }
    return copy.textContent;
  };
  if (
    /please complete the security check|performing security verification|verif(?:y|ying) (?:that )?you are human|verifies you are not a bot|i am not a robot|slide to verify|verify to continue|unusual traffic|xác minh bảo mật|trượt để xác minh|kéo.{0,35}(?:xác minh|hoàn thành)|xác (?:minh|nhận).{0,35}không phải (?:là )?(?:robot|người máy)/iu.test(
      visibleText()
    )
  ) {
    signals.push('challenge-instructions');
  }
  return { detected: signals.length > 0, signals, url };
}

export class CollectionStoppedError extends Error {
  constructor(challenge = {}) {
    super(
      'Collection stopped: CAPTCHA or security challenge. Clear it manually, then explicitly resume collection.'
    );
    this.name = 'CollectionStoppedError';
    this.code = 'COLLECTION_STOPPED';
    this.reason = 'challenge';
    this.challenge = challenge;
  }
}

export async function assertPageNotChallenged(page) {
  const challenge = await page.evaluate(inspectPageChallenge);
  if (challenge.detected) {
    const store = challengeStores.get(page);
    if (store) {
      await stopForChallenge(store, challenge);
    }
    throw new CollectionStoppedError(challenge);
  }
  return challenge;
}

export async function stopForChallenge(store, challenge) {
  const previous = await store.get('collection-stop', COLLECTION_STOP_ID);
  if (previous?.active) {
    return previous;
  }
  let origin = null;
  try {
    origin = new URL(challenge.url).origin;
  } catch {
    /* A blank page has no origin. */
  }
  return store.put('collection-stop', {
    id: COLLECTION_STOP_ID,
    active: true,
    reason: 'challenge',
    detectedAt: new Date().toISOString(),
    origin,
    signals: challenge.signals || [],
  });
}

export async function assertCollectionRunning(store) {
  const state = await store.get('collection-stop', COLLECTION_STOP_ID);
  if (state?.active) {
    throw new CollectionStoppedError(state);
  }
}
