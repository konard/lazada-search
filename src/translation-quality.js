import { readFile } from 'node:fs/promises';
import { sha256 } from './util.js';
import { fold } from './text.js';

// Reviews bind to the actual checker bytes, including its vocabulary and rules.
export const TRANSLATION_QUALITY_FINGERPRINT = sha256(
  await readFile(new URL('./translation-quality.js', import.meta.url))
);

const numberPattern = /\d+(?:[.,]\d+)*(?:[\u00a0 ]\d{3})*/gu;
const leadingNumber = /^\d+(?:[.,]\d+)*(?:[\u00a0 ]\d{3})*/u;
const unitPattern =
  /^(kilograms?|kilogam|kg|milligrams?|mg|grams?|gam|g|millilit(?:res?|ers?)|ml|lit(?:res?|ers?)|lit|l|kcal|cal|kj|percent|per cent|%|vnd|₫|d|dong|lbs?|pounds?|oz|ounces?|pieces?|chiec|cai|sticks?|que|cay|bags?|tui|box(?:es)?|hop|cartons?|thung|bottles?|chai|cans?|lon|days?|ngay|months?|thang|years?|nam|hours?|gio|minutes?|phut|servings?|portions?|khau phan|lan dung|scoops?|muong)(?![\p{L}])/u;
const unitGroups = [
  ['kg', /^(?:kilograms?|kilogam|kg)$/u],
  ['mg', /^(?:milligrams?|mg)$/u],
  ['g', /^(?:grams?|gam|g)$/u],
  ['ml', /^(?:millilit(?:res?|ers?)|ml)$/u],
  ['l', /^(?:lit(?:res?|ers?)|lit|l)$/u],
  ['%', /^(?:percent|per cent|%)$/u],
  ['VND', /^(?:vnd|₫|d|dong)$/u],
  ['lb', /^(?:lbs?|pounds?)$/u],
  ['oz', /^(?:oz|ounces?)$/u],
  ['piece', /^(?:pieces?|chiec|cai)$/u],
  ['stick', /^(?:sticks?|que|cay)$/u],
  ['bag', /^(?:bags?|tui)$/u],
  ['box', /^(?:box(?:es)?|hop)$/u],
  ['carton', /^(?:cartons?|thung)$/u],
  ['bottle', /^(?:bottles?|chai)$/u],
  ['can', /^(?:cans?|lon)$/u],
  ['day', /^(?:days?|ngay)$/u],
  ['month', /^(?:months?|thang)$/u],
  ['year', /^(?:years?|nam)$/u],
  ['hour', /^(?:hours?|gio)$/u],
  ['minute', /^(?:minutes?|phut)$/u],
  ['serving', /^(?:servings?|portions?|khau phan|lan dung)$/u],
  ['scoop', /^(?:scoops?|muong)$/u],
];

function numericValue(raw, language) {
  let value = raw.replace(/[\u00a0 ]/gu, '');
  const decimal = language.startsWith('vi') ? ',' : '.';
  const group = decimal === ',' ? '.' : ',';
  if (value.includes('.') && value.includes(',')) {
    value = value.replaceAll(group, '').replace(decimal, '.');
  } else if (value.includes(group)) {
    // Single non-group-sized fractions also occur in imported package labels.
    value = /^\d{1,3}(?:[.,]\d{3})+$/u.test(value)
      ? value.replaceAll(group, '')
      : value.replace(group, '.');
  } else {
    value = value.replace(decimal, '.');
  }
  if (!/^\d+(?:\.\d+)?$/u.test(value)) {
    return `unresolved:${raw}`;
  }
  const [whole, fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/u, '');
  return `${whole.replace(/^0+(?=\d)/u, '')}${normalizedFraction ? `.${normalizedFraction}` : ''}`;
}

function textFacts(text, language) {
  const normalized = fold(text);
  const numbers = [],
    quantities = [],
    ratios = [];
  for (const match of normalized.matchAll(numberPattern)) {
    const value = numericValue(match[0], language);
    numbers.push(value);
    const tail = normalized.slice(match.index + match[0].length).trimStart();
    const unit = tail.match(unitPattern)?.[1];
    if (unit) {
      const canonical = unitGroups.find(([, pattern]) => pattern.test(unit));
      quantities.push(`${value}:${canonical?.[0] || unit}`);
      const denominator = tail
        .slice(unit.length)
        .trimStart()
        .replace(/^(?:\/|per\b|tren\b|moi\b)\s*/u, '');
      if (denominator !== tail.slice(unit.length).trimStart()) {
        const amount = denominator.match(leadingNumber)?.[0];
        const denominatorUnit =
          amount &&
          denominator.slice(amount.length).trimStart().match(unitPattern)?.[1];
        if (denominatorUnit) {
          const basis =
            unitGroups.find(([, pattern]) =>
              pattern.test(denominatorUnit)
            )?.[0] || denominatorUnit;
          ratios.push(
            `${value}:${canonical?.[0] || unit}/${numericValue(amount, language)}:${basis}`
          );
        }
      }
    }
  }
  return {
    numbers: numbers.sort(),
    quantities: quantities.sort(),
    ratios: ratios.sort(),
  };
}

function automaticEntities(text) {
  const entities = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gu)) {
    entities.push(match[0].replace(/[),.;]+$/u, ''));
  }
  for (const match of text.matchAll(
    /(?<![\p{L}\p{N}_])[A-Za-z\d][A-Za-z\d_-]{1,}(?![\p{L}\p{N}_])/gu
  )) {
    const token = match[0];
    const suffix = fold(token.replace(/^\d+/u, ''));
    const isQuantity =
      /^\d/u.test(token) && suffix.match(unitPattern)?.[0] === suffix;
    if (/[A-Za-z]/u.test(token) && /\d/u.test(token) && !isQuantity) {
      entities.push(token);
    }
  }
  for (const match of text.matchAll(/(?<!\d)\d{8,18}(?!\d)/gu)) {
    entities.push(match[0]);
  }
  return entities;
}

export function translationEntities(text, supplied = []) {
  if (
    !Array.isArray(supplied) ||
    supplied.some(
      (item) => typeof item !== 'string' || !item.trim() || item.length > 512
    )
  ) {
    throw new Error('Protected translation entities must be nonempty strings');
  }
  const sourceTerms = supplied.flatMap((entity) =>
    [
      ...text.matchAll(
        new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
      ),
    ].map((match) => match[0])
  );
  return [...new Set([...automaticEntities(text), ...sourceTerms])].sort();
}

const negativeClaims = [
  [
    /\bkhong duong\b/u,
    /\b(?:no sugar|sugar[ -]free|unsweetened|khong duong)\b/u,
  ],
  [
    /\bkhong huong vi\b/u,
    /\b(?:unflavou?red|no flavou?r|plain|khong huong vi)\b/u,
  ],
  [
    /\bkhong (?:binh|shaker)\b/u,
    /\b(?:(?:no|without) (?:bottle|shaker)|(?:bottle|shaker) (?:excluded|not included)|khong (?:binh|shaker))\b/u,
  ],
  [
    /\bkhong (?:ho tro )?giao\b/u,
    /\b(?:no delivery|cannot deliver|does not deliver|not deliver|delivery (?:unavailable|not available)|khong (?:ho tro )?giao)\b/u,
  ],
  [
    /\b(?:het hang|khong con hang)\b/u,
    /\b(?:out of stock|sold out|unavailable|het hang|khong con hang)\b/u,
  ],
];

/** These deterministic guards detect unsafe text; they do not prove fluency or facts. */
export function checkTranslationQuality(
  originalText,
  translatedText,
  { sourceLanguage = 'vi', targetLanguage = 'en', protectedEntities = [] } = {}
) {
  const original = textFacts(originalText, sourceLanguage);
  const translated = textFacts(translatedText, targetLanguage);
  const entities = translationEntities(originalText, protectedEntities);
  const issues = [];
  if (JSON.stringify(original.numbers) !== JSON.stringify(translated.numbers)) {
    issues.push('number-mismatch');
  }
  if (
    JSON.stringify(original.quantities) !==
    JSON.stringify(translated.quantities)
  ) {
    issues.push('quantity-unit-mismatch');
  }
  if (JSON.stringify(original.ratios) !== JSON.stringify(translated.ratios)) {
    issues.push('nutrition-basis-mismatch');
  }
  if (entities.some((entity) => !translatedText.includes(entity))) {
    issues.push('protected-entity-mismatch');
  }
  if (
    sourceLanguage.startsWith('vi') &&
    targetLanguage.startsWith('en') &&
    negativeClaims.some(
      ([source, target]) =>
        source.test(fold(originalText)) && !target.test(fold(translatedText))
    )
  ) {
    issues.push('negative-condition-mismatch');
  }
  return {
    fingerprint: TRANSLATION_QUALITY_FINGERPRINT,
    sourceSha256: sha256(Buffer.from(originalText, 'utf8')),
    translatedSha256: sha256(Buffer.from(translatedText, 'utf8')),
    passed: issues.length === 0,
    issues,
    protectedEntities: entities,
    semanticAccuracyApproved: false,
  };
}

export function translationReviewAccepted(record) {
  const review = record.review;
  return Boolean(
    record.qualityChecks?.passed &&
    record.qualityChecks.fingerprint === TRANSLATION_QUALITY_FINGERPRINT &&
    review?.status === 'approved' &&
    review.sourceSha256 === record.sourceSha256 &&
    review.translatedSha256 === record.translatedSha256 &&
    review.qualityFingerprint === record.qualityChecks.fingerprint
  );
}
