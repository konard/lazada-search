import type { Bot } from 'grammy';
import type { Server } from 'node:http';
export type Category =
  | 'whey'
  | 'protein-powder'
  | 'chocolate-ice-cream'
  | 'unknown';
export declare function categoryOf(title: string): Category;
export declare function massGrams(value: string): number | undefined;
export declare function packCountOf(value: string): number | undefined;
export declare function volumeMillilitres(value: string): number | undefined;
export declare function captureDelivery(
  collector: BrowserCollector,
  url: string,
  options: { province: string; locality: string; refresh?: boolean }
): Promise<Record<string, unknown>>;
export type ProteinType =
  | 'isolate'
  | 'concentrate'
  | 'blend'
  | 'hydrolyzed'
  | 'unknown';
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface Claim {
  field: string;
  value: Json;
  evidenceId?: string;
  source: string;
  confidence?: number;
  requiresReview: boolean;
  excerpt?: string;
  reviewedAt?: string;
  sourceEvidenceId?: string;
  reviewedBy?: string;
  reviewId?: string;
}
export interface VariantIdentity {
  brand: string;
  name: string;
  flavour: string;
  netMassG: number;
  packCount: number;
}
export interface ManufacturerReview {
  evidenceId: string;
  listingEvidenceId: string;
  identity: { listing: VariantIdentity; manufacturer: VariantIdentity };
  reviewedBy: string;
  reason: string;
  facts: Record<string, { value: Json; evidenceId: string; excerpt: string }>;
}
export interface BrowserCapture {
  url: string;
  html: Uint8Array | string;
  screenshot?: Uint8Array;
  observedAt: string;
}
export interface Product {
  id: string;
  url: string;
  title: string;
  description?: string;
  /** Reviewed English display; original fields remain calculation sources. */
  presentation?: ProductPresentation;
  category: Category;
  market?: string;
  brand?: string;
  sku?: string;
  manufacturerSku?: string;
  gtin?: string;
  specificationsInvalidated?: boolean;
  /** Edible net mass of one inner food package; shipping weight is excluded. */
  netMassG?: number;
  /** Declared volume of one inner food package; never inferred from mass. */
  netVolumeMl?: number;
  /** Number of inner food packages in one selected selling unit. */
  packCount?: number;
  /** An unresolved carton count prevents food and protein unit-price metrics. */
  packageCountUnresolved?: boolean;
  servingMassG?: number;
  proteinPer100g?: number;
  /** Declared protein per 100 ml; no density conversion is implied. */
  proteinPer100ml?: number;
  /** Declared grams of protein in one inner food package. */
  proteinPerPackageG?: number;
  sugarPer100ml?: number;
  fatPer100ml?: number;
  saturatedFatPer100ml?: number;
  kcalPer100ml?: number;
  sugarPer100g?: number;
  fatPer100g?: number;
  saturatedFatPer100g?: number;
  kcalPer100g?: number;
  ingredients?: string[];
  proteinType?: ProteinType;
  ingredientFlags?: Record<string, boolean | null>;
  evidenceIds?: string[];
  claims?: Claim[];
  reviewedFields?: string[];
  pendingSpecificationReview?: string[];
  packageArtworkConflicts?: Array<{
    field: 'netMassG';
    source: 'shared-selected-package-artwork';
    declaredMassG: number;
    candidateMassG: number;
    selectedSku: string;
    sharedCatalogSkuIds: string[];
    imageUrl: string;
    imageSha256: string;
    originalHtmlSha256: string;
    observedAt: string;
    evidenceId: string;
    confidence: number;
    excerpt: string;
    requiresReview: true;
    replacementMassApproved: false;
  }>;
  manufacturerVerification?: {
    identityMatched: boolean;
    sourceAuthority: string;
    evidenceId: string;
    sourceUrl: string;
    identityMethod?: string;
    checkedAt?: string;
    reviewId?: string;
    identity?: VariantIdentity;
  };
  corrections?: Array<{
    field: string;
    previous: Json;
    corrected: Json;
    evidenceId: string;
    sourceUrl: string;
    correctedAt?: string;
    reason: string;
  }>;
  crossChecks?: CrossCheck[];
  warnings?: string[];
  observedAt?: string;
  variants?: Array<{ text?: string; selected?: boolean; sku?: string }>;
  selectedVariant?: Array<{ text?: string; selected?: boolean; sku?: string }>;
  ocrCoverage?: {
    discovered: number;
    attempted: number;
    skipped: number;
    failed: number;
    empty?: number;
    passes?: number;
  };
}
export interface Offer {
  id: string;
  productId: string;
  url: string;
  currency: string;
  price?: number;
  originalPrice?: number;
  saleSavings?: number;
  saleDiscountPercent?: number;
  displayedDiscountPercent?: number;
  promotions?: Array<{
    text: string;
    evidenceId?: string;
    observedAt?: string;
    eligibilityConfirmed: boolean;
  }>;
  market?: string;
  foodComponents?: FoodComponent[];
  presentation?: OfferPresentation;
  priceInvalidated?: boolean;
  shippingInvalidated?: boolean;
  shipping?: number;
  shippingQuantity?: number;
  shippingDestination?: string;
  quoteEvidenceId?: string;
  discount?: number;
  seller?: string;
  sku?: string;
  available?: boolean;
  listingUnavailableAt?: string;
  availabilityEvidenceId?: string;
  availabilitySourceSha256?: string;
  deliveryAvailable?: boolean;
  variantConfirmed?: boolean;
  coldChainConfirmed?: boolean;
  deliveryArea?: string;
  stock?: number;
  minQuantity?: number;
  maxQuantity?: number;
  bulkTiers?: Array<{ minQuantity: number; unitPrice: number }>;
  observedAt: string;
  evidenceId?: string;
  quoteObservedAt?: string;
  priceScope?: string;
  supersededBy?: string;
}
export interface ComparisonOptions {
  flavourScope?: 'all' | 'chocolate-or-unflavoured';
  category?: Category;
  proteinType?: ProteinType;
  quantity?: number;
  currency?: string;
  shipping?: number;
  discount?: number;
  deliveryArea?: string;
  minProtein?: number;
  maxSugar?: number;
  excludeIngredients?: string[];
  maxPriceAgeMs?: number;
  maxPromotionAgeMs?: number;
  market?: string;
  allowStale?: boolean;
  requireShipping?: boolean;
  requireManufacturer?: boolean;
  now?: number;
  sort?:
    | 'costPerProteinG'
    | 'costPerKg'
    | 'totalCost'
    | 'proteinPer100g'
    | 'totalBeforeDelivery'
    | 'totalAfterDelivery'
    | 'costPerGramBeforeDelivery'
    | 'costPerGramAfterDelivery'
    | 'costPerMlBeforeDelivery'
    | 'costPerMlAfterDelivery'
    | 'costPerProteinGramBeforeDelivery'
    | 'costPerProteinGramAfterDelivery'
    | 'costPer25gProteinBeforeDelivery'
    | 'costPer25gProteinAfterDelivery'
    | 'costPerKgBeforeDelivery'
    | 'costPerKgAfterDelivery';
}
export interface Metrics {
  quantity: number;
  currency: string;
  unitPrice?: number;
  shipping: number | null;
  discount: number;
  merchandiseSubtotal: number | null;
  totalBeforeDelivery: number | null;
  totalAfterDelivery: number | null;
  totalCost: number | null;
  totalMassG: number | null;
  totalVolumeMl: number | null;
  totalProteinG: number | null;
  foodComponents: FoodComponentAccounting;
  proteinBasis: 'package' | '100g' | '100ml' | 'components' | null;
  proteinConflict: boolean;
  costPerGramBeforeDelivery: number | null;
  costPerGramAfterDelivery: number | null;
  costPerMlBeforeDelivery: number | null;
  costPerMlAfterDelivery: number | null;
  costPerProteinGramBeforeDelivery: number | null;
  costPerProteinGramAfterDelivery: number | null;
  costPer25gProteinBeforeDelivery: number | null;
  costPer25gProteinAfterDelivery: number | null;
  costPerKgBeforeDelivery: number | null;
  costPerKgAfterDelivery: number | null;
  costPerProteinG: number | null;
  costPer25gProtein: number | null;
  costPerKg: number | null;
  proteinPer100g: number | null;
  proteinPer100kcal: number | null;
  sugarPer25gProtein: number | null;
  priceAgeMs: number;
  shippingKnown: boolean;
  shippingQuantity: number | null;
  shippingDestination: string | null;
}
export interface ComparisonRow {
  observationConflicts?: string[];
  product: Product;
  offer: Offer;
  metrics: Metrics;
  eligible: boolean;
  manufacturerVerified: boolean;
  problems: string[];
}
export interface ComparisonReport {
  duplicateObservations: Array<{
    skuKey: string;
    selectedOfferId: string;
    offerIds: string[];
  }>;
  comparisons: ComparisonRow[];
  observedPrices: ComparisonRow[];
  unsortable: ComparisonRow[];
  ranked: ComparisonRow[];
  excluded: ComparisonRow[];
  bestByCategory: Record<Exclude<Category, 'unknown'>, ComparisonRow | null>;
  assumptions: Record<string, Json>;
  calculatedAt: string;
}

export interface ReviewedFoodSource {
  sourceUrl: string;
  sourceSha256: string;
  evidenceId: string;
  excerpt: string;
  contextExcerpt?: string;
  ocrId?: string;
  reviewedBy: string;
  reviewedAt: string;
  invalidated?: boolean;
}
export interface FoodFact extends ReviewedFoodSource {
  value: number;
  unit: 'g' | 'ml' | 'g/100g' | 'g/100ml' | 'g/package' | 'count';
  basis:
    | 'one-inner-food-package'
    | 'per-100g'
    | 'per-100ml'
    | 'paid-selling-unit'
    | 'inner-food-package';
  valueExcerpt: string;
  unitExcerpt?: string;
  basisExcerpt?: string;
  sourceValue?: number;
  sourceUnit?: 'g' | 'kg' | 'ml' | 'L' | 'count';
}
export interface FoodIdentity {
  brand: string;
  name: string;
  flavour: string;
  market: string;
  packageType: string;
  formulaRevision: string;
  gtin?: string;
  variantCode?: string;
  netMassG?: number;
  netVolumeMl?: number;
  innerPackCount: 1;
  currentFormula: true;
}
export interface BonusEligibility {
  allocationId: string;
  offerId: string;
  sku: string | number;
  orderQuantity: number;
  units: number;
  minOrderQuantity: number;
  maxOrderQuantity: number;
  stockUnits: number;
  maxUnitsPerOrder: number;
  confirmed: boolean;
  available: boolean;
  conditionsComplete: boolean;
  conditionsSatisfied: boolean;
  observedAt: string;
  claims: Partial<
    Record<
      | 'orderQuantity'
      | 'units'
      | 'minOrderQuantity'
      | 'maxOrderQuantity'
      | 'stockUnits'
      | 'maxUnitsPerOrder',
      FoodFact
    >
  >;
}
export type FoodComponent =
  | {
      id: string;
      kind: 'paid-food';
      productId: string;
      unitsPerSellingUnit: number;
    }
  | { id: string; kind: 'non-food'; name?: string }
  | {
      id: string;
      kind: 'bonus-food';
      product?: Product;
      identity?: FoodIdentity;
      sourceIdentity?: FoodIdentity;
      review?: ReviewedFoodSource & { identityMatched: boolean };
      facts?: Partial<
        Record<
          | 'netMassG'
          | 'netVolumeMl'
          | 'proteinPer100g'
          | 'proteinPer100ml'
          | 'proteinPerPackageG',
          FoodFact
        >
      >;
      evidenceIds?: string[];
      eligibility?: BonusEligibility;
      invalidated?: boolean;
      evidenceValidation?: FoodComponentEvidenceValidation;
    };
export interface FoodComponentEvidenceValidation {
  status: 'unconfirmed' | 'originals-validated';
  checkedAt: string;
  reasons: string[];
  sources: Array<{
    path?: string;
    field?: string;
    evidenceId: string;
    sourceSha256: string;
    sourceUrl?: string;
    observedAt?: string;
  }>;
}
export declare function validateFoodComponentEvidence(
  store: AssociativeStore,
  offers: Offer[],
  options?: { manufacturerRegistry?: Manufacturer[] }
): Promise<Offer[]>;
export interface FoodTotals {
  totalMassG: number | null;
  totalVolumeMl: number | null;
  totalProteinG: number | null;
}
export interface ConfirmedFoodBonus extends FoodTotals {
  id: string;
  kind: 'bonus-food';
  status: 'confirmed';
  allocationId: string;
  units: number;
  manufacturerVerified: boolean;
  proteinConflict: boolean;
  evidenceIds: string[];
}
export interface FoodComponentAccounting extends FoodTotals {
  paidFood: Partial<FoodTotals> & {
    productId: string;
    units: number | null;
    metadataIds: string[];
  };
  confirmedBonuses: ConfirmedFoodBonus[];
  potentialBonuses: Array<{
    id: string | null;
    kind?: string;
    status: 'potential';
    reasons: string[];
  }>;
  nonFoodAccessories: Array<{
    id: string;
    name: string | null;
    counted: false;
  }>;
  completeOffer: boolean;
  problems: string[];
  proteinConflict: boolean;
}
export declare function accountFoodComponents(
  product: Product,
  offer: Offer,
  options?: ComparisonOptions,
  paid?: Partial<FoodTotals>
): FoodComponentAccounting;

export interface BasketSourceMapping {
  market: 'vn';
  currency: 'VND';
  deliveryArea: string;
  destination: string;
  sourceUrl: string;
  sourceSha256: string;
  observedAt: string;
  evidenceId: string;
  mappingReviewedBy: string;
  selectors: {
    destination: string;
    shipping: string;
    total: string;
    coldChain?: string;
  };
  coldChainText?: string;
  lines: Array<{
    offerId: string;
    sku: string;
    quantity: number;
    selectors: {
      sku: string;
      quantity: string;
      unitPrice: string;
      subtotal: string;
    };
  }>;
  appliedDiscounts?: Array<{
    id: string;
    scope: 'merchandise' | 'shipping';
    selector: string;
    identitySelector?: string;
  }>;
  checkoutConditions?: {
    paymentMethod: { selector: string; text: string };
    voucherState: { selector: string; text: string };
  };
}
export interface BasketLine {
  offerId: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}
export interface BasketQuote {
  id: string;
  basketIdentity: string;
  market: 'vn';
  currency: 'VND';
  deliveryArea: string;
  shippingDestination: string;
  shipping: number;
  merchandiseSubtotal: number;
  discount: number;
  total: number;
  lines: BasketLine[];
  appliedDiscounts: Array<{
    id: string;
    scope: 'merchandise' | 'shipping';
    amount: number;
    eligibility: 'applied-in-captured-basket';
    identityValidation?: 'source-text';
  }>;
  coldChainConfirmed: boolean;
  observedAt: string;
  evidenceId: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceValidation: 'exact-checkout-fields';
  mappingReviewedBy: string;
  sourceMapping: BasketSourceMapping;
  checkoutConditions?: { paymentMethod: string; voucherState: string };
  visibility?: 'public' | 'private';
}
export interface BasketComparisonOptions extends Omit<
  ComparisonOptions,
  'quantity' | 'shipping' | 'discount' | 'sort'
> {
  minMassG?: number;
  minVolumeMl?: number;
  minProteinG?: number;
  sort?:
    | 'costPerProteinG'
    | 'costPerGramBeforeDelivery'
    | 'costPerGramAfterDelivery'
    | 'costPerMlBeforeDelivery'
    | 'costPerMlAfterDelivery'
    | 'costPerProteinGramBeforeDelivery'
    | 'costPerProteinGramAfterDelivery'
    | 'totalBeforeDelivery'
    | 'totalAfterDelivery';
}
export interface BasketMetrics extends FoodTotals {
  totalBeforeDelivery: number;
  totalAfterDelivery: number;
  shipping: number;
  appliedDiscount: number;
  costPerGramBeforeDelivery: number | null;
  costPerGramAfterDelivery: number | null;
  costPerMlBeforeDelivery: number | null;
  costPerMlAfterDelivery: number | null;
  costPerProteinGramBeforeDelivery: number | null;
  costPerProteinGramAfterDelivery: number | null;
}
export interface BasketComparisonRow {
  quote: BasketQuote;
  lines?: ComparisonRow[];
  eligible: boolean;
  problems: string[];
  metrics: BasketMetrics | null;
}
export interface BasketComparisonReport {
  observations: BasketComparisonRow[];
  ranked: BasketComparisonRow[];
  excluded: BasketComparisonRow[];
  assumptions: {
    sort: string;
    quoteCoverage: 'captured-exact-baskets-only';
    allBasketCombinationsCollected: false;
  };
}
export declare function basketIdentity(
  lines: Array<Pick<BasketLine, 'offerId' | 'sku' | 'quantity'>>
): string;
export declare function extractBasketQuote(
  html: Uint8Array | string,
  input: BasketSourceMapping
): BasketQuote;
export declare function saveBasketQuote(
  application: LazadaSearch,
  input: BasketSourceMapping
): Promise<BasketQuote>;
export declare function captureBasketQuote(
  application: LazadaSearch,
  input: Omit<
    BasketSourceMapping,
    'sourceUrl' | 'sourceSha256' | 'observedAt' | 'evidenceId'
  >
): Promise<BasketQuote>;
export declare function compareBaskets(
  application: LazadaSearch,
  options?: BasketComparisonOptions
): Promise<BasketComparisonReport>;

export interface CheckoutScenarioPlanInput {
  market: 'vn';
  currency: 'VND';
  deliveryArea: string;
  lines: Array<{ offerId: string; sku: string; quantities: number[] }>;
  voucherSelections: Array<{ text: string; voucherIds: string[] }>;
  paymentMethods: string[];
}
export interface CheckoutScenarioPlan {
  id: string;
  definition: CheckoutScenarioPlanInput & { version: 'checkout-scenarios-v1' };
  createdAt: string;
  coverageScope: 'explicit-planned-prepared-checkouts-only';
  allMarketScenariosCollected: false;
}
export interface CheckoutScenario {
  id: string;
  planId: string;
  definition: {
    lines: Array<Pick<BasketLine, 'offerId' | 'sku' | 'quantity'>>;
    vouchers: { text: string; voucherIds: string[] };
    paymentMethod: string;
  };
  status: 'pending' | 'validated' | 'failed';
  reason?: string;
  observedAt?: string;
  sourceSha256?: string;
  evidenceId?: string;
  mappingSha256?: string;
  extractionFingerprint?: string;
  quoteId?: string;
  quoteSha256?: string;
  sourceMapping?: BasketSourceMapping;
  validatedAt?: string;
  reused?: boolean;
}
export interface CheckoutScenarioReport {
  plan: CheckoutScenarioPlan;
  scenarios: CheckoutScenario[];
  counts: { pending: number; failed: number; validated: number };
  coverage: {
    planned: number;
    allPlannedScenariosObserved: boolean;
    allMarketScenariosCollected: false;
    checkoutLayoutLiveVerified: false;
    purchaseReady: false;
  };
}
export interface CheckoutScenarioBatch {
  planId: string;
  captures: Array<{ scenarioId: string; mapping: BasketSourceMapping }>;
}
export interface CheckoutScenarioBatchReport extends CheckoutScenarioReport {
  results: CheckoutScenario[];
  downloads: 0;
  cartMutations: 0;
  payments: 0;
}
export declare function planCheckoutScenarios(
  application: LazadaSearch,
  input: CheckoutScenarioPlanInput
): Promise<CheckoutScenarioReport>;
export declare function runCheckoutScenarios(
  application: LazadaSearch,
  input: CheckoutScenarioBatch
): Promise<CheckoutScenarioBatchReport>;
export declare function checkoutScenarioStatus(
  application: LazadaSearch,
  input: { planId: string }
): Promise<CheckoutScenarioReport>;
export interface CrossCheck {
  sourceAuthority?: string;
  checkedAt?: string;
  id?: string;
  productId?: string;
  manufacturerUrl?: string;
  evidenceId?: string;
  identityMatched: boolean;
  identityMethod: string;
  conflicts: Array<{ field: string; listing: Json; manufacturer: Json }>;
  corroborated: string[];
}
export interface BlobReference {
  type?: 'stored-blob';
  sha256: string;
  bytes: number;
}
export interface Doublet {
  id: number;
  source: number;
  target: number;
  name?: string;
}
export declare class DoubletGraph {
  links: Doublet[];
  names: Map<string, number>;
  pairs: Map<string, number>;
  atom(name: string): number;
  pair(source: number, target: number): number;
  addRecord(
    kind: string,
    record: { id: string; [key: string]: unknown }
  ): number;
  query(filter?: { source?: number; target?: number }): Doublet[];
  toNotation(options?: { numericIds?: boolean }): string;
  toBinary(): Buffer;
  static fromBinary(bytes: Buffer): DoubletGraph;
}
export declare class AssociativeStore {
  constructor(options?: {
    directory?: string;
    archive?: string | RepositoryArchive;
    fallback?: AssociativeStore;
    visibility?: 'public' | 'private';
  });
  directory: string;
  archive?: RepositoryArchive;
  fallback?: AssociativeStore;
  visibility: 'public' | 'private';
  kinds(): Promise<string[]>;
  recordPath(kind: string, id: string): string;
  locked<T>(action: () => Promise<T>): Promise<T>;
  put<T extends { id: string }>(kind: string, record: T): Promise<T>;
  putLatest<T extends { id: string; observedAt?: string }>(
    kind: string,
    record: T
  ): Promise<T>;
  /** Bounded chronological writes; returns accepted observations in input order. */
  putLatestMany<T extends { id: string; observedAt?: string }>(
    kind: string,
    records: T[]
  ): Promise<T[]>;
  /** Bounded writes under one lock; duplicate IDs preserve input order. */
  putMany<T extends { id: string }>(kind: string, records: T[]): Promise<T[]>;
  get<T = Record<string, unknown>>(
    kind: string,
    id: string
  ): Promise<T | undefined>;
  list<T = Record<string, unknown>>(
    kind: string,
    query?: { path?: string; value?: unknown }
  ): Promise<T[]>;
  graph(kind: string, id: string): Promise<DoubletGraph | undefined>;
  exportGraph(): Promise<DoubletGraph>;
  putBlob(contents: string | Uint8Array): Promise<BlobReference>;
  blob(id: string): Promise<Buffer | undefined>;
}
export declare class DomainScheduler {
  constructor(options?: {
    intervalMs?: number;
    sleep?: (ms: number) => Promise<unknown>;
  });
  run<T>(url: string, action: () => Promise<T>): Promise<T>;
  pace(url: string): Promise<void>;
}
export interface Capture {
  id: string;
  url: string;
  snapshot: PageSnapshot;
  status: string;
  html?: BlobReference;
  screenshot?: BlobReference;
  screenshotMode?: 'viewport';
  screenshots?: Array<{
    role: 'before-scroll' | 'after-scroll' | 'delivery';
    blob: BlobReference;
    method: 'cdp-view' | 'engine-viewport';
    x: number;
    y: number;
    width: number;
    height: number;
    deviceScaleFactor: number;
  }>;
  finalUrl?: string;
  fetchedAt: number;
  checkedAt: number;
  cacheHit: boolean;
  stale: boolean;
  imagesRefreshed?: boolean;
  scrolling?: {
    known: boolean;
    kind: 'product-grid' | 'product-content';
    position: number;
    target: number;
    step: number;
    pagerObserved: boolean;
    bottomInset?: number;
    steps: number;
    settled: boolean;
  };
  visibility?: 'public' | 'private';
}
export interface PageSnapshot {
  url: string;
  title: string;
  priceText?: string;
  originalPriceText?: string;
  discountPercentText?: string;
  promotions?: Array<{ text: string }>;
  seller?: string;
  brand?: string;
  description?: string;
  rawText: string;
  specs?: string[];
  jsonLd?: unknown[];
  images?: string[];
  productImages?: string[];
  manufacturerLabels?: Array<{ url: string; flavour: string }>;
  manufacturerVariants?: Array<{
    id: string;
    name?: string;
    manufacturerSku?: string;
    gtin?: string;
    options?: string[];
    available?: boolean;
    images: string[];
  }>;
  variants?: Product['variants'];
  selectedVariant?: Product['variants'];
  cards?: Array<{
    url: string;
    title: string;
    rawText?: string;
    priceText?: string;
    sku?: string;
  }>;
  skuCatalogObserved?: boolean;
  skuCatalog?: Array<{
    sku: string;
    url?: string;
    options: Array<{ name: string; value: string }>;
    available: boolean;
    image?: string;
    minQuantity?: number;
    maxQuantity?: number;
  }>;
  searchCoverage?: {
    currentPage: number;
    lastPage: number | null;
    reportedTotal: number | null;
    terminalConfirmed: boolean;
    nextAvailable: boolean | null;
  };
  links?: Array<{ url: string; text: string }>;
  nextUrl?: string;
}
export declare class EvidenceCache {
  constructor(options: {
    store: AssociativeStore;
    scheduler?: DomainScheduler;
    now?: () => number;
    offline?: boolean;
  });
  offline: boolean;
  invalidate(
    url: string,
    options: { reason: string; namespace?: string }
  ): Promise<{ url: string; invalidated: number; reason: string }>;
  stats: {
    hits: number;
    misses: number;
    downloads: number;
    revalidated: number;
  };
  get<T extends Record<string, unknown>>(
    url: string,
    options?: {
      namespace?: string;
      ttlMs?: number;
      refresh?: boolean;
      acceptCached?: (cached: T) => boolean;
      load?: (cached?: T) => Promise<T | { notModified: true }>;
    }
  ): Promise<T & { cacheHit: boolean; stale: boolean }>;
  image(
    url: string,
    options?: {
      refresh?: boolean;
      fetchImage?: typeof fetch;
      maxBytes?: number;
      failureTtlMs?: number;
    }
  ): Promise<{ blob: BlobReference; cacheHit: boolean }>;
}
export declare class BrowserCollector {
  constructor(options: {
    cache: EvidenceCache;
    store?: AssociativeStore;
    browserOptions?: Record<string, unknown>;
    settleMs?: number;
    maxScrolls?: number;
    captureTimeoutMs?: number;
    flavourScope?: ComparisonOptions['flavourScope'];
  });
  start(): Promise<void>;
  assertCollecting(): Promise<void>;
  resumeCollection(): Promise<CollectionStopState>;
  page(
    url: string,
    options?: {
      namespace?: string;
      ttlMs?: number;
      refresh?: boolean;
      reprocess?: boolean;
      acceptCached?: (cached: Capture) => boolean;
      flavourScope?: ComparisonOptions['flavourScope'];
    }
  ): Promise<Capture>;
  capture(url: string): Promise<Partial<Capture>>;
  close(): Promise<void>;
}
export interface PageChallenge {
  detected: boolean;
  signals: string[];
  url: string;
}
export interface CollectionStopState {
  id: string;
  active: boolean;
  reason?: 'challenge';
  detectedAt?: string;
  resumedAt?: string;
  origin?: string | null;
  signals?: string[];
}
export declare const COLLECTION_STOP_ID: string;
export declare class CollectionStoppedError extends Error {
  code: 'COLLECTION_STOPPED';
  reason: 'challenge';
}
export declare function inspectPageChallenge(context?: {
  document: Document;
  url: string;
}): PageChallenge;
export declare function assertPageNotChallenged(
  page: any
): Promise<PageChallenge>;
/** Collector-owned visible windows survive collector exits and close after idle. */
export declare const BROWSER_IDLE_MS: number;
export declare function closeBrowserWindow(directory: string): Promise<void>;
export declare function publishAccountCaptures(
  application: LazadaSearch,
  accountStore: AssociativeStore
): Promise<{
  published: Array<Record<string, unknown>>;
  historicalPublished: Array<Record<string, unknown>>;
  allPublished: Array<Record<string, unknown>>;
  rejected: Array<{ url: string; reason: string }>;
  reused: number;
  downloads: number;
}>;
export declare function publishAccountDiscovery(
  application: LazadaSearch,
  accountStore: AssociativeStore
): Promise<{
  published: Array<Record<string, unknown>>;
  rejected: Array<{ url: string; reason: string }>;
  reused: number;
  downloads: number;
}>;
export declare function reviewListingCategory(
  application: LazadaSearch,
  url: string,
  review: {
    category: Product['category'];
    evidenceId: string;
    reviewedBy: string;
    reason: string;
  }
): Promise<Record<string, unknown>>;
export interface OcrResult {
  id: string;
  imageHash: string;
  text: string;
  confidence: number;
  words: Array<{
    line: string;
    text: string;
    confidence: number;
    box: number[];
  }>;
  engine: string;
  /** Absent on historical OCR that predates physical trained-model binding. */
  modelProvenance?: {
    version: 'tesseract-traineddata-v1';
    requestedLanguages: string;
    directorySelection: 'native' | 'explicit';
    fingerprint: string;
    models: Array<{
      language: string;
      role: 'language' | 'orientation';
      sha256: string;
      bytes: number;
    }>;
  };
  languages: string;
  psm: number;
  observedAt: string;
  cacheHit: boolean;
  rawTsv?: BlobReference;
  originalImageHash?: string;
  derivedImage?: BlobReference;
  imageTransform?: {
    id: string;
    originalImage: BlobReference;
    originalDimensions: { width: number; height: number };
    originalFormat: string;
    sourceOcr?: { id: string; imageHash: string; rawTsv: BlobReference };
    transform: Record<string, unknown>;
    renderer: Record<string, string>;
    derivedImage: BlobReference;
    createdAt: string;
    requiresReview: true;
  };
  parameters?: { tessdataDir: string; tessedit_create_tsv: number };
  requiresReview?: boolean;
  transformCacheHit?: boolean;
}
export declare class TesseractOcr {
  constructor(options: {
    store: AssociativeStore;
    languages?: string;
    command?: string;
    psm?: number;
    tessdataDir?: string;
  });
  version(): Promise<string>;
  recognize(
    blob: BlobReference,
    options?: {
      psm?: number;
      transform?: OcrImageTransform;
      sourceOcrId?: string;
    }
  ): Promise<OcrResult>;
}
export interface OcrImageTransform {
  crop?: { left: number; top: number; width: number; height: number };
  resize?: { width: number; height: number; kernel?: 'lanczos3' | 'nearest' };
  grayscale?: boolean;
}
export declare class NativeLinkStore {
  constructor(options?: { command?: string });
  project(
    directory: string,
    graph: DoubletGraph
  ): Promise<{ directory: string; cacheHit: boolean; links: number }>;
  mirror(
    store: AssociativeStore
  ): Promise<{ backend: string; shards: unknown[]; reused: number }>;
}
export interface TranslationOptions {
  sourceLanguage?: string;
  targetLanguage?: string;
  refresh?: boolean;
  sourceEvidenceId?: string;
  sourceEvidenceHash?: string;
  protectedEntities?: string[];
}
export interface TranslationQuality {
  fingerprint: string;
  sourceSha256: string;
  translatedSha256: string;
  passed: boolean;
  issues: string[];
  protectedEntities: string[];
  semanticAccuracyApproved: false;
}
export interface TranslationReview {
  status: 'pending' | 'approved' | 'rejected';
  reviewer?: string;
  reviewedAt?: string;
  sourceSha256?: string;
  translatedSha256?: string;
  qualityFingerprint?: string;
}
export interface ReviewedTranslationChunkProof {
  sourceKind: string;
  sourceRecordId: string;
  path: string[];
  originalSourceSha256: string;
  chunkPartitionSha256: string;
  chunks: Array<{
    sourceId: string;
    chunkIndex: number;
    offset: number;
    sourceSha256: string;
    translationId: string;
    translatedSha256: string;
    qualityFingerprint: string;
    reviewer: string;
    reviewedAt: string;
  }>;
  assemblyQuality: TranslationQuality;
  reviewBasis: 'reviewed-chunks';
}
export interface OfferPresentation {
  presentationOnly: true;
  authoritative: false;
  evidenceIds: string[];
  commercialText: Array<{
    path: string[];
    presentation: PresentationField;
  }>;
  seller?: PresentationField;
  sellerName?: PresentationField;
  sellerText?: PresentationField;
  shippingText?: PresentationField;
  promotionText?: PresentationField;
  conditions?: PresentationField;
  condition?: PresentationField;
  priceText?: PresentationField;
  originalPriceText?: PresentationField;
}
export interface PresentationField {
  originalText: string;
  sourceSha256: string;
  text: string;
  language: string;
  status:
    | 'reviewed'
    | 'preview-unreviewed'
    | 'review-pending'
    | 'translation-pending'
    | 'translation-needs-chunk-review';
  presentationOnly: true;
  authoritative: false;
  translationId?: string;
  translatedSha256?: string;
  providerId?: string;
  providerVersion?: string;
  qualityFingerprint?: string;
  chunkProof?: ReviewedTranslationChunkProof;
}
export interface ProductPresentation {
  presentationOnly: true;
  authoritative: false;
  evidenceIds: string[];
  title?: PresentationField;
  description?: PresentationField;
  ingredients: Array<PresentationField | undefined>;
  selectedVariant: Array<{
    text?: string;
    selected?: boolean;
    sku?: string;
    presentation?: PresentationField;
  }>;
}
export declare const TRANSLATION_QUALITY_FINGERPRINT: string;
export declare function checkTranslationQuality(
  originalText: string,
  translatedText: string,
  options?: Pick<
    TranslationOptions,
    'sourceLanguage' | 'targetLanguage' | 'protectedEntities'
  >
): TranslationQuality;
export declare function translationReviewAccepted(
  record: TranslationRecord
): boolean;
export declare function applyComparisonTranslations(
  report: ComparisonReport,
  translator: CachedTranslator,
  options?: Pick<TranslationOptions, 'sourceLanguage' | 'targetLanguage'> & {
    requireReviewed?: boolean;
  }
): Promise<ComparisonReport>;
export declare function applyBasketComparisonTranslations(
  report: BasketComparisonReport,
  translator: CachedTranslator,
  options?: Pick<TranslationOptions, 'sourceLanguage' | 'targetLanguage'> & {
    requireReviewed?: boolean;
  }
): Promise<BasketComparisonReport>;
export interface TranslationRecord {
  id: string;
  originalText: string;
  sourceSha256: string;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerVersion: string;
  presentationOnly: true;
  authoritative: false;
  status: 'translated' | 'pending';
  translatedText?: string;
  translatedSha256?: string;
  translatedAt?: string;
  reason?: string;
  cacheHit: boolean;
  sourceEvidenceId?: string;
  sourceEvidenceHash?: string;
  candidateText?: string;
  candidateSha256?: string;
  qualityChecks?: TranslationQuality;
  review?: TranslationReview;
  acceptance?:
    | 'unsuitable-presentation'
    | 'quality-checked-review-pending'
    | 'reviewed-presentation'
    | 'rejected-presentation';
}
export interface TranslationInput {
  originalText: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceSha256: string;
  stop(challenge: { url: string; signals: string[] }): Promise<unknown>;
}
export interface TranslationProvider {
  id: string;
  version: string;
  endpoint?: string;
  translate(input: TranslationInput): Promise<string> | string;
}
export declare function createHttpTranslationProvider(options: {
  endpoint: string;
  id: string;
  version: string;
  tokenEnv?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): TranslationProvider;
export declare class CachedTranslator {
  constructor(options: {
    store: AssociativeStore;
    provider?: TranslationProvider | TranslationProvider['translate'];
    providerId?: string;
    providerVersion?: string;
    scheduler?: DomainScheduler;
    offline?: boolean;
    beforeDownload?: () => Promise<unknown> | unknown;
  });
  translate(
    text: string,
    options?: TranslationOptions
  ): Promise<TranslationRecord>;
  cached(
    text: string,
    options?: TranslationOptions
  ): Promise<TranslationRecord | undefined>;
  review(
    id: string,
    input: {
      sourceSha256: string;
      translatedSha256: string;
      reviewer: string;
      decision: 'approved' | 'rejected';
    }
  ): Promise<TranslationRecord>;
}
export interface ProductTranslationReport {
  productId: string;
  presentationOnly: true;
  authoritative: false;
  complete: boolean;
  reviewedComplete: boolean;
  translations: Array<TranslationRecord & { field: string; index: number }>;
}
export interface CatalogTranslationOptions extends TranslationOptions {
  cacheOnly?: boolean;
  limit?: number;
  jobId?: string;
  productIds?: string[];
  includeSources?: boolean;
  maxChunkBytes?: number;
}
export interface CatalogTranslationJob {
  id: string;
  fingerprint: string;
  status: 'pending' | 'partial' | 'stopped' | 'complete';
  complete: boolean;
  reviewedComplete: boolean;
  presentationOnly: true;
  authoritative: false;
  cacheOnly: boolean;
  catalogInventoryComplete: false;
  counts: {
    total: number;
    uniqueTexts: number;
    translated: number;
    reviewed: number;
    reviewPending: number;
    pending: number;
    remaining: number;
  };
  lastRun: {
    processed: number;
    cacheHits: number;
    providerResults: number;
    stopped: boolean;
  };
  sourceGaps: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
export declare function planCatalogTranslation(
  application: LazadaSearch,
  options?: CatalogTranslationOptions
): Promise<Record<string, unknown>>;
export declare function translateCatalog(
  application: LazadaSearch,
  options?: CatalogTranslationOptions
): Promise<CatalogTranslationJob>;
export declare function translationStatus(
  application: LazadaSearch,
  options?: { jobId?: string }
): Promise<Record<string, unknown>>;
export declare const OPERATION_NAMES: string[];
export declare function executeOperation(
  application: LazadaSearch,
  request: {
    operation: string;
    input?: Record<string, unknown>;
    args?: string[];
    options?: Record<string, unknown>;
  }
): Promise<unknown>;
export declare class LazadaSearch {
  manufacturerResearch(
    plan: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  constructor(options?: {
    flavourScope?: ComparisonOptions['flavourScope'];
    store?: AssociativeStore;
    cache?: EvidenceCache;
    collector?: BrowserCollector;
    ocr?: TesseractOcr | false;
    market?: string;
    deliveryArea?: string;
    maxImages?: number;
    offline?: boolean;
    browserOptions?: Record<string, unknown>;
    scheduler?: DomainScheduler;
    manufacturerRegistry?: Manufacturer[];
    translationProvider?:
      | TranslationProvider
      | TranslationProvider['translate'];
    translationProviderId?: string;
    translationProviderVersion?: string;
  });
  store: AssociativeStore;
  cache: EvidenceCache;
  collector: BrowserCollector;
  market: string;
  deliveryArea: string;
  translator: CachedTranslator;
  translate(
    text: string,
    options?: TranslationOptions
  ): Promise<TranslationRecord>;
  translateProduct(
    productId: string,
    options?: TranslationOptions
  ): Promise<ProductTranslationReport>;
  translateCatalog(
    options?: CatalogTranslationOptions
  ): Promise<CatalogTranslationJob>;
  translationStatus(options?: {
    jobId?: string;
  }): Promise<Record<string, unknown>>;
  importRecords(records: {
    products?: Product[];
    offers?: Offer[];
    discoveries?: Array<{ id: string; [key: string]: unknown }>;
    skuInventories?: Array<{ id: string; [key: string]: unknown }>;
    crawls?: Array<{ id: string; [key: string]: unknown }>;
    availability?: ListingAvailability[];
    invalidations?: Array<{ id: string; url: string; invalidatedAt: string }>;
  }): Promise<{ products: number; offers: number }>;
  collect(
    url: string,
    options?: {
      refresh?: boolean;
      reprocess?: boolean;
      flavourScope?: ComparisonOptions['flavourScope'];
    }
  ): Promise<{
    product: Product;
    offer: Offer;
    cacheHit: boolean;
    stale: boolean;
  }>;
  audit(): Promise<Record<string, unknown>>;
  importCapture(capture: BrowserCapture): Promise<{
    product: Product;
    offer: Offer;
    cacheHit: boolean;
    stale: boolean;
  }>;
  reviewManufacturer(
    productId: string,
    review: ManufacturerReview
  ): Promise<Product>;
  crawl(options?: {
    exhaustive?: boolean;
    discoveryOnly?: boolean;
    queries?: string[];
    categoryUrls?: string[];
    categoryOnly?: boolean;
    searchSort?: 'default' | 'priceasc' | 'pricedesc';
    maxPages?: number;
    maxProducts?: number;
    refresh?: boolean;
  }): Promise<Record<string, unknown>>;
  verify(
    productId: string,
    manufacturerUrl: string,
    options?: { refresh?: boolean }
  ): Promise<CrossCheck>;
  review(
    productId: string,
    field: string,
    value: Json,
    evidenceId: string
  ): Promise<Product>;
  quote(offerId: string, input: Partial<Offer>): Promise<Offer>;
  saveBasketQuote(input: BasketSourceMapping): Promise<BasketQuote>;
  captureBasketQuote(
    input: Omit<
      BasketSourceMapping,
      'sourceUrl' | 'sourceSha256' | 'observedAt' | 'evidenceId'
    >
  ): Promise<BasketQuote>;
  compareBaskets(
    options?: BasketComparisonOptions
  ): Promise<BasketComparisonReport>;
  planCheckoutScenarios(
    input: CheckoutScenarioPlanInput
  ): Promise<CheckoutScenarioReport>;
  runCheckoutScenarios(
    input: CheckoutScenarioBatch
  ): Promise<CheckoutScenarioBatchReport>;
  checkoutScenarioStatus(input: {
    planId: string;
  }): Promise<CheckoutScenarioReport>;
  delivery(
    url: string,
    options?: { province?: string; locality?: string; refresh?: boolean }
  ): Promise<Record<string, unknown>>;
  compare(options?: ComparisonOptions): Promise<ComparisonReport>;
  close(): Promise<void>;
}

export declare const DEFAULT_ARCHIVE: string;
export declare function importBrowserCapture(
  application: LazadaSearch,
  capture: BrowserCapture
): ReturnType<LazadaSearch['importCapture']>;
export declare function reviewManufacturer(
  application: LazadaSearch,
  productId: string,
  review: ManufacturerReview
): Promise<Product>;
export declare class RepositoryArchive {
  constructor(options?: { directory?: string });
  directory: string;
  manifest(): Promise<Record<string, unknown>>;
  list<T = Record<string, unknown>>(kind: string): Promise<T[]>;
  get<T = Record<string, unknown>>(
    kind: string,
    id: string
  ): Promise<T | undefined>;
  blob(hash: string): Promise<Buffer | undefined>;
  graph(kind: string, id: string): Promise<DoubletGraph | undefined>;
  verify(): Promise<{
    valid: boolean;
    records: number;
    blobs: number;
    downloads: number;
  }>;
}
export declare function exportRepositoryArchive(options: {
  store: AssociativeStore;
  directory?: string;
  caseMetadata?: Record<string, unknown>;
}): Promise<{
  directory: string;
  records: number;
  blobs: number;
  reused: number;
  rebuilt: number;
  downloads: number;
}>;
export declare const MARKETS: Record<
  string,
  { host: string; currency: string; queries: string[]; categoryUrls?: string[] }
>;
export declare function extractPage(context?: {
  document: unknown;
  url: string;
}): PageSnapshot;
export declare function classifyPage(page: PageSnapshot): string;
export declare function parseTsv(
  text: string
): Pick<OcrResult, 'text' | 'confidence' | 'words'>;
export declare function parseProduct(
  snapshot: PageSnapshot,
  options?: {
    market?: string;
    currency?: string;
    evidenceId?: string;
    originalHtmlSha256?: string;
    source?: string;
    observedAt?: string;
  }
): { product: Product; offer: Offer };
export declare function validateProduct(product: Product): Product;
export declare function validateOffer(offer: Offer): Offer;
export declare function extractNutrition(text: string): {
  fields: Partial<Product>;
  excerpts: Record<string, string>;
  warnings: string[];
  basis: string;
};
export declare function crossCheck(
  product: Product,
  manufacturer: Product
): CrossCheck;
export declare function ingredientFlags(
  ingredients: string[]
): Record<string, boolean | null>;
export declare function proteinTypeOf(
  ingredients: string[],
  category: Category
): ProteinType;
export declare function calculateOffer(
  product: Product,
  offer: Offer,
  options?: ComparisonOptions
): ComparisonRow;
export declare function compareOffers(
  products: Product[],
  offers: Offer[],
  options?: ComparisonOptions
): ComparisonReport;
export declare function productFlavour(
  product: Product
): 'chocolate' | 'unflavoured' | 'other' | 'unknown';
export declare function matchesFlavourScope(
  product: Product,
  scope?: ComparisonOptions['flavourScope']
): boolean;
export declare function createTelegramBot(options: {
  application: LazadaSearch;
  token: string;
  allowedUserIds: number[];
  botInfo?: unknown;
  client?: unknown;
}): Bot;
export declare function startServer(options: {
  application: LazadaSearch;
  port?: number;
}): Promise<Server>;
export declare function sessionSources(
  domain?: string
): Promise<Record<string, unknown>>;
export declare function importSession(options: {
  directory: string;
  domain?: string;
  browser?: string;
  profile?: string;
}): Promise<{
  cookies: unknown[];
  summary: { browser: string; profile?: string; cookieCount: number };
}>;

export declare const REQUIRED_SPEC_FIELDS: string[];
export declare function specificationProblems(product: Product): string[];
export declare function reconcileManufacturer(
  product: Product,
  manufacturer: Product,
  check: CrossCheck & {
    sourceAuthority: string;
    evidenceId: string;
    manufacturerUrl: string;
    checkedAt?: string;
  }
): Product;
export declare function auditCoverage(
  input?: Record<string, unknown>
): Record<string, unknown>;
export declare function assertCompleteCoverage(
  report: Record<string, unknown>
): Record<string, unknown>;
export interface Manufacturer {
  name: string;
  aliases: string[];
  domains: string[];
  assetDomains?: string[];
  url: string;
}
export declare const MANUFACTURERS: Manufacturer[];
export declare function manufacturerCandidates(
  product: Product,
  registry?: Manufacturer[]
): Array<{
  name: string;
  url: string;
  identityStatus: string;
  reason: string;
  brandConflict: boolean;
}>;
export declare function isTrustedManufacturer(
  product: Product,
  url: string,
  registry?: Manufacturer[]
): boolean;

export interface PhoneLoginState {
  status:
    | 'authenticated'
    | 'challenge'
    | 'invalid-phone'
    | 'otp-required'
    | 'pending';
  reason?: string;
}
export declare function vietnamPhoneNumber(value: string): string;
export declare function phoneLoginState(
  page: unknown
): Promise<PhoneLoginState>;
export declare function startPhoneLogin(
  collector: BrowserCollector,
  options: {
    phone: string;
    channel?: 'zalo' | 'sms';
    url?: string;
    timeoutMs?: number;
  }
): Promise<PhoneLoginState>;
export declare function submitPhoneCode(
  collector: BrowserCollector,
  code: string,
  options?: { timeoutMs?: number }
): Promise<PhoneLoginState>;

export interface ListingAvailability {
  id: string;
  url: string;
  finalUrl: string;
  listingKey: string;
  status: 'unavailable';
  verification: 'original-html-confirmed';
  observedAt: string;
  html: { type: 'stored-blob'; sha256: string; bytes: number };
  cacheId?: string;
  notice: string;
  invalidatedAt?: string;
}
export declare class ListingUnavailableError extends Error {
  readonly code: 'PAGE_UNAVAILABLE';
  readonly url: string;
  readonly evidence?: ListingAvailability;
  constructor(url: string, evidence?: ListingAvailability);
}
export declare function recordListingUnavailable(
  store: AssociativeStore,
  capture: Record<string, unknown>,
  url?: string
): Promise<ListingAvailability | undefined>;
export declare function currentUnavailableListings(
  records?: ListingAvailability[],
  offers?: Offer[],
  invalidations?: Array<{ url: string; invalidatedAt: string }>
): Map<string, ListingAvailability>;
export declare function applyListingAvailability(
  offers: Offer[],
  records?: ListingAvailability[],
  invalidations?: Array<{ url: string; invalidatedAt: string }>
): Offer[];
export declare const SCOPE_POLICY_VERSION: number;
export declare function persistScopeDecisions(
  store: AssociativeStore,
  audit: Record<string, unknown>,
  options?: { flavourScope?: 'all' | 'chocolate-or-unflavoured' }
): Promise<{
  decisions: Record<string, unknown>[];
  reused: number;
  excluded: number;
}>;
export declare function publishScopeDecisions(
  publicStore: AssociativeStore,
  accountStore: AssociativeStore
): Promise<{ published: number; reused: number }>;

export interface ManufacturerSourceRequest {
  brand: string;
  url: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  kind?: 'page' | 'label';
  parentSourceId?: string;
  refresh?: boolean;
  ocrPasses?: Array<{
    psm?: number;
    transform?: OcrImageTransform;
    sourceOcrId?: string;
  }>;
}
export interface ManufacturerResearchOptions {
  store: AssociativeStore;
  registry: Array<{
    brand: string;
    domains: string[];
    assetDomains?: string[];
  }>;
  cache?: EvidenceCache;
  scheduler?: DomainScheduler;
  fetchSource?: typeof fetch;
  offline?: boolean;
  now?: () => number;
  maxBytes?: number;
  failureTtlMs?: number;
  ocr?: TesseractOcr | false;
}
export declare function manufacturerRequest(
  request: ManufacturerSourceRequest
): {
  url: string;
  method: 'GET' | 'POST';
  body: string;
  headers: Record<string, string>;
  fingerprint: string;
};
export declare function manufacturerSourceId(
  request: ManufacturerSourceRequest
): string;
export declare class ManufacturerSourceCache {
  constructor(options: ManufacturerResearchOptions);
  cache: EvidenceCache;
  capture(request: ManufacturerSourceRequest): Promise<Record<string, unknown>>;
  importOriginal(
    request: ManufacturerSourceRequest & {
      sourceSha256: string;
      observedAt?: string;
      captureTimeUnknown?: boolean;
      finalUrl?: string;
      status?: 'captured' | 'failed';
      httpStatus?: number;
      retryAfter?: number | null;
      contentType?: string;
      originalArtifact?: string;
      originalSourceSha256?: string;
      redactionApplied?: boolean;
    },
    bytes: Uint8Array
  ): Promise<Record<string, unknown>>;
  images(sourceId: string): Promise<Array<Record<string, unknown>>>;
}
export declare class ManufacturerResearch {
  constructor(options: ManufacturerResearchOptions);
  sources: ManufacturerSourceCache;
  run(plan: {
    id?: string;
    sources?: ManufacturerSourceRequest[];
    reviews?: Array<Record<string, unknown>>;
  }): Promise<Record<string, unknown>>;
}
export declare function manufacturerIdentityGaps(
  listing?: Record<string, unknown>,
  manufacturer?: Record<string, unknown>
): string[];
export declare function reviewManufacturerResearch(
  store: AssociativeStore,
  review: Record<string, unknown>
): Promise<Record<string, unknown>>;
export interface HistoricalCaptureReplayReport {
  reprocessedAt: string;
  mode: string;
  visibility: 'public' | 'private';
  downloads: number;
  captures: number;
  reprocessed: number;
  reused: number;
  errors: number;
  results: Array<{
    sourceRecords: Array<{
      kind: string;
      id: string;
      evidenceId?: string;
      visibility?: 'public' | 'private';
    }>;
    sourceUrl?: string;
    sourceSha256?: string;
    expectedSku?: string;
    observedAt: string | null;
    status: 'reprocessed' | 'reused' | 'rejected';
    sku?: string;
    price?: number;
    cacheHit?: boolean;
    category?: Category;
    packCount?: number;
    netMassG?: number;
    netVolumeMl?: number;
    currentOffer?: Offer;
    error?: string;
  }>;
}
/** Re-extract exact stored historical HTML without navigation or cache writes. */
export declare function replayHistoricalCaptures(
  application: LazadaSearch,
  options?: { includeLatestCache?: boolean }
): Promise<HistoricalCaptureReplayReport>;
