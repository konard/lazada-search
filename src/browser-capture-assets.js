import { createCdpSession } from 'browser-commander';

export function imageCaptureContext() {
  return {
    accepting: true,
    cancelled: false,
    controller: new AbortController(),
    tasks: new Set(),
    deferredUrls: new Set(),
    admitted: 0,
  };
}

export function assertCaptureActive(context) {
  if (context.cancelled) {
    const error = new Error(
      'Page capture was cancelled before its next action'
    );
    error.code = 'PAGE_CAPTURE_CANCELLED';
    throw error;
  }
}

export function imageCaptureGuard(collector, context) {
  return (url) => {
    if (collector.closing || context.cancelled) {
      context.deferredUrls.add(url);
      const error = new Error(
        'Image acquisition deferred after its capture ended'
      );
      error.code = 'IMAGE_ACQUISITION_DEFERRED';
      throw error;
    }
  };
}

export async function settleCaptureImages(context, timeoutMs) {
  context.accepting = false;
  let timer;
  const drain = async () => {
    while (context.tasks.size) {
      await Promise.allSettled([...context.tasks]);
    }
  };
  try {
    const completed = await Promise.race([
      drain().then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!completed) {
      context.cancelled = true;
      await drain();
    }
    return {
      admitted: context.admitted,
      assetPhaseCompleted: completed,
      deferredUrls: [...context.deferredUrls].sort(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Cancel navigation in the existing page. Work still running after the bounded
// wait prevents a new capture until its cancelled operation settles.
export async function recoverPersistentCapture(page, pending, waitMs = 2000) {
  let session;
  try {
    session = await createCdpSession(page);
    await session.send('Page.stopLoading');
  } catch {
    // Captures still check their cancellation token before every next action.
  } finally {
    await session?.detach().catch(() => {});
  }
  const recovery = { settled: false };
  pending
    .finally(() => {
      recovery.settled = true;
    })
    .catch(() => {});
  let timer;
  try {
    await Promise.race([
      pending.catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return recovery;
}
