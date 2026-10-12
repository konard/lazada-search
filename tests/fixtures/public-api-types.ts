import {
  LazadaSearch,
  ManufacturerSourceCache,
  TesseractOcr,
  accountFoodComponents,
  applyComparisonTranslations,
  applyBasketComparisonTranslations,
  basketIdentity,
  checkTranslationQuality,
  compareBaskets,
  extractBasketQuote,
  reviewPackageQuantities,
  translationReviewAccepted,
  validateFoodComponentEvidence,
  type BasketSourceMapping,
  type CheckoutScenarioPlanInput,
  type FoodComponent,
  type Offer,
  type Product,
} from '../../src/index.js';

declare const application: LazadaSearch;
declare const product: Product;
declare const offer: Offer;
declare const source: BasketSourceMapping;
declare const originalHtml: Uint8Array;
declare const manufacturerSources: ManufacturerSourceCache;
declare const nativeOcr: TesseractOcr;
const challengeStatus = await application.collector.collectionStatus();
const challengePageOpen: boolean | undefined =
  challengeStatus.handoff?.pageOpen;
const challengeTarget: string | undefined = challengeStatus.browser?.targetId;
await application.collector.start({
  existingOnly: true,
  targetId: challengeTarget,
});
void challengePageOpen;
const modelBoundOcr = await nativeOcr.recognize({
  type: 'stored-blob',
  sha256: 'b'.repeat(64),
  bytes: 100,
});
const trainedModelDigest: string | undefined =
  modelBoundOcr.modelProvenance?.models[0]?.sha256;
const modelManifestVersion: 'tesseract-traineddata-v1' | undefined =
  modelBoundOcr.modelProvenance?.version;
void [trainedModelDigest, modelManifestVersion];
const quantityReview = await reviewPackageQuantities(application, product.id, {
  reviewedBy: 'Exact label reviewer',
  reason: 'Printed amount on the original matched package',
  listingEvidenceId: 'original-selected-listing',
  listingSha256: 'a'.repeat(64),
  facts: {
    netMassG: {
      value: 131,
      unit: 'g',
      basis: 'one-inner-food-package',
      sourceEvidenceId: 'original-package-label',
      sourceSha256: 'b'.repeat(64),
      sourceAuthority: 'manufacturer-label-secondary-host',
      excerpt: '130mL; 净含量131克',
      identityMatched: true,
    },
  },
});
const originalMass: number | null = quantityReview.originalQuantities.netMassG;
const originalVolume: number | null =
  quantityReview.originalQuantities.netVolumeMl;
const quantityReviewDigest: string = quantityReview.reviewSha256;
const nutritionNotApproved: false = quantityReview.nutritionApproved;
void [originalMass, originalVolume, quantityReviewDigest, nutritionNotApproved];
await manufacturerSources.importOriginal(
  {
    brand: 'Factory fixture',
    url: 'https://factory.example/product',
    sourceSha256: 'a'.repeat(64),
    contentType: 'text/html',
    status: 'failed',
    httpStatus: 403,
    retryAfter: null,
  },
  originalHtml
);
const acceptedProducts: Product[] = await application.store.putLatestMany(
  'product',
  [product]
);
void acceptedProducts;
const components: FoodComponent[] = [
  {
    id: 'paid',
    kind: 'paid-food',
    productId: product.id,
    unitsPerSellingUnit: 2,
  },
  { id: 'shaker', kind: 'non-food', name: 'Existing shaker' },
  { id: 'conditional-bonus', kind: 'bonus-food' },
];
accountFoodComponents(product, { ...offer, foodComponents: components });
await validateFoodComponentEvidence(application.store, [offer]);
offer.presentation?.commercialText.forEach(({ presentation }) => {
  const chunkProof = presentation.chunkProof;
  chunkProof?.chunks.forEach((chunk) => {
    const originalHash: string = chunk.sourceSha256;
    const reviewer: string = chunk.reviewer;
    void [originalHash, reviewer];
  });
});
extractBasketQuote(originalHtml, source);
basketIdentity(source.lines);
application.saveBasketQuote(source);
application.captureBasketQuote(source);
const scenarioPlan: CheckoutScenarioPlanInput = {
  market: 'vn',
  currency: 'VND',
  deliveryArea: 'Nha Trang',
  lines: [{ offerId: offer.id, sku: offer.sku!, quantities: [1, 3] }],
  voucherSelections: [{ text: 'No vouchers applied', voucherIds: [] }],
  paymentMethods: ['Cash on delivery'],
};
const planned = await application.planCheckoutScenarios(scenarioPlan);
const scenarioResult = await application.runCheckoutScenarios({
  planId: planned.plan.id,
  captures: [{ scenarioId: planned.scenarios[0].id, mapping: source }],
});
const noDownloads: 0 = scenarioResult.downloads;
const noPurchaseApproval: false = scenarioResult.coverage.purchaseReady;
const pendingScenarioCount: number = (
  await application.checkoutScenarioStatus({ planId: planned.plan.id })
).counts.pending;
const sharedArtworkRequiresReview: true | undefined =
  product.packageArtworkConflicts?.[0]?.requiresReview;
void [
  noDownloads,
  noPurchaseApproval,
  pendingScenarioCount,
  sharedArtworkRequiresReview,
];
compareBaskets(application, {
  minProteinG: 1000,
  sort: 'costPerGramAfterDelivery',
});
application.compareBaskets({
  category: 'whey',
  flavourScope: 'chocolate-or-unflavoured',
});
checkTranslationQuality('Không bình 100g', 'No shaker 100g', {
  protectedEntities: [],
});
const text = await application.translate('Không bình 100g');
translationReviewAccepted(text);
application.translator.review(text.id, {
  sourceSha256: text.sourceSha256,
  translatedSha256: text.translatedSha256!,
  reviewer: 'fixture-reviewer',
  decision: 'approved',
});
applyComparisonTranslations(
  await application.compare(),
  application.translator
);
applyBasketComparisonTranslations(
  await application.compareBaskets(),
  application.translator
);

// Workflow API contracts participate in the public declaration check.
const caseDraft = await application.planCaseWorkflow({ quantities: [1, 10] });
await application.runCaseWorkflow(String(caseDraft.workflow.id), {
  maxTasks: 25,
  manualReviewId: 'review',
  ocrPasses: [{ psm: 6, transform: { grayscale: true } }],
});
const shoppingDraft = await application.shoppingReport({
  quantities: [1],
  limit: 10,
});
const draftBaskets: Record<string, unknown>[] = shoppingDraft.baskets;
await application.prepareManufacturerWorkflowReview({
  workflowId: 'workflow',
  reviewDraftId: 'review',
});
void draftBaskets;
