export const normalizeText = (value = '') =>
  String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const fold = (value = '') =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLowerCase();

export function canonicalUrl(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Only HTTP(S) URLs without credentials are supported');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^(?:utm_|spm$|scm$|clickTrackInfo$|laz_trackid$|fbclid$|gclid$)/iu.test(
        key
      )
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.href;
}

// Sorting and page position do not change a category's filter scope.
export function categorySourceKey(value) {
  try {
    const url = new URL(value);
    url.searchParams.delete('sort');
    url.searchParams.delete('page');
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

// Slugs, selected-SKU suffixes and tracking parameters can identify one item.
export function listingKey(value) {
  const url = new URL(canonicalUrl(value));
  const item = url.pathname.match(/-i(\d+)(?:-s\d+)?\.html$/u)?.[1];
  return item && /(?:^|\.)lazada\./u.test(url.hostname)
    ? `${url.hostname.replace(/^www\./u, '')}:item:${item}`
    : url.href;
}
