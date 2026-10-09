import type { Bot } from 'grammy';
import type { Server } from 'node:http';
export type Category =
  | 'whey'
  | 'protein-powder'
  | 'chocolate-ice-cream'
  | 'unknown';
export declare function categoryOf(title: string): Category;
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
  category: Category;
  market?: string;
  brand?: string;
  sku?: string;
  manufacturerSku?: string;
  gtin?: string;
  specificationsInvalidated?: boolean;
  netMassG?: number;
  netVolumeMl?: number;
  packCount?: number;
  servingMassG?: number;
  proteinPer100g?: number;
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
  product: Product;
  offer: Offer;
  metrics: Metrics;
  eligible: boolean;
  manufacturerVerified: boolean;
  problems: string[];
}
export interface ComparisonReport {
  comparisons: ComparisonRow[];
  observedPrices: ComparisonRow[];
  unsortable: ComparisonRow[];
  ranked: ComparisonRow[];
  excluded: ComparisonRow[];
  bestByCategory: Record<Exclude<Category, 'unknown'>, ComparisonRow | null>;
  assumptions: Record<string, Json>;
  calculatedAt: string;
}
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
  });
  directory: string;
  archive?: RepositoryArchive;
  recordPath(kind: string, id: string): string;
  locked<T>(action: () => Promise<T>): Promise<T>;
  put<T extends { id: string }>(kind: string, record: T): Promise<T>;
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
}
export interface Capture {
  id: string;
  url: string;
  snapshot: PageSnapshot;
  status: string;
  html?: BlobReference;
  screenshot?: BlobReference;
  finalUrl?: string;
  fetchedAt: number;
  checkedAt: number;
  cacheHit: boolean;
  stale: boolean;
  imagesRefreshed?: boolean;
}
export interface PageSnapshot {
  url: string;
  title: string;
  priceText?: string;
  seller?: string;
  brand?: string;
  description?: string;
  rawText: string;
  specs?: string[];
  jsonLd?: unknown[];
  images?: string[];
  productImages?: string[];
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
      load?: (cached?: T) => Promise<T | { notModified: true }>;
    }
  ): Promise<T & { cacheHit: boolean; stale: boolean }>;
  image(
    url: string,
    options?: {
      refresh?: boolean;
      fetchImage?: typeof fetch;
      maxBytes?: number;
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
  });
  start(): Promise<void>;
  page(
    url: string,
    options?: {
      namespace?: string;
      ttlMs?: number;
      refresh?: boolean;
      reprocess?: boolean;
    }
  ): Promise<Capture>;
  capture(url: string): Promise<Partial<Capture>>;
  close(): Promise<void>;
}
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
  languages: string;
  psm: number;
  observedAt: string;
  cacheHit: boolean;
  rawTsv?: BlobReference;
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
    options?: { psm?: number }
  ): Promise<OcrResult>;
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
export declare class LazadaSearch {
  constructor(options?: {
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
  });
  store: AssociativeStore;
  cache: EvidenceCache;
  collector: BrowserCollector;
  market: string;
  deliveryArea: string;
  importRecords(records: {
    products?: Product[];
    offers?: Offer[];
    discoveries?: Array<{ id: string; [key: string]: unknown }>;
    skuInventories?: Array<{ id: string; [key: string]: unknown }>;
    crawls?: Array<{ id: string; [key: string]: unknown }>;
  }): Promise<{ products: number; offers: number }>;
  collect(
    url: string,
    options?: { refresh?: boolean; reprocess?: boolean }
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
    queries?: string[];
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
  { host: string; currency: string; queries: string[] }
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
