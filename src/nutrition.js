import { fold, normalizeText } from './util.js';

export function parseDecimal(value) {
  const raw = String(value).replace(/[^\d.,-]/gu, '');
  if (!raw) {
    return undefined;
  }
  const result = Number(raw.replace(',', '.'));
  return Number.isFinite(result) ? result : undefined;
}

export function parsePrice(value, currency = 'VND') {
  const raw = String(value || '').replace(/[^\d.,]/gu, '');
  if (!raw) {
    return undefined;
  }
  if (['VND', 'IDR'].includes(currency)) {
    return Number(raw.replace(/[.,]/gu, ''));
  }
  const decimal = raw.match(/[.,](\d{2})$/u);
  return Number(
    decimal
      ? `${raw.slice(0, decimal.index).replace(/[.,]/gu, '')}.${decimal[1]}`
      : raw.replace(/[.,]/gu, '')
  );
}

export function massGrams(value) {
  const text = String(value || '');
  const match = [
    ...text.matchAll(
      /(\d+(?:[.,]\d+)?)\s*(kg|g|gam|gr|grams?|kilograms?|lbs?|oz)(?![\p{L}\p{N}])/giu
    ),
  ].find(
    (entry) =>
      !/(?:^|\n)\s*(?:protein|sugar|fat|đạm|đường|chất béo)\s*[:=]?\s*$/iu.test(
        text.slice(0, entry.index)
      ) &&
      !/^\s*(?:protein|sugar|fat|đạm|đường|chất béo)/iu.test(
        text.slice(entry.index + entry[0].length)
      )
  );
  if (!match) {
    return undefined;
  }
  const factor = /^(?:kg|kilogram)/iu.test(match[2])
    ? 1000
    : /^lb/iu.test(match[2])
      ? 453.59237
      : /^oz/iu.test(match[2])
        ? 28.349523125
        : 1;
  return parseDecimal(match[1]) * factor;
}

export function volumeMillilitres(value) {
  const match = String(value || '').match(
    /(\d+(?:[.,]\d+)?)\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)(?![\p{L}\p{N}])/iu
  );
  if (!match) {
    return undefined;
  }
  return parseDecimal(match[1]) * (/^(?:l|lit)/iu.test(match[2]) ? 1000 : 1);
}

export function categoryOf(title) {
  const value = fold(title).replace(/[-–—]/gu, ' ');
  if (
    /duong (?:am|da)|duong da mat|nhuom toc|skin cream|face cream|hair dye|\blotion\b/u.test(
      value
    )
  ) {
    return 'unknown';
  }
  if (
    /ice\s*cream|gelato|\bkem\s+(?:hop|ly|que|oc que|vien|socola|so co la|chocolate|sua|vi|celano|merino|haagen|wall|aice|khoai|tuoi|lanh|hu)\b/u.test(
      value
    ) &&
    /choco|socola|so co la/u.test(value) &&
    !/\b(?:khuon|molds?|powder|mix|syrup|sauce|spread)\b|\bbot\b|sua chua|yogurt|chocolate bars/u.test(
      value
    ) &&
    (!/\b(?:keo|banh|candy|candies|cookies?)\b/u.test(value) ||
      /ice\s*cream|gelato|\bkem\s+(?:hop|ly|que|oc que|vien)\b/u.test(value) ||
      /^kem\s+(?:socola|so co la|chocolate)\b/u.test(
        value.replace(/\[[^\]]*\]/gu, '').trim()
      ))
  ) {
    return 'chocolate-ice-cream';
  }
  if (/\bwhey\b/u.test(value)) {
    return 'whey';
  }
  if (
    /\bcasein\b|\bprotein powder\b|\bbot\b.*\bprotein\b/u.test(value) &&
    !/\b(?:infant|formula|creatine|bcaa|collagen)\b|tre em/u.test(value)
  ) {
    return 'protein-powder';
  }
  return 'unknown';
}

export function ingredientFlags(ingredients) {
  const text = fold(ingredients.join(' '));
  const rules = {
    milk: /milk|whey|casein|sua/u,
    soy: /soy|soya|dau nanh/u,
    addedSugar: /\bsugar\b|sucrose|glucose syrup|corn syrup|duong/u,
    sweeteners: /sucralose|aspartame|acesulfame|stevia|erythritol|maltitol/u,
    palmOil: /palm oil|palm kernel|dau co/u,
  };
  return Object.fromEntries(
    Object.entries(rules).map(([key, rule]) => [
      key,
      ingredients.length ? rule.test(text) : null,
    ])
  );
}

export function proteinTypeOf(ingredients, category) {
  if (category !== 'whey' || !ingredients.length) {
    return 'unknown';
  }
  const text = fold(ingredients.join(' '));
  const isolate = /whey (?:protein )?isolate/u.test(text);
  const concentrate = /whey (?:protein )?concentrate/u.test(text);
  const hydrolyzed = /hydroly[sz]ed whey|whey (?:protein )?hydrolysate/u.test(
    text
  );
  if ([isolate, concentrate, hydrolyzed].filter(Boolean).length > 1) {
    return 'blend';
  }
  return isolate
    ? 'isolate'
    : concentrate
      ? 'concentrate'
      : hydrolyzed
        ? 'hydrolyzed'
        : 'unknown';
}

const NUTRIENTS = {
  proteinPer100g:
    /(?:protein|chất đạm|đạm)\s*[:\t]?\s*(\d+(?:[.,]\d+)?)\s*g\b/iu,
  sugarPer100g:
    /(?:total sugars?|sugars?|đường)\s*[:\t]?\s*(\d+(?:[.,]\d+)?)\s*g\b/iu,
  fatPer100g:
    /(?<!saturated\s+)(?:total fat|fat|chất béo)\s*[:\t]?\s*(\d+(?:[.,]\d+)?)\s*g\b/iu,
  saturatedFatPer100g:
    /(?:saturated fat|saturates|béo bão hòa)\s*[:\t]?\s*(\d+(?:[.,]\d+)?)\s*g\b/iu,
  kcalPer100g:
    /(?:energy|calories|năng lượng)\s*[:\t]?\s*(\d+(?:[.,]\d+)?)\s*(?:kcal|cal)\b/iu,
};

export function extractNutrition(text) {
  const fields = {};
  const excerpts = {};
  const warnings = [];
  const serving = text.match(
    /(?:serving size|khẩu phần)\s*[:\t]?\s*(?:\d+\s*scoops?\s*\()?\s*(\d+(?:[.,]\d+)?)\s*g\b/iu
  );
  if (serving) {
    fields.servingMassG = parseDecimal(serving[1]);
    excerpts.servingMassG = serving[0];
  }
  const per100 =
    /(?:per|trên|mỗi|\/|amount per)\s*100\s*g\b|100\s*g\s*(?:contains|chứa)/iu.test(
      text
    );
  const perServing =
    /(?:per serving|amount per serving|mỗi khẩu phần|trên khẩu phần)/iu.test(
      text
    );
  const volume = /(?:per|trên|mỗi|\/)\s*100\s*ml\b/iu.test(text);
  const ambiguous = per100 && perServing;
  if (ambiguous || volume) {
    warnings.push(
      ambiguous
        ? 'Multiple nutrition columns need review'
        : 'Volume nutrition needs a measured density to convert to grams'
    );
  }
  const factor =
    !ambiguous && !volume && per100
      ? 1
      : !ambiguous && !volume && perServing && fields.servingMassG > 0
        ? 100 / fields.servingMassG
        : undefined;
  for (const [key, expression] of Object.entries(NUTRIENTS)) {
    const matches = [
      ...text.matchAll(new RegExp(expression.source, `${expression.flags}g`)),
    ];
    const values = [...new Set(matches.map((match) => parseDecimal(match[1])))];
    if (values.length === 1 && factor !== undefined) {
      const value = parseDecimal(matches[0][1]) * factor;
      if (
        value >= 0 &&
        (key === 'kcalPer100g' ? value <= 1000 : value <= 100)
      ) {
        fields[key] = value;
        excerpts[key] = matches[0][0];
      } else {
        warnings.push(`Implausible ${key} needs review`);
      }
    } else if (values.length > 1) {
      warnings.push(`Repeated ${key} needs review`);
    }
  }
  const net = text.match(
    /(?:net (?:weight|mass)|khối lượng tịnh|trọng lượng)\s*[:\t]?\s*\d+(?:[.,]\d+)?\s*(?:kg|g|oz|lbs?)\b/iu
  );
  if (net) {
    fields.netMassG = massGrams(net[0]);
    excerpts.netMassG = net[0];
  }
  const netVolume = text.match(
    /(?:net (?:volume|content)|thể tích(?: thực)?|dung tích|khối lượng tịnh)\s*[:\t]?\s*\d+(?:[.,]\d+)?\s*(?:ml|l|lit(?:er|re)s?)\b/iu
  );
  if (netVolume) {
    fields.netVolumeMl = volumeMillilitres(netVolume[0]);
    excerpts.netVolumeMl = netVolume[0];
  }
  const ingredientLine = [
    ...text.matchAll(/(?:ingredients?|thành phần)[ \t]*(?::|\n)\s*([^\n]+)/giu),
  ].find(
    (entry) =>
      !/^(?:allergy|nutrition|how to use|directions|thành phần|ingredients?)\s*$/iu.test(
        entry[1].trim()
      )
  );
  if (ingredientLine) {
    fields.ingredients = splitIngredients(ingredientLine[1]);
    excerpts.ingredients = ingredientLine[0];
  }
  return {
    fields,
    excerpts,
    warnings,
    basis: per100 ? 'per-100g' : perServing ? 'per-serving' : 'unknown',
  };
}

export function splitIngredients(text) {
  const parts = [];
  let depth = 0,
    start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === '[') {
      depth += 1;
    }
    if (character === ')' || character === ']') {
      depth = Math.max(0, depth - 1);
    }
    const decimalComma =
      character === ',' &&
      /\d/u.test(text[index - 1] || '') &&
      /\d/u.test(text[index + 1] || '');
    if (
      depth === 0 &&
      (character === ';' || (character === ',' && !decimalComma))
    ) {
      parts.push(normalizeText(text.slice(start, index)));
      start = index + 1;
    }
  }
  parts.push(normalizeText(text.slice(start)));
  return parts.filter(Boolean);
}

export function crossCheck(product, manufacturer) {
  const gtinMatch =
    product.gtin && manufacturer.gtin && product.gtin === manufacturer.gtin;
  const skuMatch =
    product.manufacturerSku &&
    product.brand &&
    manufacturer.manufacturerSku &&
    manufacturer.brand &&
    product.manufacturerSku === manufacturer.manufacturerSku &&
    fold(product.brand) === fold(manufacturer.brand);
  const identityMatched = Boolean(gtinMatch || skuMatch);
  const conflicts = [];
  const corroborated = [];
  const fields = [
    'netMassG',
    'netVolumeMl',
    'proteinPer100g',
    'sugarPer100g',
    'fatPer100g',
    'saturatedFatPer100g',
    'kcalPer100g',
    'ingredients',
  ];
  if (identityMatched) {
    for (const field of fields) {
      if (product[field] === undefined || manufacturer[field] === undefined) {
        continue;
      }
      const same =
        typeof product[field] === 'number'
          ? Math.abs(product[field] - manufacturer[field]) <=
            Math.max(0.1, product[field] * 0.02)
          : fold(product[field].join(', ')) ===
            fold(manufacturer[field].join(', '));
      if (same) {
        corroborated.push(field);
      } else {
        conflicts.push({
          field,
          listing: product[field],
          manufacturer: manufacturer[field],
        });
      }
    }
  }
  return {
    identityMatched,
    identityMethod: gtinMatch
      ? 'gtin'
      : skuMatch
        ? 'brand-and-manufacturer-sku'
        : 'unmatched',
    conflicts,
    corroborated,
  };
}
