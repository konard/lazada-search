import { isDeepStrictEqual } from 'node:util';
import { encode } from 'lino-objects-codec';
import { COLLECTION_STOP_ID } from './page-challenge.js';
import { sha256 } from './util.js';

function validateReview(input) {
  if (
    input?.decision !== 'dismiss-non-browser-stop' ||
    typeof input.reason !== 'string' ||
    !input.reason.trim() ||
    !input.expectedStop ||
    typeof input.expectedStop !== 'object' ||
    Array.isArray(input.expectedStop)
  ) {
    throw new Error(
      'An explicit operator decision, reason and exact expected stop are required'
    );
  }
  let observedPageOrigin;
  if (input.observedPageUrl !== undefined) {
    const url = new URL(input.observedPageUrl);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('The reviewed page must have an HTTP origin');
    }
    observedPageOrigin = url.origin;
  }
  const expectedStop = { ...input.expectedStop };
  delete expectedStop.handoff;
  return { expectedStop, observedPageOrigin };
}

function assertExpectedStop(current, expected) {
  if (
    current?.id !== COLLECTION_STOP_ID ||
    current.active !== true ||
    !isDeepStrictEqual(current, expected)
  ) {
    throw new Error(
      'The collection stop changed; inspect and review its current checkpoint'
    );
  }
  if (Object.hasOwn(current, 'browser')) {
    throw new Error(
      'A browser challenge requires reviewing and clearing its retained original page'
    );
  }
}

// This is an operator decision about an HTTP/imported checkpoint, never proof
// that its challenged source is healthy. Browser CAPTCHA resume is unchanged.
export async function reviewNonBrowserCollectionStop(store, input) {
  const { expectedStop, observedPageOrigin } = validateReview(input);
  if (
    typeof store.locked !== 'function' ||
    typeof store.writeRecord !== 'function'
  ) {
    throw new Error('Operator stop review requires a durable locked store');
  }
  return await store.locked(async () => {
    const current = await store.get('collection-stop', COLLECTION_STOP_ID);
    assertExpectedStop(current, expectedStop);
    const requestedAt = new Date().toISOString();
    const request = {
      decision: input.decision,
      reason: input.reason.trim(),
      requestedAt,
      observedPageOrigin,
      checkpoint: current,
      status: 'requested',
      challengedSourceRecoveryConfirmed: false,
    };
    const review = {
      id: `collection-stop-review:${sha256(encode({ obj: request }))}`,
      ...request,
    };
    // Commit the request first. A later write failure leaves an intent, not a
    // false assertion of successful resume. The stop references applied intent.
    await store.writeRecord('collection-stop-review', {
      record: review,
      notation: encode({ obj: review }),
      path: store.recordPath('collection-stop-review', review.id),
    });
    const state = {
      ...current,
      active: false,
      resumedAt: requestedAt,
      operatorReviewId: review.id,
      resumeDecision: 'operator-dismissed-non-browser-stop',
      challengedSourceRecoveryConfirmed: false,
    };
    return store.writeRecord('collection-stop', {
      record: state,
      notation: encode({ obj: state }),
      path: store.recordPath('collection-stop', COLLECTION_STOP_ID),
    });
  });
}
