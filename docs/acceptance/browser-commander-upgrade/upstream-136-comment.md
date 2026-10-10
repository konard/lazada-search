The dependency-audit finding in this issue is reproducible again for a fresh consumer of **browser-commander 0.28.0** (verified 2026-10-10, Node 22.23.0). This is a consumer dependency-resolution regression; I have not demonstrated an exploitable Browser Commander execution path.

The published `command-stream: "^1.4.0"` range resolves the following dependency chain:

```text
browser-commander@0.28.0
└── command-stream@1.6.2
    └── shelljs@0.10.0
        └── fast-glob@3.3.3
            └── micromatch@4.0.8
                └── braces@3.0.3
```

A minimal package containing only `"dependencies": {"browser-commander":"0.28.0"}` reproduces **five high npm-audit entries**, propagated from the one braces advisory [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The advisory currently lists no patched release. Existing upstream tracking includes [braces #70](https://github.com/micromatch/braces/issues/70), [braces #73](https://github.com/micromatch/braces/issues/73), and [fast-glob #532](https://github.com/mrmlnc/fast-glob/issues/532).

Reproduction without running dependency install scripts:

```sh
npm install --package-lock-only --ignore-scripts
npm audit --omit=dev
npm audit fix --dry-run --package-lock-only --ignore-scripts --omit=dev --json
```

The last command was also tested against our current consumer lockfile: exit status 1, zero packages added/removed/changed, and all five high entries remain, despite the audit report's `fixAvailable: true`. The earlier [PR #139](https://github.com/link-foundation/browser-commander/pull/139) audit passed with command-stream 1.4.0 in its prepared lockfile; that lockfile does not constrain downstream consumers resolving `^1.4.0` today.

There is an important mitigation already present in **command-stream 1.6.2**. Its ShellJS compatibility entry installs a fast-glob nesting/length guard before loading ShellJS. A controlled offline probe using a 9,001-character pattern with 4,500 nested braces produced a `RangeError: Maximum call stack size exceeded` through direct braces 3.0.3, but the guarded ShellJS path rejected it with `SyntaxError`, code `ERR_SHELLJS_GLOB_DEPTH`, before that recursion. Browser Commander 0.28.0's runtime import is the lightweight `command-stream/process-runner` argv-based adapter, not the ShellJS compatibility entry. These facts qualify the dependency audit; they do not establish a Browser Commander exploit.

In an isolated minimal package, a scoped consumer override to command-stream **1.4.0** removed ShellJS/fast-glob/braces and produced **zero audit vulnerabilities**. Its `command-stream/process-runner` export exists. However, Browser Commander 0.28.0's new detached-process adapter accesses runner lifecycle internals, and I have **not runtime-validated that adapter against 1.4.0**. No override was applied to our live collector, no existing browser was restarted, and this is not a claim of full runtime compatibility.

Could the dependency/CI strategy cover a fresh downstream resolution of the published range, with the existing guard explicitly documented and tested? A dependency constraint or replacement should also retain the new detached-process behavior before being recommended as the fix.
