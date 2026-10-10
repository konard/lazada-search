import test from 'node:test';
import assert from 'node:assert/strict';
import { captureViewport } from '../src/page-capture.js';

const viewport = {
  x: 0,
  y: 2400,
  width: 1200,
  height: 885,
  deviceScaleFactor: 2,
};

test('view capture prohibits the full-page compositor surface and detaches its CDP session', async () => {
  let detached = false;
  const result = await captureViewport(
    {
      evaluate: async () => viewport,
      screenshot: () => {
        throw new Error('Engine screenshot must not run');
      },
    },
    {
      openSession: async () => ({
        send: async (command, options) => {
          assert.equal(command, 'Page.captureScreenshot');
          assert.deepEqual(options, {
            format: 'png',
            fromSurface: false,
            captureBeyondViewport: false,
          });
          return { data: Buffer.from('visible pixels').toString('base64') };
        },
        detach: async () => {
          detached = true;
        },
      }),
    }
  );
  assert.equal(result.bytes.toString(), 'visible pixels');
  assert.equal(result.method, 'cdp-view');
  assert.equal(result.y, 2400);
  assert.equal(detached, true);
});

for (const reason of ['unsupported', 'rejected', 'timeout']) {
  test(`a ${reason} CDP capture falls back to viewport only`, async () => {
    let detached = false;
    const result = await captureViewport(
      {
        evaluate: async () => viewport,
        screenshot: async (options) => {
          assert.equal(options.fullPage, false);
          assert.equal(options.type, 'png');
          return Buffer.from('viewport fallback');
        },
      },
      {
        timeoutMs: 10,
        openSession: async () => {
          if (reason === 'unsupported') {
            throw new Error('CDP unavailable');
          }
          return {
            send: async () => {
              if (reason === 'rejected') {
                throw new Error('CDP failure');
              }
              return new Promise(() => {});
            },
            detach: async () => {
              detached = true;
            },
          };
        },
      }
    );
    assert.equal(result.bytes.toString(), 'viewport fallback');
    assert.equal(result.method, 'engine-viewport');
    assert.equal(result.y, 2400);
    assert.equal(detached, reason !== 'unsupported');
  });
}
