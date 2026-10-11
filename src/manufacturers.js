import { fold } from './util.js';

// Official domains establish source authority, not a marketplace item's
// authenticity or its exact flavour, net quantity and nutrition identity.
export const MANUFACTURERS = [
  {
    name: 'SFD Nutrition',
    aliases: ['sfd nutrition', 'sfd_nutrition'],
    domains: ['sfdsa.pl', 'sklep.sfd.pl'],
    url: 'https://sklep.sfd.pl/',
    ownershipSource: 'https://sfdsa.pl/',
  },
  {
    name: 'Binggrae',
    aliases: ['binggrae', 'powercap', 'power cap', 'pongta'],
    domains: ['bing.co.kr'],
    url: 'https://www.bing.co.kr/en/product/detail?PDT=57',
  },
  {
    name: 'Lotte',
    aliases: ['lotte', 'fanfare', 'worldcone', 'world cone'],
    domains: ['lottewellfood.com'],
    assetDomains: ['webimage.ldcc.co.kr'],
    url: 'https://www.lottewellfood.com/brand/product?searchType1=LC700',
  },
  {
    name: 'Cremo',
    aliases: ['cremo'],
    domains: ['chomthana.com', 'icecremo.com'],
    url: 'https://www.chomthana.com/products/icecreams/',
    ownershipSource: 'https://www.chomthana.com/products/',
  },
  {
    name: 'Iberri',
    aliases: ['iberri', 'i-berri', 'i berri'],
    domains: ['chomthana.com'],
    url: 'https://www.chomthana.com/products/icecreams/',
    ownershipSource: 'https://www.chomthana.com/products/',
  },
  {
    name: 'Häagen-Dazs',
    aliases: ['haagen dazs', 'haagen-dazs', 'häagen-dazs'],
    domains: ['haagendazs.com.sg'],
    url: 'https://www.haagendazs.com.sg/products/belgian-chocolate-pint',
  },
  {
    name: 'Aice',
    aliases: ['aice'],
    domains: ['aicevietnam.vn'],
    url: 'https://aicevietnam.vn/san-pham/kem-hop-vi-chocolate/',
  },
  {
    name: 'Scitec Nutrition',
    aliases: ['scitec nutrition', 'scitec'],
    domains: ['scitecnutrition.com'],
    url: 'https://scitecnutrition.com/',
  },
  {
    name: "It's Just",
    aliases: ["it's just", 'its just'],
    domains: ['138foods.com'],
    url: 'https://138foods.com/products/its-just-whey-protein-isolate',
  },
  {
    name: 'MusaKing',
    aliases: ['musaking'],
    domains: ['musaking.com'],
    url: 'https://musaking.com/products/whey-isolate',
  },
  {
    name: 'Celano',
    aliases: ['celano'],
    domains: ['ngoinhadinhduong.com'],
    url: 'https://ngoinhadinhduong.com/products/kem-hop-cao-cap-celano-3in1-tiramisu-sua-hat-so-co-la-860ml-500g',
  },
  {
    name: 'Merino',
    aliases: ['merino'],
    domains: ['ngoinhadinhduong.com', 'nutifood.com.vn'],
    url: 'https://ngoinhadinhduong.com/collections/kem-merino',
  },
  {
    name: 'Optimum Nutrition',
    aliases: ['optimum nutrition', 'gold standard'],
    domains: ['optimumnutrition.com'],
    url: 'https://www.optimumnutrition.com/en-us/products/gold-standard-100-whey-protein-powder',
  },
  {
    name: 'Perfect Sports',
    aliases: ['perfect sports', 'diesel'],
    domains: ['perfectsports.com', 'us.perfectsports.com'],
    url: 'https://us.perfectsports.com/products/diesel-new-zealand-whey-protein-isolate/',
  },
  {
    name: 'BioX',
    aliases: ['biox'],
    domains: ['bioxnutrition.com'],
    url: 'https://bioxnutrition.com/product/power-whey-isolate/',
  },
  {
    name: 'ProSupps',
    aliases: ['prosupps'],
    domains: ['prosupps.com'],
    url: 'https://prosupps.com/products/whey-isolate',
  },
  {
    name: 'Nutrabolics',
    aliases: ['nutrabolics', 'hydropure'],
    domains: ['nutrabolics.com'],
    url: 'https://nutrabolics.com/products/hydropure-ultra-pure-hydrolyzed-whey-protein',
  },
  {
    name: 'Warrior',
    aliases: ['warrior'],
    domains: ['teamwarrior.com'],
    url: 'https://teamwarrior.com/products/warrior-whey-protein-2kg',
  },
  {
    name: 'Mutant',
    aliases: ['mutant'],
    domains: ['mutantnation.com'],
    url: 'https://mutantnation.com/products/whey-protein-mix',
  },
  {
    name: 'OstroVit',
    aliases: ['ostrovit'],
    domains: ['ostrovit.com'],
    url: 'https://ostrovit.com/en/products/ostrovit-wpc-80-700-g-26507.html',
  },
  {
    name: 'Muscle Nation',
    aliases: ['musclenation', 'muscle nation'],
    domains: ['musclenation.org'],
    url: 'https://musclenation.org/collections/supplements',
  },
  {
    name: 'Clean Simple Eats',
    aliases: ['clean simple eats'],
    domains: ['cleansimpleeats.com'],
    url: 'https://cleansimpleeats.com/collections/protein-powder',
  },
  {
    name: 'Applied Nutrition',
    aliases: ['applied nutrition', 'critical whey'],
    domains: ['appliednutrition.uk'],
    url: 'https://appliednutrition.uk/products/critical-whey',
  },
  {
    name: 'NZMP',
    aliases: ['nzmp'],
    domains: ['nzmp.com'],
    url: 'https://www.nzmp.com/global/en/about-nzmp/global-ingredients/our-global-ingredients.html',
  },
  {
    name: 'Rule One Proteins',
    aliases: ['rule 1', 'rule one proteins', 'rule 1 proteins'],
    domains: ['ruleoneproteins.com'],
    url: 'https://www.ruleoneproteins.com/products/r1-protein',
  },
  {
    name: 'California Gold Nutrition',
    aliases: ['california gold nutrition'],
    // iHerb identifies CGN as its house brand; this authority applies only to
    // CGN candidates, not other manufacturers sold by the same retailer.
    // https://corporate.iherb.com/iherb-introduces-california-gold-nutrition-beauty/
    domains: ['californiagoldnutrition.com', 'iherb.com', 'mu.iherb.com'],
    url: 'https://www.iherb.com/c/california-gold-nutrition',
  },
  {
    name: 'SEEQ',
    aliases: ['seeq'],
    domains: ['seeqsupply.com'],
    url: 'https://seeqsupply.com/products/clear-protein-variety-pack',
  },
];

function aliasInTitle(title, alias) {
  const words = (value) =>
    fold(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return ` ${words(title)} `.includes(` ${words(alias)} `);
}

export function manufacturerCandidates(product, registry = MANUFACTURERS) {
  const brand = fold(product.brand || '');
  const title = fold(product.title || '');
  const selected = (product.selectedVariant || [])
    .map((option) => option.text)
    .join(' ');
  const selectedBrands = new Set(
    registry.filter((entry) =>
      entry.aliases.some((alias) => aliasInTitle(selected, alias))
    )
  );
  return registry
    .filter((entry) =>
      entry.aliases.some(
        (alias) =>
          brand === fold(alias) ||
          aliasInTitle(title, alias) ||
          aliasInTitle(selected, alias)
      )
    )
    .sort(
      (left, right) =>
        Number(selectedBrands.has(right)) - Number(selectedBrands.has(left))
    )
    .map((entry) => ({
      name: entry.name,
      url: candidateUrl(entry, product),
      identityStatus: 'candidate-only',
      reason:
        'Exact manufacturer product, flavour, package and specification evidence must be matched',
      brandConflict: Boolean(
        selectedBrands.size > 1 ||
        (selectedBrands.size && !selectedBrands.has(entry)) ||
        (brand &&
          !entry.aliases.some((alias) => brand === fold(alias)) &&
          brand !== fold(entry.name))
      ),
    }));
}

function candidateUrl(entry, product) {
  const selected = fold(
    (product.selectedVariant || []).map((option) => option.text).join(' ')
  );
  if (entry.name === 'MusaKing' && /\bsoy\b/u.test(fold(product.title))) {
    return 'https://musaking.com/products/soy-protein';
  }
  if (entry.name === 'MusaKing' && product.netMassG > 1000) {
    return 'https://musaking.com/products/isolate-whey';
  }
  if (
    entry.name === 'California Gold Nutrition' &&
    selected.includes('dark chocolate') &&
    product.netMassG === 907
  ) {
    return 'https://www.iherb.com/pr/california-gold-nutrition-sport-whey-protein-isolate-dark-chocolate-2-lb-907-g/82696';
  }
  if (entry.name === 'Clean Simple Eats' && selected.includes('coconut')) {
    return 'https://cleansimpleeats.com/products/coconut-protein-powder';
  }
  if (entry.name === 'Celano' && product.netVolumeMl === 70) {
    return 'https://ngoinhadinhduong.com/products/kem-celano-que-socola-70mlx20';
  }
  return entry.url;
}

export function isTrustedManufacturer(product, url, registry = MANUFACTURERS) {
  let hostname;
  try {
    const source = new URL(url);
    if (
      !['http:', 'https:'].includes(source.protocol) ||
      source.username ||
      source.password
    ) {
      return false;
    }
    hostname = source.hostname.replace(/^www\./u, '');
  } catch {
    return false;
  }
  const candidates = manufacturerCandidates(product, registry);
  return registry.some(
    (entry) =>
      candidates.some(
        (candidate) => candidate.name === entry.name && !candidate.brandConflict
      ) && entry.domains.includes(hostname)
  );
}
