import { fold } from './text.js';

const chocolate =
  /\b(?:chocolate|chocolat|choco|cocoa|cacao|socola)\b|so\s*co\s*la/u;
const plain =
  /\b(?:unflavou?red|unflavou?r|flavou?rless|plain|natural|original)\b|khong\s*(?:mui|vi)|nguyen\s*vi|tu\s*nhien/u;
const other =
  /\b(?:vanilla|vani|banana|chuoi|strawberry|matcha|coffee|cafe|caramel|mint|peppermint|taro|khoai|durian|sau\s*rieng|coconut|dua|mango|xoai|peach|peanut|almond|hazelnut|pistachio|blueberry|raspberry|orange|lemon|cookies?|oreo|birthday|cheesecake|tiramisu|butterscotch)\b|(?:vi\s*dau|dau\s*tay|tra\s*dao)|3\s*(?:in|trong|vi|[/-])\s*1|ba\s*vi/u;

function outsideChocolateCore(text) {
  if (
    /\bwhite\s*(?:chocolate|ice\s*cream)\b|(?:socola|so\s*co\s*la)\s*trang|\bkem\s*trang\b|\b(?:white|milk|non\s*chocolate)\s*(?:ice\s*cream\s*)?core\b|\b(?:core|loi(?:\s*kem)?|nhan(?:\s*kem)?)\s*(?:is\s*)?(?:white|milk|sua|kem\s*trang|trang)\b/u.test(
      text
    )
  ) {
    return true;
  }
  const coating =
    /\b(?:coated|coating|covered|dipped)\b|\bphu\b|lop\s*(?:vo|phu)|vo\s*(?:socola|so\s*co\s*la|chocolate)/u.test(
      text
    );
  const chocolateCore =
    /\b(?:chocolate|choco|cocoa|cacao|socola|so\s*co\s*la)\s*(?:ice\s*cream|gelato|core)\b|\b(?:ice\s*cream|gelato|kem|core|loi(?:\s*kem)?|nhan)\s*(?:(?:vi|huong)\s*)?(?:chocolate|choco|cocoa|cacao|socola|so\s*co\s*la)\b/u.test(
      text
    );
  // A coating does not establish the flavour of the ice cream underneath.
  return coating && !chocolateCore;
}

function fromText(value, category) {
  const text = fold(value || '')
    .replaceAll('-', ' ')
    .replace(/natural\s*(?:(?:and|&)\s*artificial\s*)?flavou?rs?\b/gu, ' ')
    .replace(/an\s*co\s*tu\s*nhien/gu, ' ');
  if (
    other.test(text) ||
    /hanh\s*nhan|dau\s*phong|peanutbutter|hat\s*dieu|hat\s*de|ca\s*phe|mut\s*dau|nhan\s*(?:cam|dau)|tra\s*xanh|green\s*tea/u.test(
      text
    ) ||
    /dâu/iu.test(value || '') ||
    (category === 'chocolate-ice-cream' &&
      (/\b(?:dau|cam)\b/u.test(text) || outsideChocolateCore(text)))
  ) {
    return 'other';
  }
  if (chocolate.test(text)) {
    return 'chocolate';
  }
  if (plain.test(text)) {
    return 'unflavoured';
  }
  return 'unknown';
}

// Exact manufacturer identity wins over a listing title advertising all flavours.
// Otherwise only selected options identify a SKU; the title is a last resort.
export function productFlavour(product) {
  const verified = product.manufacturerVerification;
  if (
    verified?.identityMatched &&
    verified.sourceAuthority === 'manufacturer'
  ) {
    if (verified.identity?.flavour?.trim()) {
      return fromText(verified.identity.flavour, product.category);
    }
  }
  const selected = (product.selectedVariant || [])
    .map((option) => fromText(option.text, product.category))
    .filter((flavour) => flavour !== 'unknown');
  if (selected.includes('other') || new Set(selected).size > 1) {
    return 'other';
  }
  return selected[0] || fromText(product.title, product.category);
}

export function matchesFlavourScope(product, scope) {
  if (!scope || scope === 'all') {
    return true;
  }
  if (scope !== 'chocolate-or-unflavoured') {
    throw new Error('Unsupported flavour scope');
  }
  if (isShakerBundle(product)) {
    return false;
  }
  const flavour = productFlavour(product);
  if (product.category === 'chocolate-ice-cream') {
    return flavour === 'chocolate';
  }
  return (
    ['whey', 'protein-powder'].includes(product.category) &&
    ['chocolate', 'unflavoured'].includes(flavour)
  );
}

export function isShakerBundle(product) {
  return (product.selectedVariant || []).some((option) =>
    /\bshaker\b|binh\s*(?:lac|shake|bot)|\b(?:co|kem|them)\s*binh\b/u.test(
      fold(option.text || '').replace(
        /\b(?:no|without|khong(?:\s*kem)?)\s*(?:shaker|binh\s*(?:lac|shake|bot)?)/gu,
        ' '
      )
    )
  );
}
