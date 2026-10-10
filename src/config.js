import { LinoEnv, makeConfig, toUpperCase } from 'lino-arguments';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AssociativeStore } from './store.js';
import { DEFAULT_ARCHIVE } from './archive.js';

const flavourScopeOption = {
  type: 'string',
  choices: ['all', 'chocolate-or-unflavoured'],
};
const flavourScopeConfig = (getenv) => {
  const scope = getenv('LAZADA_FLAVOUR_SCOPE', '');
  return { ...flavourScopeOption, ...(scope ? { default: scope } : {}) };
};
const categoryOnlyConfig = (getenv) => ({
  type: 'boolean',
  default: getenv('LAZADA_CATEGORY_ONLY', 'false') === 'true',
});
const searchSortConfig = (getenv) => ({
  type: 'string',
  choices: ['default', 'priceasc', 'pricedesc'],
  default: getenv('LAZADA_SEARCH_SORT', 'default'),
});

export function configuredStore(options) {
  const archive = options.archiveDir || DEFAULT_ARCHIVE;
  const shared = new AssociativeStore({
    directory: options.dataDir,
    archive:
      options.archive !== false && existsSync(join(archive, 'manifest.json'))
        ? archive
        : undefined,
  });
  const account =
    options.account || (options._?.[0] === 'login' ? 'default' : undefined);
  if (!account) {
    return shared;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(account)) {
    throw new Error(
      'Account name must start with a letter and contain only letters, numbers, underscores or hyphens'
    );
  }
  return new AssociativeStore({
    directory: join(shared.directory, 'accounts', account),
    fallback: shared,
    visibility: 'private',
  });
}

function loadConfiguration(path, override) {
  if (!existsSync(path)) {
    return;
  }
  const file = new LinoEnv(path);
  file.read();
  for (const [key, value] of Object.entries(file.toObject())) {
    const name = toUpperCase(key);
    if (override || process.env[name] === undefined) {
      const trimmed = value.trim();
      process.env[name] = /^(["']).*\1$/su.test(trimmed)
        ? trimmed.slice(1, -1)
        : value;
    }
  }
}

export function parseArguments(argv) {
  // makeConfig 0.3.0 logs .lenv loads to stdout, which corrupts JSON and
  // binary CLI output. Load its exported LinoEnv object quietly first.
  const argumentsWithoutConfig = [];
  let configuration;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--configuration' || argument === '-c') {
      configuration = argv[++index];
      if (!configuration || configuration.startsWith('--')) {
        throw new Error('Configuration file path is required');
      }
    } else if (argument.startsWith('--configuration=')) {
      configuration = argument.slice('--configuration='.length);
      if (!configuration) {
        throw new Error('Configuration file path is required');
      }
    } else {
      argumentsWithoutConfig.push(argument);
    }
  }
  loadConfiguration('.lenv', false);
  if (configuration) {
    if (!existsSync(configuration)) {
      throw new Error(`Configuration file not found: ${configuration}`);
    }
    loadConfiguration(configuration, true);
  }
  let positional = [];
  const config = makeConfig({
    argv: [process.execPath, 'lazada-search', ...argumentsWithoutConfig],
    lenv: { enabled: false },
    yargs: ({ yargs, getenv }) =>
      yargs
        .exitProcess(false)
        .help(false)
        .version(false)
        .strictOptions()
        .check((parsed) => {
          positional = parsed._.map(String);
          return true;
        })
        .option('data-dir', {
          type: 'string',
          default: getenv('LAZADA_DATA_DIR', '.lazada-search'),
        })
        .option('archive-dir', {
          type: 'string',
          default: getenv('LAZADA_ARCHIVE_DIR', 'data/cases/vietnam-nha-trang'),
        })
        .option('archive', { type: 'boolean', default: true })
        .option('account', {
          type: 'string',
          default: getenv('LAZADA_ACCOUNT', ''),
        })
        .option('phone-env', { type: 'string', default: 'LAZADA_LOGIN_PHONE' })
        .option('auth-channel', {
          type: 'string',
          choices: ['zalo', 'sms'],
          default: 'zalo',
        })
        .option('interval-ms', { type: 'number', default: 60000 })
        .option('persistent-browser', { type: 'boolean', default: true })
        .option('browser-idle-ms', { type: 'number', default: 1800000 })
        .option('reason', { type: 'string' })
        .option('market', {
          type: 'string',
          default: getenv('LAZADA_MARKET', 'vn'),
        })
        .option('delivery-area', {
          type: 'string',
          default: getenv('LAZADA_DELIVERY_AREA', 'Nha Trang'),
        })
        .option('headless', { type: 'boolean', default: true })
        .option('province', { type: 'string' })
        .option('locality', { type: 'string' })
        .option('executable-path', {
          type: 'string',
          default: getenv('LAZADA_BROWSER_EXECUTABLE', ''),
        })
        .option('cdp-url', {
          type: 'string',
          default: getenv('LAZADA_CDP_URL', ''),
        })
        .option('session-from', {
          type: 'string',
          default: getenv('LAZADA_SESSION_FROM', ''),
        })
        .option('session-profile', { type: 'string' })
        .option('clink-command', {
          type: 'string',
          default: getenv('LAZADA_CLINK_COMMAND', 'clink'),
        })
        .option('offline', { type: 'boolean', default: false })
        .option('ocr', { type: 'boolean', default: true })
        .option('ocr-languages', {
          type: 'string',
          default: getenv('LAZADA_OCR_LANGUAGES', 'eng'),
        })
        .option('ocr-data-dir', {
          type: 'string',
          default: getenv('LAZADA_OCR_DATA_DIR', ''),
        })
        .option('max-images', { type: 'number', default: 40 })
        .option('refresh', { type: 'boolean', default: false })
        .option('reprocess', { type: 'boolean', default: false })
        .option('exhaustive', { type: 'boolean', default: false })
        .option('discovery-only', { type: 'boolean', default: false })
        .option('strict', { type: 'boolean', default: false })
        .option('require-manufacturer', { type: 'boolean', default: true })
        .option('max-pages', { type: 'number', default: 5 })
        .option('max-products', { type: 'number', default: 100 })
        .option('query', { type: 'array', string: true })
        .option('category-url', { type: 'array', string: true })
        .option('category-only', categoryOnlyConfig(getenv))
        .option('search-sort', searchSortConfig(getenv))
        .option('quantity', { type: 'number', default: 1 })
        .option('currency', { type: 'string' })
        .option('category', {
          type: 'string',
          choices: ['whey', 'protein-powder', 'chocolate-ice-cream', 'unknown'],
        })
        .option('protein-type', {
          type: 'string',
          choices: ['isolate', 'concentrate', 'blend', 'hydrolyzed', 'unknown'],
        })
        .option('min-protein', { type: 'number' })
        .option('max-sugar', { type: 'number' })
        .option('exclude-ingredient', { type: 'array', string: true })
        .option('shipping', { type: 'number' })
        .option('discount', { type: 'number' })
        .option('allow-stale', { type: 'boolean', default: false })
        .option('require-shipping', { type: 'boolean', default: true })
        .option('sort', { type: 'string', default: 'costPerProteinG' })
        .option('flavour-scope', flavourScopeConfig(getenv))
        .option('port', { type: 'number', default: 8080 })
        .option('format', {
          type: 'string',
          choices: ['json', 'lino', 'links'],
          default: 'json',
        })
        .option('path', { type: 'string' })
        .option('value', { type: 'string' })
        .option('help', { alias: 'h', type: 'boolean' })
        .option('version', { alias: 'v', type: 'boolean' }),
  });
  return {
    ...config,
    ...(configuration ? { configuration } : {}),
    _: positional,
  };
}

export const comparisonOptions = (options) =>
  Object.fromEntries(
    Object.entries({
      quantity: options.quantity,
      currency: options.currency,
      deliveryArea: options.deliveryArea,
      category: options.category,
      proteinType: options.proteinType,
      flavourScope: options.flavourScope,
      minProtein: options.minProtein,
      maxSugar: options.maxSugar,
      excludeIngredients: options.excludeIngredient,
      shipping: options.shipping,
      discount: options.discount,
      allowStale: options.allowStale,
      requireShipping: options.requireShipping,
      requireManufacturer: options.requireManufacturer,
      sort: options.sort,
    }).filter(([, value]) => value !== undefined)
  );
