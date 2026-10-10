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

export function selectedPackageImage(snapshot, product, imageUrl) {
  if (snapshot.skuCatalogObserved !== true || !product.sku) {
    return undefined;
  }
  const skuNumber = (value) =>
    String(value || '')
      .split('_VNAMZ-')
      .at(-1);
  const identities = [
    snapshot.sku,
    ...(snapshot.selectedVariant || []).map((option) => option.sku),
  ]
    .filter(Boolean)
    .map(skuNumber);
  const displayed = identities[0];
  if (
    !displayed ||
    new Set(identities).size !== 1 ||
    displayed !== skuNumber(product.sku)
  ) {
    return undefined;
  }
  const selected = snapshot.skuCatalog?.find(
    (entry) => skuNumber(entry.sku) === displayed
  );
  const image = imageIdentity(imageUrl);
  if (!selected?.image || !image || image !== imageIdentity(selected.image)) {
    return undefined;
  }
  return { sku: product.sku, catalogSku: selected.sku, image: selected.image };
}
