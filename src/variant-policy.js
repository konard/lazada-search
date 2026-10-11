import { fold } from './text.js';
import { categoryOf } from './nutrition.js';
import { productFlavour, isShakerBundle } from './flavour-scope.js';
import { targetCategoryExclusion } from './target-category.js';

export const VARIANT_POLICY_VERSION = 1;

export function requestedSku(url) {
  const parsed = new URL(url);
  const value =
    parsed.searchParams.get('skuId') ||
    parsed.pathname.match(/-s(\d+)\.html$/u)?.[1];
  return value?.split('_VNAMZ-').at(-1);
}

// A listing title describes many siblings. Choose from complete SKU combinations,
// never by clicking a flavour and retaining an unrelated accessory selection.
export function preferredVariant(snapshot, flavourScope = 'all') {
  if (flavourScope === 'all') {
    return undefined;
  }
  if (flavourScope !== 'chocolate-or-unflavoured') {
    throw new Error('Unsupported flavour scope');
  }
  const title = snapshot.title || '';
  const category =
    categoryOf(`${title} chocolate`) === 'chocolate-ice-cream'
      ? 'chocolate-ice-cream'
      : categoryOf(title);
  const candidates = (snapshot.skuCatalog || []).flatMap((entry, index) => {
    const selectedVariant = (entry.options || []).map((option) => ({
      text: option.value,
    }));
    const labels = selectedVariant.map((option) => option.text).join(' ');
    const product = { category, title: '', selectedVariant };
    const flavour = productFlavour(product);
    if (
      !['chocolate', 'unflavoured'].includes(flavour) ||
      (category === 'chocolate-ice-cream' && flavour !== 'chocolate') ||
      isShakerBundle(product) ||
      targetCategoryExclusion(labels)
    ) {
      return [];
    }
    // Only an explicitly labelled no-shaker combination can win when that
    // option exists. Unknown accessories do not mean "without a shaker".
    const noShaker =
      /\b(?:no|without)\s*shaker\b|\bkhong\s*(?:kem\s*)?binh\b/u.test(
        fold(labels)
      );
    return [{ entry, index, flavour, noShaker }];
  });
  const explicitNoShaker = candidates.some((entry) => entry.noShaker);
  return candidates
    .filter((entry) => !explicitNoShaker || entry.noShaker)
    .sort(
      (left, right) =>
        Number(left.entry.available === false) -
          Number(right.entry.available === false) ||
        Number(left.flavour !== 'chocolate') -
          Number(right.flavour !== 'chocolate') ||
        left.index - right.index
    )[0]?.entry;
}

export function cachedVariantMatches(url, snapshot, flavourScope) {
  if (!snapshot) {
    return false;
  }
  const requested = requestedSku(url);
  const expected = requested || preferredVariant(snapshot, flavourScope)?.sku;
  return (
    !expected ||
    String(snapshot?.sku || '')
      .split('_VNAMZ-')
      .at(-1) === String(expected).split('_VNAMZ-').at(-1)
  );
}
