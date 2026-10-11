import { executeCommand } from './commands.js';
import { reviewListingCategory } from './category-review.js';
import { sha256 } from './util.js';

export const OPERATION_NAMES = [
  'discover',
  'crawl',
  'audit',
  'collect',
  'replay-captures',
  'collection-status',
  'resume-collection',
  'delivery',
  'compare',
  'inspect',
  'verify',
  'review',
  'quote',
  'import',
  'import-capture',
  'review-manufacturer',
  'manufacturer-research',
  'review-category',
  'invalidate',
  'translate',
  'translate-product',
  'translate-catalog',
  'translation-status',
  'review-translation',
  'save-basket-quote',
  'capture-basket-quote',
  'compare-baskets',
];
const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};
const string = (value, label) => {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} must be a nonempty string`);
  }
  return value;
};

function structuredArguments(operation, input) {
  switch (operation) {
    case 'collect':
    case 'delivery':
      return [string(input.url, 'Source URL')];
    case 'verify':
      return [
        string(input.productId, 'Product ID'),
        string(input.url, 'Manufacturer URL'),
      ];
    case 'review':
      return [
        string(input.productId, 'Product ID'),
        string(input.field, 'Field'),
        JSON.stringify(input.value),
        string(input.evidenceId, 'Evidence ID'),
      ];
    case 'quote':
      return [
        string(input.offerId, 'Offer ID'),
        JSON.stringify(object(input.quote, 'Quote')),
      ];
    case 'inspect':
      return [
        string(input.kind, 'Record kind'),
        ...(input.id ? [string(input.id, 'Record ID')] : []),
      ];
    case 'translate':
      return [string(input.text, 'Source text')];
    case 'translate-product':
      return [string(input.productId, 'Product ID')];
    default:
      return [];
  }
}

function operationArguments(request, operation, input) {
  const args =
    request.args === undefined
      ? structuredArguments(operation, input)
      : request.args;
  if (
    !Array.isArray(args) ||
    args.length > 16 ||
    args.some((value) => typeof value !== 'string')
  ) {
    throw new Error(
      'Operation arguments must be an array of at most 16 strings'
    );
  }
  return args;
}

/** JSON operations retain the library's validation/coverage/challenge gates. */
export async function executeOperation(application, request) {
  object(request, 'Operation request');
  const operation = string(request.operation, 'Operation');
  if (!OPERATION_NAMES.includes(operation)) {
    throw new Error('Unsupported structured operation');
  }
  const options =
    request.options === undefined ? {} : object(request.options, 'Options');
  const input =
    request.input === undefined ? {} : object(request.input, 'Input');
  if (operation === 'import') {
    const records = object(input.records, 'Import records');
    const result = await application.importRecords(records);
    const original = JSON.stringify(records);
    const source = await application.store.putBlob(
      Buffer.from(original, 'utf8')
    );
    await application.store.put('import-source', {
      id: `import:${sha256(original)}`,
      format: 'json',
      source,
      importedAt: new Date().toISOString(),
      productIds: (records.products || []).map((item) => item.id),
      offerIds: (records.offers || []).map((item) => item.id),
    });
    return result;
  }
  if (operation === 'invalidate') {
    return application.cache.invalidate(string(input.url, 'Source URL'), {
      reason: string(input.reason, 'Invalidation reason'),
    });
  }
  if (operation === 'import-capture') {
    return application.importCapture(object(input.capture, 'Browser capture'));
  }
  if (operation === 'review-manufacturer') {
    return application.reviewManufacturer(
      string(input.productId, 'Product ID'),
      object(input.review, 'Manufacturer review')
    );
  }
  if (operation === 'manufacturer-research') {
    return application.manufacturerResearch(
      object(input.plan, 'Manufacturer research plan')
    );
  }
  if (operation === 'review-category') {
    return reviewListingCategory(
      application,
      string(input.url, 'Listing URL'),
      object(input.review, 'Category review')
    );
  }
  if (operation === 'review-translation') {
    return application.translator.review(
      string(input.translationId, 'Translation ID'),
      object(input.review, 'Translation review')
    );
  }
  const basketHandlers = {
    'save-basket-quote': (quote) => application.saveBasketQuote(quote),
    'capture-basket-quote': (quote) => application.captureBasketQuote(quote),
  };
  if (Object.hasOwn(basketHandlers, operation)) {
    return basketHandlers[operation](
      object(input.quote, 'Basket source mapping')
    );
  }
  return executeCommand(
    application,
    operation,
    operationArguments(request, operation, input),
    options
  );
}
