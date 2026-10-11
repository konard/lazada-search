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

function publishedAsset(value) {
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      (!/(?:^|\.)(?:lazcdn\.com|slatic\.net)$/u.test(url.hostname) &&
        url.hostname !== 'laz-img-sg.alicdn.com')
    ) {
      return undefined;
    }
    const asset = url.pathname.match(
      /^\/(?:g\/)?p\/([a-f\d]{32})\.(jpg|jpeg|png|webp)(?:_webp)?(?:_\d+x\d+q\d+\.(?:jpg|jpeg|png|webp)(?:_\.webp)?)?$/u
    );
    return asset && `${url.protocol}${asset[1]}.${asset[2]}${url.search}`;
  } catch {
    return undefined;
  }
}

function samePublishedImage(left, right, snapshot) {
  const image = imageIdentity(right);
  if (image && image === imageIdentity(left)) {
    return true;
  }
  // Exact hash-shaped asset aliases are observed together in saved Lazada
  // catalog/gallery data. Arbitrary CDN hosts, basenames and queries still
  // cannot establish an alias. Original OCR bytes retain a separate digest.
  const asset = publishedAsset(right);
  return Boolean(
    asset &&
    asset === publishedAsset(left) &&
    [...(snapshot.productImages || []), ...(snapshot.images || [])].some(
      (url) => imageIdentity(url) === image
    )
  );
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

export function selectedPackageArtwork(snapshot, product, imageUrl) {
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
  if (
    !selected?.image ||
    !samePublishedImage(selected.image, imageUrl, snapshot)
  ) {
    return undefined;
  }
  const sharedSkuIds = [
    ...new Set(
      snapshot.skuCatalog
        .filter((entry) => samePublishedImage(entry.image, imageUrl, snapshot))
        .map((entry) => skuIdentity(entry.sku)?.sku)
        .filter(Boolean)
    ),
  ];
  return {
    sku: product.sku,
    catalogSku: selected.sku,
    image: selected.image,
    sharedSkuIds,
  };
}

export function selectedPackageImage(snapshot, product, imageUrl) {
  const artwork = selectedPackageArtwork(snapshot, product, imageUrl);
  // A seller's reused front cannot attest which flavour/size it depicts.
  if (!artwork || artwork.sharedSkuIds.length !== 1) {
    return undefined;
  }
  const { sku, catalogSku, image } = artwork;
  return { sku, catalogSku, image };
}
