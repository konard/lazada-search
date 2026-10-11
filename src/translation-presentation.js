import { sha256 } from './util.js';
import { translationReviewAccepted } from './translation-quality.js';
import {
  createChunkPresentationReader,
  MAX_PRESENTATION_BYTES,
} from './translation-presentation-chunks.js';

function presentationStatus(result, reviewed, options, needsChunks) {
  if (reviewed) {
    return 'reviewed';
  }
  if (result) {
    return options.requireReviewed === false
      ? 'preview-unreviewed'
      : 'review-pending';
  }
  return needsChunks ? 'translation-needs-chunk-review' : 'translation-pending';
}

async function presentationResult(
  text,
  context,
  reader,
  entities,
  plannedOnly
) {
  const { translator, options, chunks } = reader;
  const needsChunks = Buffer.byteLength(text, 'utf8') > MAX_PRESENTATION_BYTES;
  const planned =
    !needsChunks && (!plannedOnly || (await chunks.planned(text, context)));
  let result =
    needsChunks || !planned
      ? undefined
      : await translator.cached(text, {
          sourceLanguage: options.sourceLanguage || 'vi',
          targetLanguage: options.targetLanguage || 'en',
          protectedEntities: entities,
        });
  if (
    result &&
    Buffer.byteLength(result.translatedText, 'utf8') > MAX_PRESENTATION_BYTES
  ) {
    result = undefined;
  }
  let reviewed = result && translationReviewAccepted(result);
  if (!needsChunks && !reviewed && planned) {
    const assembled = await chunks.assemble(text, context, entities);
    if (assembled) {
      result = assembled;
      reviewed = true;
    }
  }
  return { result, reviewed, needsChunks };
}

function translationMetadata(result) {
  if (!result) {
    return {};
  }
  return {
    translationId: result.id,
    translatedSha256: result.translatedSha256,
    providerId: result.providerId,
    providerVersion: result.providerVersion,
    qualityFingerprint: result.qualityChecks.fingerprint,
    ...(result.chunkProof ? { chunkProof: result.chunkProof } : {}),
  };
}

async function present(text, context, reader, entities, plannedOnly = false) {
  if (typeof text !== 'string' || !text.trim()) {
    return undefined;
  }
  const { result, reviewed, needsChunks } = await presentationResult(
    text,
    context,
    reader,
    entities,
    plannedOnly
  );
  const { options } = reader;
  const usable = Boolean(
    result && (reviewed || options.requireReviewed === false)
  );
  return {
    originalText: text,
    sourceSha256: sha256(Buffer.from(text, 'utf8')),
    text: usable ? result.translatedText : text,
    language: usable ? result.targetLanguage : options.sourceLanguage || 'vi',
    status: presentationStatus(result, reviewed, options, needsChunks),
    presentationOnly: true,
    authoritative: false,
    ...translationMetadata(result),
  };
}

async function productPresentation(product, reader) {
  const entities = product.brand ? [product.brand] : [];
  const output = {
    presentationOnly: true,
    authoritative: false,
    evidenceIds: [...(product.evidenceIds || [])],
  };
  for (const field of ['title', 'description']) {
    output[field] = await present(
      product[field],
      { sourceKind: 'product', sourceRecordId: product.id, path: [field] },
      reader,
      entities
    );
  }
  output.ingredients = await Promise.all(
    (product.ingredients || []).map((text, index) =>
      present(
        text,
        {
          sourceKind: 'product',
          sourceRecordId: product.id,
          path: ['ingredients', String(index)],
        },
        reader,
        entities
      )
    )
  );
  output.selectedVariant = await Promise.all(
    (product.selectedVariant || []).map(async (variant, index) => ({
      ...variant,
      presentation: await present(
        variant.text,
        {
          sourceKind: 'product',
          sourceRecordId: product.id,
          path: ['selectedVariant', String(index), 'text'],
        },
        reader,
        entities
      ),
    }))
  );
  return output;
}

const commercialFields = [
  'seller',
  'sellerName',
  'sellerText',
  'shippingText',
  'promotionText',
  'conditions',
  'condition',
  'priceText',
  'originalPriceText',
];

async function offerPresentation(offer, reader) {
  const output = {
    presentationOnly: true,
    authoritative: false,
    evidenceIds: [...(offer.evidenceIds || [])],
    commercialText: [],
  };
  const add = async (text, path) => {
    const presentation = await present(
      text,
      { sourceKind: 'offer', sourceRecordId: offer.id, path },
      reader,
      [],
      true
    );
    if (presentation) {
      output.commercialText.push({ path, presentation });
      if (path.length === 1) {
        output[path[0]] = presentation;
      }
    }
  };
  for (const field of commercialFields) {
    if (Array.isArray(offer[field])) {
      for (const [index, text] of offer[field].entries()) {
        await add(text, [field, String(index)]);
      }
    } else {
      await add(offer[field], [field]);
    }
  }
  for (const [index, promotion] of (offer.promotions || []).entries()) {
    for (const field of ['text', 'conditions', 'condition', 'title', 'name']) {
      await add(promotion?.[field], ['promotions', String(index), field]);
    }
  }
  return output.commercialText.length ? output : undefined;
}

/** Read cached presentation only; preserve every original product and metric. */
export async function applyComparisonTranslations(
  report,
  translator,
  options = {}
) {
  if (!translator?.cached || translator.providerId === 'unconfigured') {
    return report;
  }
  const products = new Map();
  const offers = new Map();
  const reader = {
    translator,
    options,
    chunks: createChunkPresentationReader(translator, options),
  };
  const row = async (original) => {
    if (!original.product) {
      return original;
    }
    const key = JSON.stringify(original.product);
    if (!products.has(key)) {
      products.set(key, productPresentation(original.product, reader));
    }
    const output = {
      ...original,
      product: {
        ...original.product,
        presentation: await products.get(key),
      },
    };
    if (original.offer) {
      const offerKey = JSON.stringify(original.offer);
      if (!offers.has(offerKey)) {
        offers.set(offerKey, offerPresentation(original.offer, reader));
      }
      const presentation = await offers.get(offerKey);
      if (presentation) {
        output.offer = { ...original.offer, presentation };
      }
    }
    return output;
  };
  const result = { ...report };
  for (const field of [
    'comparisons',
    'ranked',
    'excluded',
    'observedPrices',
    'unsortable',
  ]) {
    if (Array.isArray(report[field])) {
      result[field] = await Promise.all(report[field].map(row));
    }
  }
  if (report.bestByCategory) {
    result.bestByCategory = Object.fromEntries(
      await Promise.all(
        Object.entries(report.bestByCategory).map(async ([category, best]) => [
          category,
          best ? await row(best) : best,
        ])
      )
    );
  }
  return result;
}

/** Overlay cached English on exact basket lines without changing quoted totals. */
export async function applyBasketComparisonTranslations(
  report,
  translator,
  options = {}
) {
  if (!translator?.cached || translator.providerId === 'unconfigured') {
    return report;
  }
  const fields = ['observations', 'ranked', 'excluded'].filter((field) =>
    Array.isArray(report[field])
  );
  const baskets = [...new Set(fields.flatMap((field) => report[field]))];
  const { comparisons } = await applyComparisonTranslations(
    { comparisons: baskets.flatMap((basket) => basket.lines || []) },
    translator,
    options
  );
  let offset = 0;
  const translated = new Map(
    baskets.map((basket) => {
      if (!Array.isArray(basket.lines)) {
        return [basket, basket];
      }
      const lines = comparisons.slice(offset, offset + basket.lines.length);
      offset += basket.lines.length;
      return [basket, { ...basket, lines }];
    })
  );
  return {
    ...report,
    ...Object.fromEntries(
      fields.map((field) => [
        field,
        report[field].map((basket) => translated.get(basket)),
      ])
    ),
  };
}
