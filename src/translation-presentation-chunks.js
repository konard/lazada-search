import { sha256 } from './util.js';
import {
  checkTranslationQuality,
  translationReviewAccepted,
} from './translation-quality.js';

export const MAX_PRESENTATION_BYTES = 1048576;
const digest = (text) => sha256(Buffer.from(text, 'utf8'));
const fieldKey = ({ sourceKind, sourceRecordId, path, originalSourceSha256 }) =>
  JSON.stringify([sourceKind, sourceRecordId, path, originalSourceSha256]);

function indexSources(records) {
  const fields = new Map();
  for (const record of records) {
    if (!Array.isArray(record.path)) {
      continue;
    }
    const key = fieldKey(record);
    if (!fields.has(key)) {
      fields.set(key, new Map());
    }
    const partitions = fields.get(key);
    const partition = record.chunkPartitionSha256 || 'legacy';
    if (!partitions.has(partition)) {
      partitions.set(partition, []);
    }
    partitions.get(partition).push(record);
  }
  return fields;
}

function validEntities(entities) {
  return (
    entities === undefined ||
    (Array.isArray(entities) &&
      entities.every(
        (entity) =>
          typeof entity === 'string' && entity.trim() && entity.length <= 512
      ))
  );
}

function validPiece(piece, index, offset, count) {
  return (
    piece.chunkIndex === index &&
    piece.offset === offset &&
    typeof piece.id === 'string' &&
    piece.id &&
    typeof piece.originalText === 'string' &&
    piece.originalText &&
    digest(piece.originalText) === piece.sourceSha256 &&
    validEntities(piece.protectedEntities) &&
    (piece.chunkCount === undefined || piece.chunkCount === count)
  );
}

function validPartition(records, text) {
  if (!records.length || records.length > 256) {
    return undefined;
  }
  const pieces = [...records].sort(
    (left, right) => left.chunkIndex - right.chunkIndex
  );
  let offset = 0;
  for (const [index, piece] of pieces.entries()) {
    if (!validPiece(piece, index, offset, pieces.length)) {
      return undefined;
    }
    offset += piece.originalText.length;
  }
  if (pieces.map((piece) => piece.originalText).join('') !== text) {
    return undefined;
  }
  const partitionSha256 = digest(
    JSON.stringify(pieces.map((piece) => [piece.offset, piece.sourceSha256]))
  );
  if (
    pieces.some(
      (piece) =>
        piece.chunkPartitionSha256 &&
        piece.chunkPartitionSha256 !== partitionSha256
    )
  ) {
    return undefined;
  }
  return { pieces, partitionSha256 };
}

function validReview(result, piece, translator, options) {
  return Boolean(
    result &&
    translationReviewAccepted(result) &&
    [
      [result.sourceSha256, piece.sourceSha256],
      [result.providerId, translator.providerId],
      [result.providerVersion, translator.providerVersion],
      [result.sourceLanguage, options.sourceLanguage || 'vi'],
      [result.targetLanguage, options.targetLanguage || 'en'],
    ].every(([actual, expected]) => actual === expected) &&
    typeof result.translatedText === 'string' &&
    digest(result.translatedText) === result.translatedSha256 &&
    typeof result.review.reviewer === 'string' &&
    result.review.reviewer.trim() &&
    Number.isFinite(Date.parse(result.review.reviewedAt))
  );
}

async function reviewedPieces(partition, translator, options, entities) {
  const translated = [];
  let size = 0;
  for (const piece of partition.pieces) {
    if (
      Buffer.byteLength(piece.originalText, 'utf8') > MAX_PRESENTATION_BYTES
    ) {
      return undefined;
    }
    const result = await translator.cached(piece.originalText, {
      sourceLanguage: options.sourceLanguage || 'vi',
      targetLanguage: options.targetLanguage || 'en',
      protectedEntities: [...entities, ...(piece.protectedEntities || [])],
    });
    if (!validReview(result, piece, translator, options)) {
      return undefined;
    }
    size += Buffer.byteLength(result.translatedText, 'utf8');
    if (size > MAX_PRESENTATION_BYTES) {
      return undefined;
    }
    translated.push({ piece, result });
  }
  return translated;
}

function assemblyResult(text, translated, partition, options, entities) {
  const translatedText = translated
    .map(({ result }) => result.translatedText)
    .join('');
  const qualityChecks = checkTranslationQuality(text, translatedText, {
    sourceLanguage: options.sourceLanguage || 'vi',
    targetLanguage: options.targetLanguage || 'en',
    protectedEntities: entities,
  });
  if (!qualityChecks.passed) {
    return undefined;
  }
  const first = translated[0].result;
  return {
    id: `translation-assembly:${sha256(JSON.stringify([qualityChecks.sourceSha256, partition.partitionSha256, first.providerId, first.providerVersion, first.sourceLanguage, first.targetLanguage, qualityChecks.translatedSha256, qualityChecks.fingerprint]))}`,
    translatedText,
    sourceSha256: qualityChecks.sourceSha256,
    translatedSha256: qualityChecks.translatedSha256,
    providerId: first.providerId,
    providerVersion: first.providerVersion,
    sourceLanguage: first.sourceLanguage,
    targetLanguage: first.targetLanguage,
    qualityChecks,
    reviewedChunks: true,
    chunkProof: {
      sourceKind: translated[0].piece.sourceKind,
      sourceRecordId: translated[0].piece.sourceRecordId,
      path: [...translated[0].piece.path],
      originalSourceSha256: qualityChecks.sourceSha256,
      chunkPartitionSha256: partition.partitionSha256,
      chunks: translated.map(({ piece, result }) => ({
        sourceId: piece.id,
        chunkIndex: piece.chunkIndex,
        offset: piece.offset,
        sourceSha256: piece.sourceSha256,
        translationId: result.id,
        translatedSha256: result.translatedSha256,
        qualityFingerprint: result.qualityChecks.fingerprint,
        reviewer: result.review.reviewer,
        reviewedAt: result.review.reviewedAt,
      })),
      assemblyQuality: qualityChecks,
      reviewBasis: 'reviewed-chunks',
    },
  };
}

/** One lazy catalog-source read per overlay; never generate text or write a cache. */
export function createChunkPresentationReader(translator, options) {
  let index;
  const partitions = async (text, context) => {
    if (!context?.sourceRecordId || !translator.store?.list) {
      return [];
    }
    index ||= translator.store
      .list('translation-catalog-source')
      .then(indexSources);
    const source = (await index).get(
      fieldKey({ ...context, originalSourceSha256: digest(text) })
    );
    return source ? [...source.values()] : [];
  };
  return {
    async planned(text, context) {
      return (await partitions(text, context)).some((records) =>
        Boolean(validPartition(records, text))
      );
    },
    async assemble(text, context, entities) {
      if (Buffer.byteLength(text, 'utf8') > MAX_PRESENTATION_BYTES) {
        return undefined;
      }
      for (const records of await partitions(text, context)) {
        const partition = validPartition(records, text);
        if (!partition) {
          continue;
        }
        const translated = await reviewedPieces(
          partition,
          translator,
          options,
          entities
        );
        if (translated) {
          const assembled = assemblyResult(
            text,
            translated,
            partition,
            options,
            entities
          );
          if (assembled) {
            return assembled;
          }
        }
      }
      return undefined;
    },
  };
}
