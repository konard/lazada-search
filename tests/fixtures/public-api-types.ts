import {
  LazadaSearch,
  accountFoodComponents,
  applyComparisonTranslations,
  applyBasketComparisonTranslations,
  basketIdentity,
  checkTranslationQuality,
  compareBaskets,
  extractBasketQuote,
  translationReviewAccepted,
  validateFoodComponentEvidence,
  type BasketSourceMapping,
  type FoodComponent,
  type Offer,
  type Product,
} from '../../src/index.js';

declare const application: LazadaSearch;
declare const product: Product;
declare const offer: Offer;
declare const source: BasketSourceMapping;
declare const originalHtml: Uint8Array;
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
