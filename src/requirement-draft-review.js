// Executable requirement coverage; live data and owner acceptance remain deferred.
export const REQUIREMENT_DRAFT_REVIEW = {
  R001: {
    reviewedDraftBehavior:
      'Case definitions fix Vietnam/VND; destination and quantity are part of exact quote validation. A one-unit or other-city quote cannot price bulk Nha Trang delivery.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/delivery-context.test.js',
      'tests/e2e/delivery.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R002: {
    reviewedDraftBehavior:
      'Detailed task and report gates use the selected plain/chocolate whey identity. Unknown options remain pending; vanilla, known soy and shaker options cannot enter target work or ranks.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/variant-policy.test.js',
      'tests/e2e/preferred-variant.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/case-worklist.js',
      'src/shopping-report.js',
      'src/lazada-checkout-actions.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R003: {
    reviewedDraftBehavior:
      'Strict chocolate-core ice cream is checked independently of coatings, mixed flavours and non-frozen bars; conflicting details reopen category review.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/human-food-scope.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/case-coverage.js',
      'src/shopping-report.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R004: {
    reviewedDraftBehavior:
      'Selected paid-shaker options are excluded before detail work, mutation and ranking. Accessories never become food mass or volume.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/variant-policy.test.js',
      'tests/e2e/preferred-variant.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/lazada-checkout-actions.js',
      'src/shopping-report.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R005: {
    reviewedDraftBehavior:
      'The durable task queue places uncompleted list scopes ahead of product detail work; configured terminal scopes must be accounted for first.',
    testDraftFiles: [
      'tests/page-readiness-tag.test.js',
      'tests/e2e/tag-search-readiness.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/category-discovery.test.js',
      'tests/e2e/category-discovery.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R006: {
    reviewedDraftBehavior:
      'Relevant category/query scopes and ascending price order are retained; category redirects and scope ambiguities remain explicit and cannot certify marketplace completeness.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/category-discovery.test.js',
      'tests/category-coverage.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R007: {
    reviewedDraftBehavior:
      'Case definitions reject package-price cutoffs, preserving potentially cheaper large packages and bulk baskets.',
    testDraftFiles: [
      'tests/page-readiness-tag.test.js',
      'tests/e2e/tag-search-readiness.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/category-discovery.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R008: {
    reviewedDraftBehavior:
      'Listing and exact SKU inventory rows are durable and original-bound. A full composed item/SKU identifier is checked; unresolved inventory/classification blocks completeness.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/category-coverage.test.js',
    ],
    additionalDraftSourceFiles: ['src/case-coverage.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R009: {
    reviewedDraftBehavior:
      'Readiness and selected-SKU proof precede pricing; checkout row bindings preserve original item, SKU, quantity, stock and source SHA without rewriting HTML.',
    testDraftFiles: [
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/e2e/page-loading.test.js',
    ],
    additionalDraftSourceFiles: ['src/lazada-checkout-line-bindings.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R010: {
    reviewedDraftBehavior:
      'Source-bound sale/list prices, thresholds, voucher/payment conditions and exact applied discounts are retained. Prepared scenario controls do not infer eligibility or submit purchases.',
    testDraftFiles: [
      'tests/lazada-checkout-draft.test.js',
      'tests/promotions.test.js',
      'tests/e2e/checkout-scenarios.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R011: {
    reviewedDraftBehavior:
      'Both independently supported grams and millilitres appear together. All six food/protein unit metrics use exact counts and matched destination/quantity freight; disputed inputs withhold affected rates.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/basket-quotes.test.js',
      'tests/e2e/ice-quantity-review.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R012: {
    reviewedDraftBehavior:
      'Immutable scenario plans compare exact basket totals. Shipping and discounts are counted once; one-item bulk quotes enter delivered ranks and mixed-basket totals remain separate.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/checkout-scenarios.test.js',
      'tests/e2e/basket-quotes.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R013: {
    reviewedDraftBehavior:
      'Frozen destination eligibility remains an independent acceptance gate. Ordinary parcel shipping and other-city ice offers cannot supply a Nha Trang delivered winner.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/delivery-context.test.js',
      'tests/e2e/delivery.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R014: {
    reviewedDraftBehavior:
      'Factory worklists discover trusted official originals and labels; structured facts require literal identity/revision/currentness. A preview and explicit human review can apply exact verified sources to the catalog.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/manufacturer-research.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/manufacturer-source-validity.js',
      'src/source-invalidation.js',
      'src/manufacturer-workflow-review.js',
      'src/ocr-evidence.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R015: {
    reviewedDraftBehavior:
      'The review bridge stages original-bound identity/quantity/nutrition reconciliation before publishing corrected product fields, retains seller claims and leaves actual offer prices unchanged.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/manufacturer-workflow-draft.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/manufacturer-source-validity.js',
      'src/source-invalidation.js',
      'src/manufacturer-workflow-review.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R016: {
    reviewedDraftBehavior:
      'Persisted OCR, original/derived image bytes, transform recipe, TSV words/confidence and model provenance are checked together before any proposed fact is accepted.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/ocr-crops.test.js',
      'tests/e2e/ice-quantity-review.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/ocr-evidence.js',
      'src/manufacturer-workflow-review.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R017: {
    reviewedDraftBehavior:
      'Translation work remains source-bound and cached. Shopping rows retain reviewed English and original Vietnamese for title, description/specifications and commercial fields; stale title bindings fall back to originals.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/translation-quality.test.js',
      'tests/e2e/translation-catalog.test.js',
    ],
    additionalDraftSourceFiles: ['src/shopping-report.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R018: {
    reviewedDraftBehavior:
      'Per-card manual decisions bind the current card fingerprint and original source SHA. Aggregate review flags cannot waive unknown/conflicting details; a current stored review is consumable by the runner.',
    testDraftFiles: [
      'tests/requirement-coverage.test.js',
      'tests/case-workflow-draft.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/case-coverage.js',
      'src/case-workflow.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R019: {
    reviewedDraftBehavior:
      'New workflow/review records use the existing canonical .lino, binary associative links and content-addressed blob store, retaining semantic evidence/source relationships.',
    testDraftFiles: [
      'tests/blob-publication.test.js',
      'tests/archive.test.js',
      'tests/links-workflow.test.js',
      'tests/e2e/native-store.test.js',
    ],
    additionalDraftSourceFiles: ['docs/architecture.md', 'README.md'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R020: {
    reviewedDraftBehavior:
      'Source/evidence/cache-ID invalidations prevent reuse; search result limits participate in cache keys. Missing work is distinct from deferred recollection and volatile offer revalidation.',
    testDraftFiles: [
      'tests/blob-publication.test.js',
      'tests/manufacturer-source-validity.test.js',
      'tests/handpicked-links.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/publication-cache.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/manufacturer-source-validity.js',
      'src/source-invalidation.js',
      'src/manufacturer-workflow-facts.js',
      'src/label-worklist.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R021: {
    reviewedDraftBehavior:
      'Public sources can feed private workflows through exact verified originals; private checkout visibility and credentials remain separate. OCR metadata does not replace physical source proof.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/account-cache.test.js',
      'tests/e2e/archive.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R022: {
    reviewedDraftBehavior:
      'Public source bytes, records, notation and binary archives remain reproducible; new synthetic test data is separate from real buying evidence. Private originals are never wholesale published.',
    testDraftFiles: [
      'tests/archive-telemetry-redaction.test.js',
      'tests/archive-provenance.test.js',
      'tests/public-cache.test.js',
      'tests/e2e/archive.test.js',
    ],
    additionalDraftSourceFiles: [
      'tests/fixtures/draft-workflows/products.json',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R023: {
    reviewedDraftBehavior:
      'New review preview/approval, case, checkout and report operations are wired through application methods, exports, declarations and the shared CLI/HTTP dispatcher.',
    testDraftFiles: [
      'tests/lazada-checkout-gifts.test.js',
      'tests/public-api-typecheck.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/fixtures/public-api-types.ts',
    ],
    additionalDraftSourceFiles: [
      'src/manufacturer-workflow-review.js',
      'src/index.d.ts',
      'src/workflow-types.d.ts',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R024: {
    reviewedDraftBehavior:
      'Allowlisted private Telegram uses the same operation dispatcher; new E2E drafts compare report values and workflow status with library/CLI/HTTP and check chunking/authorization.',
    testDraftFiles: [
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/e2e/telegram.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R025: {
    reviewedDraftBehavior:
      'Existing separate-profile login supports Zalo first and SMS alternatives, while user-held OTP and current authenticated state remain explicit operator inputs.',
    testDraftFiles: [
      'tests/e2e/account-login.test.js',
      'tests/browser-connection.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [
      'Operator supplies current OTP if required; codes and profile credentials stay private.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R026: {
    reviewedDraftBehavior:
      'Collectors and prepared checkout requests retain global challenge/dialog/loading gates and slow scheduling. Actions verify the current original control and selected SKU before each change.',
    testDraftFiles: [
      'tests/browser-pacing.test.js',
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/image-redirect-pacing.test.js',
      'tests/e2e/dialog-variant.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R027: {
    reviewedDraftBehavior:
      'Known disclosure is interpreted as wishing to learn, which satisfies its second alternative without asserting healthcare-worker status; unknown dialogs stop for review.',
    testDraftFiles: ['tests/e2e/dialog-variant.test.js'],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R028: {
    reviewedDraftBehavior:
      'Owned windows preserve the exact detected challenge target through cleanup, timeouts, idle and supervisor recovery. Read-only status never launches. Resume reconnects the original target only; ordinary 30-minute idle closure applies after explicit clearance.',
    testDraftFiles: [
      'tests/browser-challenge-handoff.test.js',
      'tests/browser-connection.test.js',
      'tests/e2e/challenge-window-retention.test.js',
      'tests/browser-pacing.test.js',
      'tests/e2e/persistent-window.test.js',
      'tests/e2e/persistent-window-recovery.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R029: {
    reviewedDraftBehavior:
      'Dedicated-profile launch settings suppress restore/translation obstruction and preserve ownership boundaries for attached browsers. Upstream obstruction reports retain their receipts.',
    testDraftFiles: [
      'tests/browser-connection.test.js',
      'tests/e2e/persistent-window.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [
      'Verify the visible owned-browser chrome during later live acceptance; report a reproduced unresolved obstruction upstream after checking existing issues.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R030: {
    reviewedDraftBehavior:
      'Catalog scroll geometry remains bounded to products/pager; checkout control positioning uses the existing animation helper with a 650 ms animation.',
    testDraftFiles: [
      'tests/e2e/page-scroll.test.js',
      'tests/workflow-reliability.test.js',
    ],
    additionalDraftSourceFiles: ['src/lazada-checkout-actions.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R031: {
    reviewedDraftBehavior:
      'Prepared capture uses existing viewport screenshot paths and stable page checks, avoiding full-page resizing and retaining capture geometry.',
    testDraftFiles: [
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/page-capture.test.js',
      'tests/e2e/page-scroll.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R032: {
    reviewedDraftBehavior:
      'All 42 project GitHub issues are reconciled with the current snapshot. Browser Commander interruption ownership is reported upstream as issue174, with its consumer workaround and actual native regression evidence retained.',
    testDraftFiles: [],
    additionalDraftSourceFiles: [
      'docs/drafts/github-issues-review.json',
      'docs/acceptance/issue-reports.json',
    ],
    operatorSteps: [
      'Root or maintainer verifies a reproduced dependency defect in the respective upstream repository, checks for an existing report, then files or updates a source-backed report. Static-only drafting does not claim a new runtime defect was reproduced.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance:
      'operator-procedure-recorded-external-execution-pending',
  },
  R033: {
    reviewedDraftBehavior:
      'The official registry/release check found Browser Commander0.31.2, and npm/lock dependencies were updated. Focused and full runtime/native acceptance must use that exact reviewed graph.',
    testDraftFiles: [
      'tests/runtime-workflow.test.js',
      'tests/package-metadata.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [
      'Root checks official releases before the next collection session; when newer, updates package/lock graphs and records new acceptance before release.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R034: {
    reviewedDraftBehavior:
      'This review used two delegated agents and root implementation work; the limit remains an operator constraint, not an application readiness claim.',
    testDraftFiles: [],
    additionalDraftSourceFiles: [],
    operatorSteps: [
      'Root keeps at most two delegated agents active and also performs implementation/review work.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance:
      'operator-procedure-recorded-external-execution-pending',
  },
  R035: {
    reviewedDraftBehavior:
      'The report renderer publishes separate captured, manufacturer-verified and qualified ranks for every independent denominator; it exposes top-ten shortfalls explicitly.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/deadline-report.test.js',
    ],
    additionalDraftSourceFiles: ['src/shopping-report.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R036: {
    reviewedDraftBehavior:
      'New code, meaningful test drafts, synthetic fixture, review receipts and roadmap are included in the draft branch publication; accepted public archives and historical tables remain retained.',
    testDraftFiles: [
      'tests/collection-checkpoint.test.js',
      'tests/publish-retry.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [
      'Root commits and pushes this reviewed draft checkpoint, then verifies local and remote branch identity; do not merge unexecuted drafts into the accepted release.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R037: {
    reviewedDraftBehavior:
      'Readiness distinguishes accepted software mechanics from missing production and all-market data; current source-bound inventory/manual review and real-layout acceptance remain mandatory.',
    testDraftFiles: [
      'tests/requirement-audit-gates.test.js',
      'tests/requirement-coverage.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/e2e/verified-case.test.js',
    ],
    additionalDraftSourceFiles: [
      'docs/drafts/acceptance-plan.md',
      'scripts/requirement-audit-gates.mjs',
      'scripts/audit-case-requirements.mjs',
    ],
    operatorSteps: [
      'Preserve completed source171b250 automated acceptance; complete current original-layout/inventory/specs/English/discounts/exact freight and live bot acceptance. Package owner configures npm trusted publishing for issue 32 before release.',
    ],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R038: {
    reviewedDraftBehavior:
      'Ice report rows keep independent grams/ml/protein quantities and all corresponding before/after rates, while label tasks seek missing units. No density is fabricated.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/ice-unit-rankings.test.js',
    ],
    additionalDraftSourceFiles: ['src/manufacturer-workflow-review.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R039: {
    reviewedDraftBehavior:
      'Whey, soy and mixed proteins have distinct ranking lanes; cheap soy and vanilla cannot displace plain/chocolate whey.',
    testDraftFiles: [
      'tests/shopping-workflow-draft.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/report-unit-costs.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R040: {
    reviewedDraftBehavior:
      'Submitted links are retained distinctly, resolved only against intact source bytes and displayed by gram cost; exact SKU and listing membership counts are separate.',
    testDraftFiles: [
      'tests/handpicked-links.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/handpicked-report.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R041: {
    reviewedDraftBehavior:
      'A persisted global collection stop blocks all new website requests, including factory/images and prepared checkout. Offline reports and planning never clear that stop.',
    testDraftFiles: [
      'tests/browser-challenge-handoff.test.js',
      'tests/e2e/challenge-window-retention.test.js',
      'tests/handpicked-links.test.js',
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/lazada-checkout-draft.test.js',
      'tests/e2e/captcha-stop.test.js',
    ],
    additionalDraftSourceFiles: ['src/browser-challenge-handoff.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R042: {
    reviewedDraftBehavior:
      'Missing-first work remains durable and bounded; interrupted tasks/locks/failures are retained, old recollection is deferred, and a valid manual review can finish its task.',
    testDraftFiles: [
      'tests/e2e/draft-workflow-interfaces.test.js',
      'tests/case-workflow-draft.test.js',
      'tests/account-backlog-order.test.js',
      'tests/account-collection-attempts.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R043: {
    reviewedDraftBehavior:
      'Factory facts include protein type, source ingredients, nutrient basis and identity; shopping rows expose these factual components. Partial correction leaves still-missing nutrition/ingredients scheduled.',
    testDraftFiles: [
      'tests/manufacturer-workflow-draft.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/urgent-ingredients.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/manufacturer-workflow-review.js',
      'src/case-worklist.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R044: {
    reviewedDraftBehavior:
      'Every observed nonmatching result is retained with its original card/source. Reviewed exclusions affect both task planning and report ranks, and changed originals revoke them.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/scope-decisions.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/case-coverage.js',
      'src/shopping-report.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R045: {
    reviewedDraftBehavior:
      'Confirmed source-bound removed listings remain per-item queue outcomes and cannot retain current ranks; later valid observations reopen work. Blank, login and challenge pages do not prove removal.',
    testDraftFiles: [
      'tests/case-workflow-draft.test.js',
      'tests/removed-product.test.js',
      'tests/availability.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R046: {
    reviewedDraftBehavior:
      'Disputed mass, count, artwork and OCR identities withhold derived denominators. Factory review requires exact current flavour/package/formula and original-bound evidence before releasing holds.',
    testDraftFiles: [
      'tests/manufacturer-workflow-draft.test.js',
      'tests/shopping-workflow-draft.test.js',
      'tests/package-mass-quarantine.test.js',
    ],
    additionalDraftSourceFiles: [
      'src/ocr-evidence.js',
      'src/manufacturer-workflow-review.js',
    ],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R047: {
    reviewedDraftBehavior:
      'Gift discovery produces review work; only confirmed exact food quantity/nutrition/allocation/eligibility changes denominators. Paid multipacks, bonuses and non-food gifts remain separate.',
    testDraftFiles: [
      'tests/lazada-checkout-gifts.test.js',
      'tests/e2e/prepared-checkout-adapter.test.js',
      'tests/food-components.test.js',
      'tests/food-component-evidence.test.js',
      'tests/food-component-persistence.test.js',
      'tests/bonus-paid-mass-hold.test.js',
    ],
    additionalDraftSourceFiles: [],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R048: {
    reviewedDraftBehavior:
      'Native model provenance fingerprints actual model bytes; transformed OCR verifies persisted renderer/crop/source-pass/TSV proofs without relabelling derived pixels as original.',
    testDraftFiles: [
      'tests/manufacturer-source-validity.test.js',
      'tests/ocr-models.test.js',
      'tests/manufacturer-workflow-draft.test.js',
      'tests/ocr-crops.test.js',
    ],
    additionalDraftSourceFiles: ['src/ocr-evidence.js'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
  R049: {
    reviewedDraftBehavior:
      'Documentation publication retains offline repository-link/source-digest checks; neither the audit nor CI probes source websites during the active challenge stop.',
    testDraftFiles: [
      'tests/recheck-broken-links.test.js',
      'tests/ci-workflow-policy.test.js',
    ],
    additionalDraftSourceFiles: ['.github/workflows/links.yml'],
    operatorSteps: [],
    draftReviewStatus: 'statically-reviewed-draft',
    functionalAcceptance: 'local-regressions-passed-live-acceptance-pending',
  },
};
