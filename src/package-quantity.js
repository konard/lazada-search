import { fold, normalizeText } from './text.js';
import { packCountOf } from './nutrition.js';

const carton = /\b(?:thung|cartons?|cases?)\b/u;
const single =
  /\b(?:single|individual)\b|\b(?:chai|cay|que|hop|ly|goi|tui|bottle|bar|stick|cup|bag)\s+le\b/u;

function cartonText(value) {
  return fold(value || '').replace(/\b(thung|carton)(?=\d)/gu, '$1 ');
}

function describedCarton(description) {
  const counts = [];
  for (const line of String(description || '').split('\n')) {
    const text = cartonText(line);
    if (
      carton.test(text) &&
      /(?:quy cach|pack(?:ing|age)?|carton|case)|\/\s*thung/u.test(text)
    ) {
      const packCount = packCountOf(line);
      if (packCount) {
        counts.push({ packCount, excerpt: normalizeText(line) });
      }
    }
  }
  return new Set(counts.map((count) => count.packCount)).size === 1
    ? counts[0]
    : {};
}

function innerCartonCount(selectedText, title, description) {
  const selectedCount = packCountOf(selectedText);
  if (selectedCount) {
    return { packCount: selectedCount, excerpt: normalizeText(selectedText) };
  }
  const titleCount = packCountOf(title);
  if (carton.test(cartonText(title)) && titleCount) {
    return { packCount: titleCount, excerpt: normalizeText(title) };
  }
  return describedCarton(description);
}

function cartonCount(selectedText, title, description) {
  const countText = carton.test(cartonText(selectedText))
    ? selectedText
    : title;
  const cartons = Number(
    cartonText(countText).match(
      /\b(\d+)\s*(?:thung|cartons?|cases?)\b/u
    )?.[1] || 1
  );
  const inner = innerCartonCount(selectedText, title, description);
  const packCount = inner.packCount * cartons;
  if (!Number.isSafeInteger(packCount) || packCount <= 0) {
    return {
      unresolved: true,
      excerpt: normalizeText(selectedText || title),
      warning:
        'The selected carton has no confirmed count of inner food packages',
    };
  }
  return {
    packCount,
    excerpt: [...new Set([selectedText, inner.excerpt].filter(Boolean))]
      .map(normalizeText)
      .join('; '),
  };
}

// A factory carton specification only supplies the selected selling quantity
// when the selected option or title actually sells that carton.
export function sellingPackCount({
  selectedText = '',
  title = '',
  description = '',
}) {
  const selected = cartonText(selectedText);
  const selectedCount = packCountOf(selectedText);
  if (!carton.test(selected) && (selectedCount || single.test(selected))) {
    return {
      packCount: selectedCount || 1,
      excerpt: normalizeText(selectedText),
    };
  }
  if (carton.test(selected) || carton.test(cartonText(title))) {
    return cartonCount(selectedText, title, description);
  }
  const titleCount = packCountOf(title);
  return titleCount
    ? { packCount: titleCount, excerpt: normalizeText(title) }
    : {};
}

export function resolvePackageCountReview(product) {
  if (
    product.packageCountUnresolved &&
    product.reviewedFields?.includes('packCount') &&
    product.claims?.some(
      (claim) =>
        claim.field === 'packCount' &&
        claim.value === product.packCount &&
        !claim.requiresReview &&
        ['manual-review', 'manufacturer'].includes(claim.source) &&
        product.evidenceIds?.includes(claim.evidenceId)
    )
  ) {
    delete product.packageCountUnresolved;
  }
}
