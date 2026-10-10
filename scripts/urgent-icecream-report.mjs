import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const directory = 'docs/acceptance/urgent-icecream';
const catalogBytes = await readFile('docs/tables/catalog.json');
const catalog = JSON.parse(catalogBytes);
const archive = 'data/cases/vietnam-nha-trang';
const evidence = [];
for (const name of (await readdir(`${archive}/records`)).filter((name) =>
  name.startsWith('evidence.')
)) {
  evidence.push(
    ...JSON.parse(gunzipSync(await readFile(`${archive}/records/${name}`)))
  );
}
function strictScope(product) {
  if (product.url.includes('13430497758')) {
    return {
      status: 'excluded-snack',
      reason:
        'Chocolate confectionery breadcrumb and explicit crunchy snack/cocoa-butter substitute description.',
    };
  }
  if (
    /chuối|khoai môn|cà phê|3 trong 1|vani|dâu socola|mứt dâu|mứt dâu,cam/i.test(
      product.title
    )
  ) {
    return {
      status: 'excluded-mixed-flavour',
      reason:
        'Listing title specifies banana, taro, coffee, vanilla, jam or mixed-flavour ice cream.',
    };
  }
  if (/Aice Socola Giòn/i.test(product.title)) {
    return {
      status: 'excluded-vanilla-core',
      reason:
        'Official Aice page specifies vanilla milk ice cream inside chocolate shell.',
    };
  }
  if (/Miki Miki/i.test(product.title)) {
    return {
      status: 'excluded-vanilla-core',
      reason:
        'Original official Aice Miki-Miki label explicitly states vanilla flavoured ice milk with chocolate; 25g/35ml per stick.',
    };
  }
  if (/hạnh nhân/i.test(product.title)) {
    return {
      status: 'identity-review',
      reason:
        'Chocolate/almond identity and official 53g/66g/70ml conflict remain unresolved.',
    };
  }
  return {
    status: 'preliminary-chocolate-candidate',
    reason:
      'Listing title identifies chocolate; exact manufacturer label and frozen delivery are still unverified.',
  };
}
function shippingDetails(delivery) {
  const quote = delivery && /phí vận chuyển ([\d.]+)\s*₫/.exec(delivery.text);
  const price = quote ? Number(quote[1].replaceAll('.', '')) : null;
  const unavailable = delivery && /không thể giao/.test(delivery.text);
  return {
    price,
    status: unavailable
      ? 'explicitly-unavailable'
      : price !== null
        ? 'standard-quote-cold-chain-unproven'
        : 'not-confirmed',
  };
}
function costPerAmount(price, amount) {
  return price !== null && amount > 0 ? price / amount : null;
}
function soldAmounts(product) {
  const count = product.packCount ?? 1;
  return {
    massG: product.netMassG ? product.netMassG * count : null,
    volumeMl: product.netVolumeMl ? product.netVolumeMl * count : null,
  };
}
const rows = catalog.products
  .filter((product) => product.category === 'chocolate-ice-cream')
  .map((product) => {
    const offer = catalog.offers
      .filter((offer) => offer.productId === product.id && !offer.supersededBy)
      .sort((a, b) =>
        String(b.observedAt).localeCompare(String(a.observedAt))
      )[0];
    const delivery = evidence
      .filter(
        (record) =>
          record.role === 'delivery' &&
          record.url === product.url &&
          record.shippingDestination === 'Khánh Hòa, Phường Nha Trang'
      )
      .sort((a, b) =>
        String(b.observedAt).localeCompare(String(a.observedAt))
      )[0];
    const shipping = shippingDetails(delivery);
    const shippingVnd = shipping.price;
    const { massG, volumeMl } = soldAmounts(product);
    const totalVnd =
      offer && shippingVnd !== null ? offer.price + shippingVnd : null;
    return {
      productId: product.id,
      sku: product.sku,
      url: product.url,
      title: product.title,
      selectedOptions: [
        ...new Set(
          (product.selectedVariant ?? []).map((variant) => variant.text)
        ),
      ],
      priceVnd: offer?.price ?? null,
      observedAt: offer?.observedAt,
      massG,
      volumeMl,
      provisionalQuantity: true,
      beforeDeliveryVndPerG: costPerAmount(offer?.price ?? null, massG),
      beforeDeliveryVndPerMl: costPerAmount(offer?.price ?? null, volumeMl),
      quotedShippingVnd: shippingVnd,
      quotedTotalVnd: totalVnd,
      quotedVndPerG: costPerAmount(totalVnd, massG),
      quotedVndPerMl: costPerAmount(totalVnd, volumeMl),
      shippingStatus: shipping.status,
      deliveryEvidenceId: delivery?.id ?? null,
      frozenDeliveryConfirmed: false,
      proteinGramsVerified: null,
      scope: strictScope(product),
    };
  })
  .sort((a, b) => a.priceVnd - b.priceVnd);
const report = {
  reviewedAt: new Date().toISOString(),
  destination: 'Nha Trang, Vietnam',
  currency: 'VND',
  sourceCatalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
  scope:
    'strict chocolate; reject mixed flavours, vanilla cores and confectionery',
  rows,
  completeMarketCoverage: false,
  confirmedPurchaseWinners: [],
  notes: [
    'All arithmetic uses cached selected-SKU prices. Prices have not been refreshed by this report.',
    'Generic standard shipping is not evidence of frozen delivery. No bulk freight is extrapolated.',
    'Mass/volume figures remain provisional marketplace quantities; no density is assumed.',
    'Manufacturer protein quantities are not available for these exact SKUs; none is ranked by protein cost.',
  ],
};
await writeFile(
  `${directory}/review.json`,
  `${JSON.stringify(report, null, 2)}\n`
);
const format = (value) =>
  value === null
    ? '—'
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const table = rows
  .map(
    (row) =>
      `| [${row.title}](${row.url}) | ${row.sku} | ${row.selectedOptions.join('; ') || 'default'} | ${format(row.priceVnd)} | ${format(row.quotedShippingVnd)} | ${format(row.quotedTotalVnd)} | ${format(row.massG)} | ${format(row.volumeMl)} | ${format(row.beforeDeliveryVndPerG)} → ${format(row.quotedVndPerG)} | ${format(row.beforeDeliveryVndPerMl)} → ${format(row.quotedVndPerMl)} | ${row.scope.status} | ${row.shippingStatus} |`
  )
  .join('\n');
await writeFile(
  `${directory}/captured-options.md`,
  `# Strict chocolate review of captured ice-cream selling options\n\nCaptured prices are sorted ascending. This review preserves every captured option, including excluded variants. No row is a confirmed Nha Trang frozen-delivery purchase. Dash means no measured value. Unit denominators are provisional until exact package labels are verified. Quoted totals and after-delivery unit arithmetic use a one-package standard-shipping quote; they do not prove a usable frozen delivery service or bulk freight.\n\n| Listing | Selected SKU | Option | Price VND | Quoted freight VND | Quoted total VND | Sold g | Sold ml | VND/g before → quoted after | VND/ml before → quoted after | Scope | Delivery evidence |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |\n${table}\n\n[Machine-readable evidence and calculations](review.json). [Snack quarantine evidence](category-quarantine-recommendation.json).\n`
);
console.log(
  JSON.stringify({
    rows: rows.length,
    preliminaryChocolate: rows.filter(
      (row) => row.scope.status === 'preliminary-chocolate-candidate'
    ).length,
    confirmedWinners: 0,
  })
);
