# Automated workflow acceptance

The resumed draft now has actual local automated acceptance. All **49 recorded requirements** retain code plus executable regression/type/E2E references or a concrete external operator procedure. [The registry](../../drafts/requirements.json) and [automated traceability test](../../../tests/requirement-coverage.test.js) keep missing files, untracked issues and unwired test manifests visible. Tests do not turn uncollected market data or owner actions into completed requirements.

| Check                                          | Actual result                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Complete Node 22.23.0 unit manifest            | 1,436 passed; zero failures, cancellations or skips                                    |
| Complete Bun 1.4.3 unit manifest               | 1,436 passed; zero failures                                                            |
| Complete Deno 2.9.7 frozen/cache-only manifest | 1,281 passed and 16 steps; zero failures                                               |
| Browser/OCR/CLI/Telegram/native store E2E      | 67 existing cases plus one new actual Chromium checkout case; all 68 unique cases pass |
| Native English + Vietnamese pipeline           | Passed with both existing cached models; no model downloads                            |
| Strict public API declarations                 | Passed with locked TypeScript, Node and fetch types                                    |
| Manufacturer/source/OCR targeted regressions   | 112 passed each on Node, Bun and frozen Deno 2.4.5                                     |
| Expanded case/checkout regressions             | 45 passed each on Node/Bun/Deno; 143 combined existing Node regressions pass           |

[Machine-readable receipt and source hashes](validation.json) · [manufacturer acceptance](manufacturer/README.md) · [case/checkout acceptance](checkout/README.md). Complete logs, including initial failures, remain under [root](root/). GitHub validation of this source checkpoint is recorded separately; historical green CI does not validate new commits.

## Fixes established by tests

The resumed tests repaired wrong-flavour single-item checkout ranking; original literal quantity/unit validation and conflicting factory JSON identity; selected-row quantity/stock/eligibility binding; loading and superseded-offer rejection; destination revalidation before mutation; current manual/inventory/removal fingerprints; serialized dead-owner lock recovery; Windows CRLF report auditing; early-timer persistent pacing; and Deno’s explicit file-read overload. Legacy OCR tests now import complete original receipts and compare their text/confidence/words to raw TSV.

The CI compilation gate now installs locked type-check dependencies and checks actual public library/workflow declarations for all relevant code changes, including type-only changes and explicit instant-release validation. Deno’s manifest and canonical lock serialization are reconciled without fresh dependency resolution. Chromium fixture tests intercept every page request, retain private original quotes, preserve viewport geometry, and reject changed live properties, dialogs and fake CAPTCHA without accepting another quote.

## Execution and limits

Local commands use `npm test`, `bun test --parallel=2 --no-orphans --timeout 450000 ./tests/*.test.js`, the exact frozen/cache-only/localhost-only Deno CI manifest, `npm run test:e2e` with verified Rust clink, and `npm run test:types`. The new checkout browser test and bilingual native pipeline are accepted separately from the earlier complete E2E manifest; their union covers every current E2E file. Old system Deno failures and the one concurrent-host release-descendant precondition failure are retained in the receipt. No assertion was relaxed or fixture truncated to obtain a pass.

The actual main CI baseline had Windows ice audit failures caused by CRLF parsing, a persistent-window pacing failure, and a refused npm OIDC preflight. The first two causes have guarded regression fixes. npm trusted publishing remains an owner configuration requirement under issue 32; no credential/release guard was bypassed. [Original CI outcomes](root/ci-baseline.json) and masked logs are retained.

The saved manufacturer CAPTCHA stop remains active. No Lazada, manufacturer or image/CDN collection occurred, no actual account/profile or public buying archive was changed, and old buying reports were not refreshed. Complete live source/provider/layout/English/freight/promotion/bot acceptance remains in [the acceptance plan](../../drafts/acceptance-plan.md). Production/purchase/all-market/all-requirements flags remain false.

The [fixture-helper follow-up](root/manufacturer-helper-followup.json) removes the architecture warning without changing production code. All 40 manufacturer workflow cases pass again on Node/Bun/current frozen Deno after the move.

The [first PR CI follow-up](root/ci-configuration-followup.json) records successful native E2E on `a0f9131`, the rejected three-changeset PR, and the disabled dependency graph. The PR changesets are consolidated and repository dependency graph/Dependabot alerts are enabled. The dependency-review severity gate remains enforced; a new exact-head run verifies the repairs.
