function imageIdentity(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) {
      return undefined;
    }
    // Observed Lazada gallery URLs resize the same original asset. Keep
    // origin, query and all other path components to avoid matching siblings.
    if (/(?:^|\.)(?:lazcdn\.com|slatic\.net)$/u.test(url.hostname)) {
      url.pathname = url.pathname.replace(
        /(\.(?:jpg|jpeg|png|webp))_\d+x\d+q\d+\.(?:jpg|jpeg|png|webp)(?:_\.webp)?$/u,
        '$1'
      );
    }
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function skuIdentity(value) {
  const parts = String(value || '')
    .trim()
    .split('_VNAMZ-');
  if (parts.length > 2 || parts.some((part) => !part)) {
    return undefined;
  }
  return {
    sku: parts.at(-1),
    listing: parts.length === 2 ? parts[0] : undefined,
  };
}

function displayedSku(snapshot, productSku) {
  const expected = skuIdentity(productSku);
  const identities = [
    snapshot.sku,
    ...(snapshot.selectedVariant || []).map((option) => option.sku),
  ]
    .filter(Boolean)
    .map(skuIdentity);
  const displayed = identities[0];
  const listing =
    expected?.listing ||
    identities.find((identity) => identity?.listing)?.listing;
  if (
    !expected ||
    !displayed ||
    identities.some(
      (identity) =>
        !identity ||
        identity.sku !== expected.sku ||
        (identity.listing && listing && identity.listing !== listing)
    )
  ) {
    return undefined;
  }
  return { sku: displayed.sku, listing };
}

export function selectedPackageImage(snapshot, product, imageUrl) {
  if (snapshot.skuCatalogObserved !== true || !product.sku) {
    return undefined;
  }
  const displayed = displayedSku(snapshot, product.sku);
  if (!displayed) {
    return undefined;
  }
  const matches = snapshot.skuCatalog?.filter(
    (entry) => skuIdentity(entry.sku)?.sku === displayed.sku
  );
  // Contradictory duplicate catalog entries cannot establish an exact package.
  if (matches?.length !== 1) {
    return undefined;
  }
  const selected = matches[0];
  const catalogIdentity = skuIdentity(selected.sku);
  if (
    catalogIdentity.listing &&
    displayed.listing &&
    catalogIdentity.listing !== displayed.listing
  ) {
    return undefined;
  }
  const image = imageIdentity(imageUrl);
  if (!selected?.image || !image || image !== imageIdentity(selected.image)) {
    return undefined;
  }
  return { sku: product.sku, catalogSku: selected.sku, image: selected.image };
}
