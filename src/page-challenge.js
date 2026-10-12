export const COLLECTION_STOP_ID = 'browser-collection';
const challengeStores = new WeakMap();
const stopQueues = new WeakMap();

export function registerChallengeStore(page, store, retainPage) {
  challengeStores.set(page, { store, retainPage });
}

// Serialized into the page realm; also works against cached HTML in Node.
export function inspectPageChallenge(context) {
  const document = context?.document || globalThis.document;
  const url = context?.url || globalThis.location?.href || '';
  const visible = (element) => {
    for (let parent = element; parent; parent = parent.parentElement) {
      if (
        ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(parent.tagName) ||
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
      'script, style, template, [hidden], [aria-hidden="true"], [style]'
    )) {
      if (['SCRIPT', 'STYLE'].includes(node.tagName) || !visible(node)) {
        node.remove();
      }
    }
    return copy.textContent;
  };
  const text = visibleText();
  // The interstitial can contain only a noscript fallback until its JavaScript
  // runs. Neither the generic waiting title nor hidden Cloudflare scripts alone
  // establish that a product page is currently challenged.
  if (
    /^\s*just a moment(?:\.{3}|…)?\s*$/iu.test(document.title || '') &&
    [
      ...document.querySelectorAll(
        '#challenge-error-text, #challenge-stage, #cf-challenge-running, #challenge-running'
      ),
    ].some(visible)
  ) {
    signals.push('visible-cloudflare-interstitial');
  }
  if (
    /please complete the security check|performing security verification|verif(?:y|ying) (?:that )?you are human|verifies you are not a bot|i am not a robot|slide to verify|verify to continue|unusual traffic|xác minh bảo mật|trượt để xác minh|kéo.{0,35}(?:xác minh|hoàn thành)|xác (?:minh|nhận).{0,35}không phải (?:là )?(?:robot|người máy)/iu.test(
      text
    )
  ) {
    signals.push('challenge-instructions');
  }
  return { detected: signals.length > 0, signals, url };
}

export class CollectionStoppedError extends Error {
  constructor(challenge = {}) {
    super(
      'Collection stopped: CAPTCHA or security challenge. Collection remains stopped until the challenged origin is clear and explicitly resumed.'
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
    const registration = challengeStores.get(page);
    if (registration) {
      await stopForChallenge(registration.store, challenge);
      await registration.retainPage?.(challenge);
    }
    throw new CollectionStoppedError(challenge);
  }
  return challenge;
}

export function stopForChallenge(store, challenge) {
  let origin = null;
  try {
    origin = new URL(challenge.url).origin;
  } catch {
    /* A blank page has no origin. */
  }
  return mutateCollectionStop(store, (previous) =>
    previous?.active
      ? previous
      : {
          id: COLLECTION_STOP_ID,
          active: true,
          reason: 'challenge',
          detectedAt: new Date().toISOString(),
          origin,
          signals: challenge.signals || [],
        }
  );
}

// The first challenge and its original target must win across concurrent pages.
export function mutateCollectionStop(store, update) {
  const atomic =
    typeof store.locked === 'function' &&
    typeof store.writeRecord === 'function';
  const action = async () => {
    const previous = await store.get('collection-stop', COLLECTION_STOP_ID);
    const record = update(previous);
    if (record === previous) {
      return previous;
    }
    return atomic
      ? store.writeRecord('collection-stop', {
          record,
          notation: encode({ obj: record }),
          path: store.recordPath('collection-stop', COLLECTION_STOP_ID),
        })
      : store.put('collection-stop', record);
  };
  if (atomic) {
    return store.locked(action);
  }
  // Compatible memory adapters share one queue; durable stores use their
  // cross-process writer lock and native notation/binary projections above.
  const result = (stopQueues.get(store) || Promise.resolve()).then(action);
  stopQueues.set(
    store,
    result.catch(() => {})
  );
  return result;
}

export async function assertCollectionRunning(store) {
  const state = await store.get('collection-stop', COLLECTION_STOP_ID);
  if (state?.active) {
    throw new CollectionStoppedError(state);
  }
}
import { encode } from 'lino-objects-codec';
