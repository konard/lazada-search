The repository now installs the exact scoped override below. Its [installed full dependency audit](../continuation-fixes/dependency-audit-integrated.json) reports zero vulnerabilities, and the [integrated tests](../continuation-fixes/integrated-validation.json) passed945 unit and35 browser/interface/native E2E cases without skips. The isolated evidence preserved below explains the selected resolution.

Browser Commander 0.29.0 with Command Stream 2.0.2 removes the reported vulnerable runtime dependency chain in an isolated copy of the full Lazada Search lockfile. This is compatibility evidence for an exact scoped override; the isolated investigation itself did not change the repository's package configuration; the later integration does.

Observed on 2026-10-11 with Node 22.23.0 and public npm registry metadata saved alongside this receipt. The existing copied project lock reports five high vulnerabilities, zero moderate/low/critical. The isolated full project lock after the override reports zero vulnerabilities at every severity. A minimal Browser Commander 0.29.0 installation with Command Stream 1.6.2 reports six highs because npm also counts the direct Browser Commander parent in that tree; this is the same underlying advisory chain, not a sixth independent advisory.

| Browser Commander | Command Stream | Isolated minimal audit | Subprocess contract fixtures |
| ----------------- | -------------- | ---------------------- | ---------------------------- |
| 0.29.0            | 1.6.2          | 6 high                 | 7 passed, 0 failed           |
| 0.29.0            | 1.5.0          | 0 vulnerabilities      | 7 passed, 0 failed           |
| 0.29.0            | 2.0.2          | 0 vulnerabilities      | 7 passed, 0 failed           |

The affected chain is `command-stream@1.6.2 → shelljs@0.10.0 → fast-glob@3.3.3 → micromatch@4.0.8 → braces@3.0.3`. The npm report identifies [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), a stack-exhaustion denial of service through deeply nested brace patterns, affecting braces through 3.0.3. Registry metadata still lists braces 3.0.3 and ShellJS 0.10.0 as their latest releases, so increasing only those versions cannot remove the advisory.

[Command Stream issue 221](https://github.com/link-foundation/command-stream/issues/221) is the existing closed upstream report; the root agent fetched its body and confirmed its reported2.0.0 ShellJS/braces dependency chain and closed state. Independently cached [Command Stream 2.0.2 registry metadata](https://registry.npmjs.org/command-stream/2.0.2) proves that ShellJS and its dependency tree are absent, and the actual isolated installs/audits prove the advisory chain is removed. The receipt does not claim an unverified upstream issue comment or release rationale.

[Browser Commander 0.29.0 registry metadata](https://registry.npmjs.org/browser-commander/0.29.0) still declares `command-stream: ^1.4.0`, so ordinary installation selects 1.6.2 and does not reach the fixed major release. Use the following temporary exact scoped override until Browser Commander publishes a compatible dependency range:

```json
{
  "overrides": {
    "browser-commander": {
      "command-stream": "2.0.2"
    }
  }
}
```

Command Stream 2.0.2 requires Node >=22.0.0; Browser Commander 0.29.0 already requires >=22.12.0 and Lazada Search >=22.13.0. No increase in this project's minimum Node version is required. Browser Commander uses the lightweight `command-stream/process-runner` export exclusively. Both candidate versions preserve that export, and the exact Browser Commander adapter passed the same fixture contracts in all three installations. Prefer the current 2.0.2 over 1.5.0: the older release is a working rollback candidate but excludes later command-stream fixes.

The five original Browser Commander contract fixtures exercise argument boundaries without a shell, stdin/child environment isolation, nonzero exit handling, streaming/exit reporting and cancellation. Two added fixtures exercise missing-executable behavior and a detached child surviving its launcher while allowing the launcher to exit. The missing-executable baseline is an error with numeric code 127 and ENOENT stderr, consistently preserved across all tested versions. The detached fixture launches only a short-lived Node process that writes a temporary marker; it never opens a browser or website. All seven fixtures pass for each version. Lifecycle scripts were disabled during isolated package installations.

The copied project resolution updates command-stream 1.6.2→2.0.2 and its execa 9.6.1→10.1.0, removes 41 unused package paths and adds which-command. Command Stream 2.0.2 moves node-pty to optional dependencies with range ^1.1.0, so the existing native addon resolves 1.2.0-beta.15→1.1.0. Root-level browser/capture E2E must confirm this remaining native adapter behavior after installation. Full exact changes and audit/TAP SHA-256 receipts are in `report.json`.

Recommended application sequence: add the scoped override, install using the project's supported Node version, run npm audit, then run existing affected persistent-browser, capture, loading, dialogs, CAPTCHA and offline pipeline E2E tests. Only then publish the updated package/lockfile and this evidence. This investigation does not establish live Lazada compatibility or marketplace-data completeness, and it performed no GitHub writes, account access or active-browser control.

All original metadata, audit reports and test fixtures/logs are saved as gzip files. Decompressing them preserves their original bytes; report SHA-256 values identify those uncompressed originals, with separate compressed digests in the artifact manifest. The functional fixtures are evidence snapshots, not automatically registered repository tests.
