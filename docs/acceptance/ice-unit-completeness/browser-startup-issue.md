The latest installed release, Browser Commander **0.31.1**, intermittently failed its initial real-Chrome launch on macOS after Chrome had printed a DevTools endpoint. The immediate isolated retry passed. This is an observed failure report; its underlying cause and deterministic reproduction are not yet established.

Environment: macOS 15.7.7, Node.js 22.23.0, system Google Chrome 155.0.8059.39. No marketplace navigation, sign-in or external page request is involved.

The caller invokes `launchBrowser` from a fresh worker process with:

```js
{
  debug: false,
  channel: 'chrome',
  headless: true,
  userDataDir: '/temporary/fresh-profile',
  persistSessionCookies: true,
}
```

Observed error after about 30.9 seconds:

```text
Browser launch failed (connect: startup_timeout):
DevTools listening on [url]
Trying to load the allocator multiple times. This is *not* supported.
ERROR: CVDisplayLinkCreateWithCGDisplay failed. CVReturn: -6670
```

The display-link warnings repeat. They may be incidental; I have no evidence that they caused the timeout. The failure occurred at the first launch in `persistent-window-recovery.test.js`, before its deliberate supervisor termination or recovery step.

The full local E2E suite passed 63 of 64 tests. Running only the affected test immediately afterward passed in 4.3 seconds, without changing its code or options:

```sh
node --test --test-concurrency=1 --test-timeout=120000 tests/e2e/persistent-window-recovery.test.js
```

Caller and test: [persistent browser worker](https://github.com/konard/lazada-search/blob/main/src/persistent-browser-worker.js), [recovery test](https://github.com/konard/lazada-search/blob/main/tests/e2e/persistent-window-recovery.test.js). Original failed-suite and isolated-retry logs will be retained in [the acceptance folder](https://github.com/konard/lazada-search/tree/main/docs/acceptance/ice-unit-completeness).

Please investigate readiness/attachment timeouts after a DevTools endpoint is emitted and confirm that an unsuccessful launch cleans up only its own process/profile. The current caller propagates the failure and retains its diagnostics; no automatic relaunch workaround has been added.

I searched all issue states for `startup_timeout`, `startup timeout`, `macOS launch` and `CVDisplayLink`. Issue #135 covers safe launch diagnostics rather than this intermittent successful-spawn/failed-connect observation; I did not find an existing report of this exact symptom.
