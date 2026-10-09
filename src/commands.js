import { readFile } from 'node:fs/promises';
import { decode } from 'lino-objects-codec';
import { comparisonOptions } from './config.js';
import { NativeLinkStore } from './native-store.js';
import { assertCompleteCoverage } from './coverage.js';
import { RepositoryArchive, exportRepositoryArchive } from './archive.js';
import { parse as parseYaml } from 'yaml';
import { sha256 } from './util.js';

export const HELP = `Usage: lazada-search <command> [arguments] [options]

Commands:
  crawl                         Discover and collect whey and chocolate ice cream
  audit                         Audit missing listings, SKU prices and manufacturer specs
  collect <lazada-url>           Collect a single listing with image OCR
  delivery <lazada-url>          Cache the public shipping estimate for one package
  compare                       Recalculate cached offers and exclusions
  import <file.json|file.yml|file.lino>   Import records and retain their original source
  inspect <kind> [id]            Read products, offers, evidence, OCR or history
  verify <product-id> <url>      Cross-check an operator-supplied official page
  review <id> <field> <JSON-value> <evidence-id>   Review an extracted product field
  quote <offer-id> <JSON>        Record shipping, bulk tiers and delivery checks
  export                        Export the associative network (--format lino|links)
  archive                       Commit-ready public sources, OCR, .lino and binary snapshot
  archive-verify                Check every archived source and both conversions offline
  invalidate <url> --reason TEXT Mark a source for online reload after a data correction
  serve                         Start the online calculator on localhost:8080
  bot                           Start Telegram polling using configured credentials
  sessions                      Inspect Lazada session availability, without credentials
  login                         Open the dedicated browser for manual login
  mirror                        Build verified native link-cli binary shards

Options:
  --data-dir PATH --market vn --delivery-area "Nha Trang"
  --archive-dir PATH --no-archive  Select the committed case archive or disable reuse
  --province "Khánh Hòa" --locality "Phường Nha Trang"
  --query TEXT --max-pages 5 --max-products 100 --max-images 40
  --exhaustive --strict          Visit search pagination; fail an incomplete audit
  --no-require-manufacturer      Explore unverified observations without a purchase guarantee
  --headless=false --executable-path PATH --refresh --reprocess --offline --no-ocr
  --ocr-languages eng+vie --ocr-data-dir PATH
  --session-from auto|chrome|firefox|yandex|safari --session-profile NAME --cdp-url URL
  --category whey|protein-powder|chocolate-ice-cream --protein-type isolate|concentrate|blend
  --quantity 10 --currency VND --shipping 30000 --discount 50000
  --min-protein 70 --max-sugar 5 --exclude-ingredient sucralose
  --allow-stale --no-require-shipping --sort costPerProteinG|costPerKg|totalCost|proteinPer100g
  --sort costPerGramBeforeDelivery|costPerGramAfterDelivery|costPerMlBeforeDelivery|costPerMlAfterDelivery
  --format json|lino|links --port 8080 --help --version
`;

export async function executeCommand(application, command, args, options = {}) {
  switch (command) {
    case 'archive':
      return exportRepositoryArchive({
        store: application.store,
        directory: options.archiveDir,
        caseMetadata: {
          market: application.market,
          currency: application.currency,
          deliveryArea: application.deliveryArea,
        },
      });
    case 'archive-verify':
      return new RepositoryArchive({ directory: options.archiveDir }).verify();
    case 'invalidate':
      return application.cache.invalidate(required(args[0], 'Source URL'), {
        reason: required(options.reason, 'Invalidation reason'),
      });
    case 'audit': {
      const report = await application.audit();
      return options.strict ? assertCompleteCoverage(report) : report;
    }
    case 'crawl':
      return application.crawl({
        queries: options.query,
        maxPages: options.maxPages,
        maxProducts: options.maxProducts,
        refresh: options.refresh,
        exhaustive: options.exhaustive,
      });
    case 'collect':
      return application.collect(required(args[0], 'Lazada URL'), {
        refresh: options.refresh,
        reprocess: options.reprocess,
      });
    case 'compare':
      return application.compare(comparisonOptions(options));
    case 'delivery':
      return application.delivery(required(args[0], 'Lazada URL'), {
        province: options.province,
        locality: options.locality,
        refresh: options.refresh,
      });
    case 'import': {
      const file = required(args[0], 'Import file');
      const text = await readFile(file, 'utf8');
      const format = /\.ya?ml$/iu.test(file)
        ? 'yaml'
        : file.endsWith('.lino')
          ? 'lino'
          : 'json';
      const parsed =
        format === 'lino'
          ? decode({ notation: text })
          : format === 'yaml'
            ? parseYaml(text, { maxAliasCount: 100 })
            : JSON.parse(text);
      const result = await application.importRecords(parsed);
      const source = await application.store.putBlob(Buffer.from(text));
      await application.store.put('import-source', {
        id: `import:${sha256(text)}`,
        format,
        source,
        importedAt: new Date().toISOString(),
        productIds: (parsed.products || []).map((product) => product.id),
        offerIds: (parsed.offers || []).map((offer) => offer.id),
      });
      return result;
    }
    case 'inspect': {
      const kind = required(args[0], 'Record kind');
      return args[1]
        ? application.store.get(kind, args[1])
        : application.store.list(
            kind,
            options.path ? { path: options.path, value: options.value } : {}
          );
    }
    case 'verify':
      return application.verify(
        required(args[0], 'Product id'),
        required(args[1], 'Official manufacturer URL'),
        { refresh: options.refresh }
      );
    case 'review':
      return application.review(
        required(args[0], 'Product id'),
        required(args[1], 'Field'),
        JSON.parse(required(args[2], 'JSON value')),
        required(args[3], 'Evidence id')
      );
    case 'quote':
      return application.quote(
        required(args[0], 'Offer id'),
        JSON.parse(required(args[1], 'JSON quote'))
      );
    case 'export':
      return application.store.exportGraph();
    case 'mirror':
      return new NativeLinkStore({ command: options.clinkCommand }).mirror(
        application.store
      );
    case 'login': {
      await application.collector.start();
      await application.collector.commander.goto({
        url: `https://${(await import('./application.js')).MARKETS[application.market].host}/`,
        waitForNetworkIdle: false,
      });
      console.log(
        'Sign in in the browser window. The dedicated profile will retain the session. Press Ctrl+C when finished.'
      );
      await new Promise((resolve) => process.once('SIGINT', resolve));
      return { status: 'profile-saved' };
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function required(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return String(value);
}
