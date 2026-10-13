import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  imageCaptureContext,
  imageCaptureGuard,
  assertCaptureActive,
  settleCaptureImages,
} from '../src/browser-capture-assets.js';
import { DomainScheduler, BrowserCollector } from '../src/index.js';

function track(context, task) {
  context.tasks.add(task);
  context.admitted++;
  task.finally(() => context.tasks.delete(task)).catch(() => {});
}

test('a bounded asset phase cancels queued requests without paying every pacing interval', async () => {
  const context = imageCaptureContext();
  const guard = imageCaptureGuard({ closing: false }, context);
  const scheduler = new DomainScheduler({ intervalMs: 50 });
  const requests = [];
  const tasks = Array.from({ length: 8 }, (_, index) => {
    const url = `https://img.lazcdn.com/asset-${index}.png`;
    const task = scheduler.run(
      url,
      async () => {
        requests.push(url);
      },
      { beforePace: () => guard(url) }
    );
    track(context, task);
    return task;
  });
  const started = Date.now();
  const result = await settleCaptureImages(context, 10);
  assert.equal(result.assetPhaseCompleted, false);
  assert.equal(result.admitted, 8);
  assert.equal(requests.length, 1);
  assert.equal(result.deferredUrls.length, 7);
  assert.equal(context.tasks.size, 0);
  assert.ok(Date.now() - started < 300);
  const results = await Promise.allSettled(tasks);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 7);
  await delay(70);
  assert.equal(requests.length, 1);
});

test('started original writes drain before the asset phase returns after cancellation', async () => {
  const context = imageCaptureContext();
  let durableWriteFinished = false;
  track(
    context,
    delay(40).then(() => {
      durableWriteFinished = true;
    })
  );
  const result = await settleCaptureImages(context, 5);
  assert.equal(result.assetPhaseCompleted, false);
  assert.equal(durableWriteFinished, true);
  assert.equal(context.tasks.size, 0);
  assert.equal(context.accepting, false);
});

test('cache-completed image phases retain successful acquisition and cancel guards stop later actions', async () => {
  const context = imageCaptureContext();
  track(context, Promise.resolve());
  assert.equal(
    (await settleCaptureImages(context, 100)).assetPhaseCompleted,
    true
  );
  assert.equal(context.cancelled, false);
  assertCaptureActive(context);
  context.cancelled = true;
  assert.throws(() => assertCaptureActive(context), {
    code: 'PAGE_CAPTURE_CANCELLED',
  });
  const guard = imageCaptureGuard({ closing: false }, context);
  assert.throws(() => guard('https://img.lazcdn.com/label.png'), {
    code: 'IMAGE_ACQUISITION_DEFERRED',
  });
  assert.deepEqual(
    [...context.deferredUrls],
    ['https://img.lazcdn.com/label.png']
  );
});

test('the capture image budget rejects invalid configuration', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(
      () => new BrowserCollector({ assetSettleTimeoutMs: value }),
      /assetSettleTimeoutMs/u
    );
  }
});
