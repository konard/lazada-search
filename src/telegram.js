import { Bot } from 'grammy';
import { parseArguments } from './config.js';
import { executeCommand } from './commands.js';

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
  const lines = report.comparisons
    .slice(0, 10)
    .map(
      ({ product, offer, metrics, eligible, problems }, index) =>
        `${index + 1}. ${product.title}\n${product.proteinType}; ${metrics.proteinPer100g ?? 'Unknown'} g protein/100 g\n${metrics.currency}, before / after delivery:\nOrder (${metrics.quantity}): ${money(metrics.totalBeforeDelivery)} / ${money(metrics.totalAfterDelivery)}\nFood g: ${money(metrics.costPerGramBeforeDelivery)} / ${money(metrics.costPerGramAfterDelivery)}\nml: ${money(metrics.costPerMlBeforeDelivery)} / ${money(metrics.costPerMlAfterDelivery)}\nProtein g: ${money(metrics.costPerProteinGramBeforeDelivery)} / ${money(metrics.costPerProteinGramAfterDelivery)}\n25 g protein: ${money(metrics.costPer25gProteinBeforeDelivery)} / ${money(metrics.costPer25gProteinAfterDelivery)}\n${eligible ? 'Confirmed comparison' : problems.join('; ')}\n${offer.url}`
    );
  return `${lines.join('\n\n') || 'No collected offers match these filters.'}\n\n${report.ranked.length} eligible offers; ${report.excluded.length} need information. ${[...new Set(report.excluded.flatMap((item) => item.problems))].join('; ')}`;
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
      'Commands: /crawl, /collect URL, /delivery URL, /compare --category whey --quantity 10, /inspect product ID, /verify ID OFFICIAL_URL, /review ID FIELD VALUE EVIDENCE_ID, /quote OFFER_ID JSON. All collection is cached. Use /compare --category chocolate-ice-cream for ice cream.'
    )
  );
  bot.command(
    [
      'crawl',
      'collect',
      'delivery',
      'compare',
      'inspect',
      'verify',
      'review',
      'quote',
    ],
    async (ctx) => {
      const command = ctx.message.text.match(/^\/([a-z_]+)/u)[1];
      const run = async () => {
        try {
          const options = parseArguments([
            command,
            ...tokenize(ctx.match || ''),
          ]);
          const result = await executeCommand(
            application,
            command,
            options._.slice(1),
            options
          );
          const text =
            command === 'compare'
              ? formatComparison(result)
              : JSON.stringify(result, null, 2);
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
  return bot;
}
