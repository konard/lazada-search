import { Bot } from 'grammy';
import { parseArguments } from './config.js';
import { executeOperation } from './operations.js';
import { applyComparisonTranslations } from './translation-presentation.js';

function comparisonTitle(product) {
  const title = product.presentation?.title;
  return title?.status === 'reviewed' && title.originalText === product.title
    ? `${title.text}\nOriginal: ${product.title}`
    : product.title;
}

function commercialText(offer) {
  const labels = {
    seller: 'Seller',
    sellerName: 'Seller',
    sellerText: 'Seller text',
    shippingText: 'Shipping text',
    promotionText: 'Promotion text',
    promotions: 'Promotion text',
    conditions: 'Conditions',
    condition: 'Condition',
    priceText: 'Price text',
    originalPriceText: 'Original price text',
  };
  const translated = (offer.presentation?.commercialText || []).flatMap(
    ({ path, presentation }) => {
      const original = path.reduce((value, field) => value?.[field], offer);
      return labels[path[0]] &&
        presentation.status === 'reviewed' &&
        presentation.originalText === original &&
        presentation.text !== original
        ? [`${labels[path[0]]}: ${presentation.text}\nOriginal: ${original}`]
        : [];
    }
  );
  return translated.length ? `\n${translated.join('\n')}` : '';
}

export function tokenize(text) {
  const tokens = [];
  let token = '',
    quote,
    started = false;
  for (const character of text.trim()) {
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) {
    throw new Error('Unclosed command quote');
  }
  if (started) {
    tokens.push(token);
  }
  return tokens;
}

export function formatComparison(report) {
  const money = (value) =>
    Number.isFinite(value) ? value.toFixed(2) : 'Unknown';
  const unitPrices = (metrics) =>
    `Food quantities: ${money(metrics.totalMassG)} g; ${money(metrics.totalVolumeMl)} ml; ${money(metrics.totalProteinG)} g protein\n${metrics.currency}, before / after delivery:\nFood g: ${money(metrics.costPerGramBeforeDelivery)} / ${money(metrics.costPerGramAfterDelivery)}\nml: ${money(metrics.costPerMlBeforeDelivery)} / ${money(metrics.costPerMlAfterDelivery)}\nProtein g: ${money(metrics.costPerProteinGramBeforeDelivery)} / ${money(metrics.costPerProteinGramAfterDelivery)}\n25 g protein: ${money(metrics.costPer25gProteinBeforeDelivery)} / ${money(metrics.costPer25gProteinAfterDelivery)}`;
  const verified = report.comparisons.filter((row) => row.manufacturerVerified);
  const priced = (report.observedPrices || [])
    .filter((row) => !row.manufacturerVerified)
    .map(
      ({ product, offer, metrics, problems }) =>
        `Captured price: ${comparisonTitle(product)}\n${metrics.quantity} package(s), before / after delivery: ${money(metrics.totalBeforeDelivery)} / ${money(metrics.totalAfterDelivery)} ${offer.currency}\nSorted ${report.assumptions.sort}: ${money(metrics[report.assumptions.sort])}\n${unitPrices(metrics)}\nManufacturer verification pending\n${problems.join('; ')}${commercialText(offer)}\n${offer.url}`
    );
  const pending = report.comparisons
    .filter((row) => !row.manufacturerVerified)
    .filter(
      (row) =>
        !(report.observedPrices || []).some(
          (priced) => priced.offer.id === row.offer.id
        )
    )
    .map(
      ({ product, offer, metrics, problems }) =>
        `Pending manufacturer verification: ${comparisonTitle(product)}\nObserved price: ${money(offer.price)} ${offer.currency}\n${unitPrices(metrics)}\n${problems.join('; ')}${commercialText(offer)}\n${offer.url}`
    );
  const lines = verified.map(
    ({ product, offer, metrics, eligible, problems }, index) =>
      `${index + 1}. ${comparisonTitle(product)}\n${product.proteinType}; ${metrics.proteinPer100g ?? 'Unknown'} g protein/100 g\nOrder (${metrics.quantity}): ${money(metrics.totalBeforeDelivery)} / ${money(metrics.totalAfterDelivery)} ${metrics.currency}\n${unitPrices(metrics)}\n${eligible ? 'Confirmed comparison' : problems.join('; ')}${commercialText(offer)}\n${offer.url}`
  );
  return `Manufacturer-verified comparison, before / after delivery:\n${lines.join('\n\n') || 'No manufacturer-verified offers match these filters.'}\n\n${priced.join('\n\n')}\n\n${pending.join('\n\n')}\n\n${report.ranked.length} eligible offers; ${report.excluded.length} need information. ${[...new Set(report.excluded.flatMap((item) => item.problems))].join('; ')}`;
}

export function createTelegramBot({
  application,
  token,
  allowedUserIds,
  botInfo,
  client,
} = {}) {
  if (
    !token ||
    !allowedUserIds?.length ||
    allowedUserIds.some(
      (id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0
    )
  ) {
    throw new Error(
      'Telegram requires a token and a nonempty allowed user id list'
    );
  }
  const allowed = new Set(allowedUserIds.map(String));
  const bot = new Bot(token, { botInfo, client });
  let tail = Promise.resolve();
  bot.use(async (ctx, next) => {
    if (!allowed.has(String(ctx.from?.id)) || ctx.chat?.type !== 'private') {
      return;
    }
    await next();
  });
  bot.command(['start', 'help'], (ctx) =>
    ctx.reply(
      'Commands: /discover --exhaustive, /crawl --exhaustive, /audit --strict, /collect URL, /replay_captures --offline, /delivery URL, /compare --category whey --quantity 10, /compare_baskets, /inspect product ID, /verify ID OFFICIAL_URL, /review ID FIELD VALUE EVIDENCE_ID, /quote OFFER_ID JSON, /translate "Vietnamese text", /translate_product ID, /translate_catalog, /translation_status JOB_ID, /operation JSON, /collection_status, /resume_collection. Catalog translation defaults to cache-only; --translation-download explicitly enables configured provider calls. /operation accepts structured imports, reviews, case/manufacturer workflow plans and shopping reports without filesystem access. Draft report example: /operation {"operation":"shopping-report","options":{"quantities":[1,10],"limit":10}}. /operation {"operation":"requirement-draft-status"} lists the complete requirement registry. New workflows remain draft and untested; provider credentials must be configured by the operator at application startup. Translations are presentation only; original product facts remain authoritative. Comparison titles use source-bound reviewed English when cached and retain original text. Translation requires an operator-configured provider or existing cache. CAPTCHA detection stops new requests until the challenge is cleared and collection is explicitly resumed. Manufacturer verification is required for purchase rankings. All collection is cached. Use /compare --category chocolate-ice-cream for ice cream.'
    )
  );
  bot.command(
    [
      'crawl',
      'discover',
      'audit',
      'collect',
      'replay_captures',
      'collection_status',
      'resume_collection',
      'delivery',
      'compare',
      'compare_baskets',
      'inspect',
      'verify',
      'review',
      'quote',
      'translate',
      'translate_product',
      'translate_catalog',
      'translation_status',
    ],
    async (ctx) => {
      const command = ctx.message.text
        .match(/^\/([a-z_]+)/u)[1]
        .replaceAll('_', '-');
      const run = async () => {
        try {
          const options = parseArguments([
            command,
            ...tokenize(ctx.match || ''),
          ]);
          const result = await executeOperation(application, {
            operation: command,
            args: options._.slice(1),
            options,
          });
          const text =
            command === 'compare'
              ? formatComparison(
                  await applyComparisonTranslations(
                    result,
                    application.translator
                  )
                )
              : JSON.stringify(result ?? null, null, 2);
          // Plain text prevents product content from injecting Telegram markup.
          for (let offset = 0; offset < text.length; offset += 3500) {
            await ctx.reply(text.slice(offset, offset + 3500));
          }
        } catch (error) {
          await ctx.reply(`Command failed: ${error.message}`);
        }
      };
      const operation = tail.then(run, run);
      tail = operation.catch(() => {});
      await operation;
    }
  );
  bot.command(['operation', 'review_collection_stop'], async (ctx) => {
    const run = async () => {
      try {
        const input = JSON.parse(ctx.match || '{}');
        const request = /^\/review_collection_stop(?:\s|@|$)/u.test(
          ctx.message.text
        )
          ? { operation: 'review-collection-stop', input: { review: input } }
          : input;
        const result = await executeOperation(application, request);
        const text = JSON.stringify(result ?? null, null, 2);
        for (let offset = 0; offset < text.length; offset += 3500) {
          await ctx.reply(text.slice(offset, offset + 3500));
        }
      } catch (error) {
        await ctx.reply(`Command failed: ${error.message}`);
      }
    };
    const operation = tail.then(run, run);
    tail = operation.catch(() => {});
    await operation;
  });
  return bot;
}
