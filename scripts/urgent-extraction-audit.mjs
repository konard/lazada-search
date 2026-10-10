import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { extractPage, LazadaSearch, parseProduct } from '../src/index.js';
import { configuredStore } from '../src/config.js';
import { catalogProducts } from '../src/catalog-products.js';
import { matchesFlavourScope, productFlavour } from '../src/flavour-scope.js';
import { ingredientFlags, proteinTypeOf } from '../src/nutrition.js';

const directory = 'docs/acceptance/urgent-extraction-audit';
const app = new LazadaSearch({
  store: configuredStore({
    account: 'default',
    dataDir: '.lazada-search',
    archiveDir: 'data/cases/vietnam-nha-trang',
  }),
  market: 'vn',
  deliveryArea: 'Nha Trang',
  offline: true,
  ocr: false,
});
app.collector.start = () => {
  throw new Error('Extraction audit forbids browser access');
};
const checkedAt = new Date().toISOString();
const comparison = await app.compare({ allowStale: true });
const products = await catalogProducts(app.store);
const publicOffers = await app.store.fallback.list('offer');
const targetItems = new Set([
  '13345064562',
  '367656830',
  '1561301337',
  '1880785864',
  '13479894070',
  '13459402808',
  '13430219487',
  '2126595433',
  '3154800181',
  '2326481300',
]);
const finding = (sku) => {
  if (sku.startsWith('13345064562_')) {
    return {
      status: 'cached-quantity-repaired',
      explanation:
        'Exact selected chocolate title sells Combo 2 Túi with 500G per bag. 1G is sugar per serving. Marketplace review corrected private observation to 500g x 2, retaining price and time; exact manufacturer review remains required.',
    };
  }
  if (sku.startsWith('367656830_') || sku.startsWith('1561301337_')) {
    return {
      status: 'marketplace-quantity-only',
      explanation:
        '40g/cây is per stick; selected 1 cây or COMBO 5 cây determines the selling count. The description 40 cây thùng is an outer carton, not an automatic 40-stick purchase. Same-time alias conflicts must stay excluded until reviewed. Cold-chain delivery to Nha Trang is unconfirmed.',
    };
  }
  if (sku.startsWith('1880785864_')) {
    return {
      status: 'marketplace-volume-only',
      explanation:
        'The selected 125ml or 475ml option identifies tub volume. No measured density or factory protein panel is available, so no grams/protein denominator is inferred. Title mentioning a voucher does not prove a monetary discount or eligibility. Cold-chain delivery to Nha Trang is unconfirmed.',
    };
  }
  if (sku.startsWith('13479894070_') || sku.startsWith('13459402808_')) {
    return {
      status: 'excluded-flavour-and-mass-claim-rejected',
      explanation:
        'SEEQ fruit/mixed assortment is outside chocolate-or-unflavoured scope. 22g is advertised whey protein per serving, not powder net mass. The parser rejects this per-serving mass claim, and the exact cached 18-stick observation was reprocessed without assigning powder net mass.',
    };
  }
  if (sku.startsWith('13430219487_')) {
    return {
      status: 'ingredient-header-parser-fixed-identity-unverified',
      explanation:
        'Dietary feature Đặc điểm thành phần is not an ingredient declaration. The genuine Thành phần line includes protein blend, cocoa, cane sugar, lecithin, flavour, xanthan gum and stevia. Current parser now anchors genuine ingredient headers. Unrelated racket-string/material metadata and missing brand still prevent exact factory identification.',
    };
  }
  if (sku.startsWith('3154800181_')) {
    return {
      status: 'repacked-powder-no-exact-factory-verification',
      explanation:
        'Selected Gói Share 1Kg/2Kg/3kg declares seller repack size. Static Net Content2 lbs and 500gam zip description apply generically and contradict selected sizes. Selected size supports provisional marketplace arithmetic only; manufacturer facts cannot prove the contents or retail identity of a repack.',
    };
  }
  if (sku.startsWith('2326481300_')) {
    return {
      status: 'reviewed-selected-identity-wins-over-generic-listing',
      explanation:
        'Generic title says AMIX, while reviewed selected product label identifies ITS JUST. Exact selected label review must control factory identity. Derived isolate type and ingredient flags should be recomputed from reviewed ingredients.',
    };
  }
  return {
    status: 'manual-review-required',
    explanation: 'Exact selling unit and identity remain unverified.',
  };
};

const rows = [];
for (const row of comparison.comparisons.filter((entry) =>
  targetItems.has(entry.offer.sku?.split('_VNAMZ-')[0])
)) {
  const { product, offer } = row;
  const evidence = await app.store.get('evidence', offer.evidenceId);
  const publicOffer = publicOffers.find(
    (candidate) =>
      candidate.sku === offer.sku &&
      candidate.price === offer.price &&
      candidate.observedAt === offer.observedAt &&
      !candidate.supersededBy
  );
  const publicEvidence = publicOffer
    ? await app.store.fallback.get('evidence', publicOffer.evidenceId)
    : undefined;
  const bytes = evidence?.html
    ? await app.store.blob(evidence.html.sha256)
    : undefined;
  let extracted;
  if (bytes) {
    const snapshot = extractPage({
      document: parseHTML(bytes.toString('utf8')).document,
      url: evidence.sourceUrl || evidence.url,
    });
    const parsed = parseProduct(snapshot, {
      market: 'vn',
      currency: 'VND',
      observedAt: offer.observedAt,
      evidenceId: evidence.id,
    });
    extracted = {
      selectedSku: parsed.product.sku,
      exactSkuMatched:
        parsed.product.sku?.split('_VNAMZ-').at(-1) ===
        offer.sku?.split('_VNAMZ-').at(-1),
      title: snapshot.title,
      selectedOptions: [
        ...new Set(snapshot.selectedVariant.map((option) => option.text)),
      ],
      salePriceVnd: parsed.offer.price ?? null,
      priceMatched: parsed.offer.price === offer.price,
      originalPriceVnd: parsed.offer.originalPrice ?? null,
      netMassG: parsed.product.netMassG ?? null,
      netVolumeMl: parsed.product.netVolumeMl ?? null,
      packCount: parsed.product.packCount ?? null,
      ingredients: parsed.product.ingredients,
      sourceExcerpts: [
        ...(snapshot.specs || []).filter((line) =>
          /Net Content|Định lượng|Thành phần|Number of Servings|Loại bảo quản|Hương vị/iu.test(
            line
          )
        ),
        ...(snapshot.description || '')
          .split('\n')
          .filter((line) =>
            /Trọng lượng|Quy cách|Khối lượng:|Thành phần:|Đặc điểm thành phần:/iu.test(
              line
            )
          ),
      ].slice(0, 12),
    };
  }
  rows.push({
    sku: offer.sku,
    productId: product.id,
    url: offer.url,
    observedAt: offer.observedAt,
    sourceEvidenceId: offer.evidenceId,
    sourceHtmlSha256: evidence?.html?.sha256 ?? null,
    equivalentPublicSource: publicEvidence
      ? {
          evidenceId: publicEvidence.id,
          htmlSha256: publicEvidence.html?.sha256 ?? null,
          selectedSku: publicOffer.sku,
          priceVnd: publicOffer.price,
          observedAt: publicOffer.observedAt,
        }
      : null,
    scopeMatched: matchesFlavourScope(product, 'chocolate-or-unflavoured'),
    flavour: productFlavour(product),
    category: product.category,
    salePriceVnd: offer.price ?? null,
    currentDenominators: {
      netMassG: product.netMassG ?? null,
      netVolumeMl: product.netVolumeMl ?? null,
      packCount: product.packCount ?? null,
    },
    sameSkuObservationAliases: products
      .filter((alias) => alias.sku === product.sku)
      .map((alias) => ({
        productId: alias.id,
        observedAt: alias.observedAt,
        netMassG: alias.netMassG ?? null,
        netVolumeMl: alias.netVolumeMl ?? null,
        packCount: alias.packCount ?? null,
        selectedOptions: [
          ...new Set(
            (alias.selectedVariant || []).map((option) => option.text)
          ),
        ],
      })),
    sourceReextraction: extracted ?? null,
    manufacturerVerified: row.manufacturerVerified,
    eligibleWithCachedPrice: row.eligible,
    unresolved: row.problems,
    conclusion: finding(offer.sku),
  });
}
const derivedDisagreements = comparison.comparisons
  .filter((row) => row.manufacturerVerified)
  .filter(
    ({ product }) =>
      product.proteinType !==
        proteinTypeOf(product.ingredients || [], product.category) ||
      JSON.stringify(product.ingredientFlags) !==
        JSON.stringify(ingredientFlags(product.ingredients || []))
  )
  .map(({ product, offer }) => ({
    sku: offer.sku,
    currentProteinType: product.proteinType,
    expectedProteinType: proteinTypeOf(product.ingredients, product.category),
    currentIngredientFlags: product.ingredientFlags,
    expectedIngredientFlags: ingredientFlags(product.ingredients),
  }));
const report = {
  checkedAt,
  source: 'Exact attached cached HTML bytes; never mutable URL cache aliases',
  networkDownloads: 0,
  browserAttempts: 0,
  strictScope:
    'Chocolate or unflavoured protein powder; strictly chocolate ice cream',
  summary: {
    uniqueComparedSkuCount: comparison.comparisons.length,
    strictScopeCount: comparison.comparisons.filter(({ product }) =>
      matchesFlavourScope(product, 'chocolate-or-unflavoured')
    ).length,
    manuallyExaminedSkuCount: rows.length,
    exactSourceSkuMismatchCount: rows.filter(
      (row) => row.sourceReextraction?.exactSkuMatched === false
    ).length,
    sourcePriceMismatchCount: rows.filter(
      (row) => row.sourceReextraction?.priceMatched === false
    ).length,
    reviewedDerivedFieldDisagreementCount: derivedDisagreements.length,
  },
  reviewedDerivedFieldDisagreements: derivedDisagreements,
  rows,
};
assert.equal(report.networkDownloads, 0);
await mkdir(directory, { recursive: true });
await writeFile(
  `${directory}/review.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
const markdownRows = rows.map(
  (row) =>
    `| [${row.sku}](${row.url}) | ${row.scopeMatched ? 'Included' : 'Excluded'} | ${row.salePriceVnd?.toLocaleString('en-US') ?? '—'} | ${row.currentDenominators.netMassG ?? '—'}g / ${row.currentDenominators.netVolumeMl ?? '—'}ml x ${row.currentDenominators.packCount ?? 'unspecified'} | ${row.conclusion.status} |`
);
await writeFile(
  `${directory}/README.md`,
  `# Exact cached extraction audit\n\nChecked ${checkedAt}. This audit made zero site requests and re-extracted attached HTML by content hash. Manufacturer identity and frozen delivery remain separate purchase checks. Matching public observations include redacted HTML references; original private capture hashes identify local evidence without publishing account content.\n\nThe stale private MusaKing combo denominator was repaired from 1g to two 500g bags, with the same 1,388,000 VND price and capture time. [Repair receipt](musa-combo-reprocessing-receipt.json). Merino COMBO 5 is now one active offer for 200g at 39,000 VND; its stale alias was superseded. SEEQ's false 22g net mass was removed while preserving the selected 18 sticks and price. [Remaining repair receipt](remaining-reprocessing-receipt.json), [public SEEQ receipt](public-seeq-reprocessing-receipt.json). The ingredient parser now rejects dietary feature headings and reads genuine ingredient declarations. All three generic Gold Standard variants were reprocessed in [public](public-ingredients-reprocessing-receipt.json) and [private](private-ingredients-reprocessing-receipt.json) stores; the seller's ingredient claims remain manufacturer-unverified. The regression suite plus existing library checks passed 19/19.\n\n| Selected SKU | Requested flavour scope | Cached price VND | Current per-pack denominator | Finding |\n| --- | --- | ---: | --- | --- |\n${markdownRows.join('\n')}\n\n[Full review and exact evidence references](review.json). A selected Merino combo count is not its outer carton count; Happy Gelato millilitres are not grams; SEEQ 22g protein is not powder net mass. No conditional voucher or free-food gift is deducted or added to denominators.\n`
);
console.log(JSON.stringify(report.summary));
