import type {
  LazadaSearch,
  Product,
  Offer,
  BasketSourceMapping,
  FoodComponent,
} from './index.js';

/** Draft contracts: implementation and genuine-source acceptance are deferred. */
export type DraftRecord = Record<string, unknown>;
export type CaseStage =
  | 'discovery'
  | 'handpicked'
  | 'listing'
  | 'sku'
  | 'inventory'
  | 'manufacturer'
  | 'translation'
  | 'delivery'
  | 'checkout'
  | 'manual-review'
  | 'recollection'
  | 'report';
export type CaseTaskState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'blocked'
  | 'unavailable'
  | 'superseded';
export interface HandpickedLinkInput {
  submittedUrl: string;
  resolvedUrl?: string;
  sku?: string;
}
export interface CaseWorkflowPlan {
  queries?: string[];
  categoryUrls?: string[];
  quantities?: number[];
  deliveryArea?: string;
  handpicked?: Array<string | HandpickedLinkInput>;
  maxAttempts?: number;
  maxPlannedTasks?: number;
  maxPriceAgeMs?: number;
  recollectAfterInitialPass?: boolean;
}
export interface CaseWorkflowTask extends DraftRecord {
  id: string;
  workflowId: string;
  stage: CaseStage;
  input: DraftRecord;
  status: CaseTaskState;
  attempts: number;
  reason: string;
}
export interface CaseWorkflowStatus extends DraftRecord {
  workflow: DraftRecord;
  tasks: CaseWorkflowTask[];
  counts: Partial<Record<CaseTaskState, number>>;
  allRequirementsDelivered: false;
  allTargetProductsCollected: false;
  productionReady: false;
  purchaseReady: false;
  codeValidation: 'draft-untested';
}
export interface ManufacturerSearchRequest {
  queries: string[];
  domains: string[];
  maxResults?: number;
  signal?: AbortSignal;
}
export interface ManufacturerSearchProvider {
  id: string;
  origin: string;
  version?: string;
  cacheOnly?: boolean;
  configurationSha256?: string;
  search(request: ManufacturerSearchRequest): Promise<unknown>;
}
export interface ManufacturerSearchConfiguration {
  id?: string;
  version?: string;
  origin?: string;
  endpoint?: string;
  cacheOnly?: boolean;
  method?: 'POST';
  tokenEnv?: string;
  tokenHeader?: string;
  tokenPrefix?: string;
  rowsPath?: string;
  urlPath?: string;
  titlePath?: string;
  queriesField?: string;
  domainsField?: string;
  limitField?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxResults?: number;
  intervalMs?: number;
}
export interface ManufacturerWorkflowOptions {
  productIds?: string[];
  categories?: string[];
  id?: string;
  maxProducts?: number;
  maxSourcesPerProduct?: number;
  maxLabelsPerPage?: number;
  maxTotalTasks?: number;
  maxAttempts?: number;
  retryFailed?: boolean;
  now?: () => number;
}
export interface ManufacturerWorkflowRunOptions {
  allowNetwork?: boolean;
  maxTasks?: number;
  searchProvider?: ManufacturerSearchProvider;
  factExtractor?: (input: DraftRecord) => unknown | Promise<unknown>;
  signal?: AbortSignal;
  retryBlocked?: boolean;
  recoverInterrupted?: boolean;
  ocrPasses?: number;
}
export interface CaseWorkflowRunOptions extends ManufacturerWorkflowRunOptions {
  manufacturerBatchSize?: number;
  translationBatchSize?: number;
  preparedCheckouts?: Record<string, PreparedCheckoutInput>;
  /** Trusted local library/CLI configuration; rejected in HTTP/Telegram JSON. */
  searchConfiguration?: ManufacturerSearchConfiguration;
}
export interface CheckoutAttributeField {
  selector: string;
  attribute: string;
}
export interface CheckoutSelectionBinding {
  selector: string;
  attribute: 'checked' | 'aria-checked' | 'data-selected';
}
export type CheckoutIdentityBinding =
  | {
      kind: 'attributes';
      rowSelector: string;
      itemId: CheckoutAttributeField;
      skuId: CheckoutAttributeField;
      selection: CheckoutSelectionBinding;
    }
  | {
      kind: 'embedded-json';
      rowSelector: string;
      scriptSelector: string;
      rowsPointer: string;
      rowIndex: number;
      itemIdPointer: string;
      skuIdPointer: string;
      rowKeyPointer: string;
      rowKeyAttribute: string;
      selection: CheckoutSelectionBinding;
    };
export type CheckoutQuantityBinding =
  | { selector: string; attribute: 'value' | 'data-quantity' }
  | { kind: 'embedded-json'; pointer: string };
export interface CheckoutJsonValueBinding {
  kind: 'embedded-json';
  pointer: string;
}
export interface CheckoutMappedLine {
  offerId: string;
  sku: string;
  quantity: number;
  selectors: {
    sku?: string;
    quantity?: string;
    unitPrice: string;
    subtotal: string;
    stock?: string;
    availability?: string;
    eligibility?: string;
  };
  identityBinding?: CheckoutIdentityBinding;
  quantityBinding?: CheckoutQuantityBinding;
  stockBinding?: CheckoutJsonValueBinding;
  availabilityBinding?: CheckoutJsonValueBinding;
  eligibilityBinding?: CheckoutJsonValueBinding;
}
export interface LazadaCheckoutLayout extends DraftRecord {
  id: string;
  reviewed: true;
  reviewedBy: string;
  reviewedAt: string;
  selectors: {
    destination: string;
    shipping: string;
    total: string;
    paymentMethod: string;
    voucherState: string;
    coldChain?: string;
  };
  lines: CheckoutMappedLine[];
  appliedDiscounts?: BasketSourceMapping['appliedDiscounts'];
  state?: DraftRecord;
  actionBindings?: {
    quantityInputs?: Array<{ offerId: string; sku: string; selector: string }>;
    vouchers?: Array<{
      id: string;
      selector: string;
      identityAttribute: string;
      identityValue: string;
    }>;
    payments?: Array<{
      text: string;
      selector: string;
      identityAttribute: string;
      identityValue: string;
    }>;
  };
}
export interface CheckoutOriginalMetadata {
  sourceUrl: string;
  sourceSha256: string;
  observedAt: string;
  evidenceId: string;
  market: 'vn';
  currency: 'VND';
  deliveryArea: string;
}
export interface PreparedCheckoutInput {
  layout: LazadaCheckoutLayout;
  deliveryArea: string;
  readiness?: { timeoutMs?: number; stableMs?: number };
}
export interface CheckoutSnapshotInput {
  html: string | Uint8Array;
  layout: LazadaCheckoutLayout;
  metadata: CheckoutOriginalMetadata;
}
export interface CheckoutAdapterObservation extends DraftRecord {
  id: string;
  status: 'mapping-ready' | 'needs-review';
  quoteId?: string;
  mapping: BasketSourceMapping | null;
  visibility: 'private';
  gaps: DraftRecord[];
}
export interface PreparedCheckoutScenarioInput {
  planId: string;
  scenarioId: string;
  layout: LazadaCheckoutLayout;
  allowCartChanges: true;
  intervalMs?: number;
}
export interface PreparedCheckoutSweepInput {
  planId: string;
  scenarioIds?: string[];
  maxScenarios?: number;
  layout: LazadaCheckoutLayout;
  allowCartChanges?: boolean;
  intervalMs?: number;
}
export interface CheckoutFoodGiftMapping {
  offerId: string;
  sku: string;
  selector: string;
}
export interface CaseInventoryMapping {
  rowsPointer: string;
  urlPointer: string;
  skuPointer: string;
  reportedTotalPointer: string;
  terminalPointer: string;
  terminalValue: null | false | 0 | '';
}
export interface CaseInventoryInput {
  evidenceId: string;
  sourceSha256: string;
  scope: string;
  reviewedBy: string;
  mapping: CaseInventoryMapping;
}
export interface CaseManualReviewInput {
  reviewedBy: string;
  reason: string;
  scope: string;
  scopeFingerprint: string;
  evidence: Array<{ evidenceId: string; sourceSha256: string }>;
  exactPriceExtractionReviewed?: boolean;
  quantityExtractionReviewed?: boolean;
  classificationReviewed?: boolean;
  listPaginationReviewed?: boolean;
}
export interface CaseCoverageOptions {
  inventoryId?: string;
  manualReviewId?: string;
}
export interface ShoppingReportOptions {
  quantity?: number;
  quantities?: number[];
  deliveryArea?: string;
  limit?: number;
  allowStale?: boolean;
  handpicked?: Array<string | HandpickedLinkInput>;
}
export interface ShoppingReport extends DraftRecord {
  schemaVersion: number;
  kind: 'shopping-report';
  generatedAt: string;
  market: string;
  currency: string;
  deliveryArea: string;
  reports: DraftRecord[];
  baskets: DraftRecord[];
  basketCoverage: DraftRecord;
  codeValidation: 'draft-untested';
  allTargetProductsCollected: false;
  allRequirementsDelivered: false;
  purchaseReady: false;
}
export declare function planCaseWorkflow(
  application: LazadaSearch,
  input?: CaseWorkflowPlan
): Promise<CaseWorkflowStatus>;
export declare function runCaseWorkflow(
  application: LazadaSearch,
  workflowId: string,
  options?: CaseWorkflowRunOptions
): Promise<CaseWorkflowStatus & { executed: number; reportId: string }>;
export declare function caseWorkflowStatus(
  application: LazadaSearch,
  workflowId: string
): Promise<CaseWorkflowStatus>;
export declare function scopedCaseAudit(
  application: LazadaSearch,
  definition: DraftRecord
): Promise<DraftRecord>;
export declare function refreshCaseWorklist(
  application: LazadaSearch,
  workflow: DraftRecord
): Promise<DraftRecord>;
export declare function scopeAccountAudit(
  audit: DraftRecord,
  options?: DraftRecord
): DraftRecord;
export declare function createManufacturerSearchProvider(
  application: LazadaSearch,
  configuration: ManufacturerSearchConfiguration
): ManufacturerSearchProvider;
export declare function planManufacturerWorkflow(
  application: LazadaSearch,
  options?: ManufacturerWorkflowOptions
): Promise<DraftRecord>;
export declare function runManufacturerWorkflow(
  application: LazadaSearch,
  workflowId: string,
  options?: ManufacturerWorkflowRunOptions
): Promise<DraftRecord>;
export declare function manufacturerWorkflowStatus(
  application: LazadaSearch,
  workflowId: string
): Promise<DraftRecord>;
export declare function buildLabelWorklist(
  application: LazadaSearch,
  options?: ManufacturerWorkflowOptions
): Promise<DraftRecord>;
export declare function discoverLazadaCheckoutSnapshot(
  html: string | Uint8Array,
  metadata: CheckoutOriginalMetadata,
  options?: { layout?: LazadaCheckoutLayout; offers?: Offer[] }
): DraftRecord;
export declare function importLazadaCheckoutSnapshot(
  application: LazadaSearch,
  input: CheckoutSnapshotInput
): Promise<CheckoutAdapterObservation>;
export declare function lazadaCheckoutAdapterStatus(
  application: LazadaSearch,
  options?: { observationId?: string }
): Promise<DraftRecord>;
export declare function capturePreparedLazadaCheckout(
  application: LazadaSearch,
  input: PreparedCheckoutInput
): Promise<CheckoutAdapterObservation>;
export declare function prepareLazadaCheckoutScenario(
  application: LazadaSearch,
  input: PreparedCheckoutScenarioInput
): Promise<DraftRecord>;
export declare function runPreparedLazadaCheckoutScenarios(
  application: LazadaSearch,
  input: PreparedCheckoutSweepInput
): Promise<DraftRecord>;
export declare function discoverLazadaCheckoutFoodGifts(
  html: string | Uint8Array,
  mapping: BasketSourceMapping,
  options?: {
    giftMappings?: CheckoutFoodGiftMapping[];
    products?: Product[];
    offers?: Offer[];
  }
): DraftRecord[];
export declare function importLazadaCheckoutFoodGiftDiscovery(
  application: LazadaSearch,
  input: { observationId: string; giftMappings: CheckoutFoodGiftMapping[] }
): Promise<DraftRecord>;
export declare function acquireLazadaCheckoutFoodGifts(
  application: LazadaSearch,
  input: {
    observationId: string;
    offerId: string;
    components: FoodComponent[];
    reviewedBy: string;
    maxPromotionAgeMs?: number;
  }
): Promise<DraftRecord>;
export declare function registerHandpickedLinks(
  application: LazadaSearch,
  input?: { links?: Array<string | HandpickedLinkInput> }
): Promise<DraftRecord>;
export declare function resolveHandpickedLinks(
  application: LazadaSearch,
  options?: { linkIds?: string[]; limit?: number; allowNetwork?: boolean }
): Promise<DraftRecord>;
export declare function handpickedLinkStatus(
  application: LazadaSearch
): Promise<DraftRecord>;
export declare function importCaseInventoryManifest(
  application: LazadaSearch,
  input: CaseInventoryInput
): Promise<DraftRecord>;
export declare function recordCaseManualReview(
  application: LazadaSearch,
  input: CaseManualReviewInput
): Promise<DraftRecord>;
export declare function verifyCaseInventory(
  application: LazadaSearch,
  input: { inventoryId: string }
): Promise<DraftRecord>;
export declare function caseCoverageStatus(
  application: LazadaSearch,
  input?: CaseCoverageOptions
): Promise<DraftRecord>;
export declare function buildShoppingReport(
  application: LazadaSearch,
  options?: ShoppingReportOptions
): Promise<ShoppingReport>;
export declare function saveShoppingReport(
  application: LazadaSearch,
  report: ShoppingReport
): Promise<DraftRecord>;
export declare function shoppingReportMarkdown(report: ShoppingReport): string;
export declare function shoppingCategory(product: Product): string;
export declare const SHOPPING_METRICS: readonly string[];
export declare const REQUIREMENT_GITHUB_ISSUES: readonly DraftRecord[];
export declare const REQUIREMENT_REGISTRY: readonly DraftRecord[];
export declare function requirementDraftStatus(): DraftRecord;
export declare function caseReadiness(
  application: LazadaSearch,
  options?: CaseCoverageOptions & { quantity?: number }
): Promise<DraftRecord>;
