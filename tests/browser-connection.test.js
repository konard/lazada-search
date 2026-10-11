import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPersistentBrowser } from '../src/browser-connection.js';

test('empty headed Chrome context is warmed without defaults, then reused by Browser Commander', async () => {
  let connections = 0,
    newPages = 0,
    disconnects = 0;
  const runtime = { page: 'same-profile' };
  const options = {
    engine: 'playwright',
    cdpEndpoint: 'http://127.0.0.1:9222',
    timeout: 30000,
  };
  const result = await connectPersistentBrowser(options, {
    connect: async (actual) => {
      assert.deepEqual(actual, { debug: false, ...options });
      if (++connections === 1) {
        throw new Error(
          'Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.'
        );
      }
      return runtime;
    },
    loadChromium: async () => ({
      connectOverCDP: async (endpoint, settings) => {
        assert.equal(endpoint, options.cdpEndpoint);
        assert.deepEqual(settings, { timeout: 30000, noDefaults: true });
        return {
          contexts: () => [
            {
              pages: () => [],
              newPage: async () => {
                newPages++;
              },
            },
          ],
          close: async () => {
            disconnects++;
          },
        };
      },
    }),
  });
  assert.equal(result, runtime);
  assert.equal(connections, 2);
  assert.equal(newPages, 1);
  assert.equal(disconnects, 1);
});

test('private case connections disable automatic session recordings unless explicitly requested', async () => {
  for (const [options, debug] of [
    [{}, false],
    [{ debug: true }, true],
  ]) {
    await connectPersistentBrowser(options, {
      connect: async (actual) => {
        assert.equal(actual.debug, debug);
        return { page: 'persistent-private-case' };
      },
    });
  }
});

test('normal existing windows are reused without an extra connection or page', async () => {
  const runtime = { page: 'existing-page' };
  assert.equal(
    await connectPersistentBrowser(
      {},
      {
        connect: async () => runtime,
        loadChromium: async () => {
          throw new Error('Unexpected recovery');
        },
      }
    ),
    runtime
  );
});

test('unrelated connection failures propagate without retrying or launching', async () => {
  await assert.rejects(
    connectPersistentBrowser(
      {},
      {
        connect: async () => {
          throw new Error('Connection refused');
        },
        loadChromium: async () => {
          throw new Error('Unexpected recovery');
        },
      }
    ),
    /Connection refused/u
  );
});
