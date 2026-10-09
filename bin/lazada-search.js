#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encode } from 'lino-objects-codec';
import { LazadaSearch } from '../src/application.js';
import { AssociativeStore } from '../src/store.js';
import { TesseractOcr } from '../src/ocr.js';
import { HELP, executeCommand } from '../src/commands.js';
import { parseArguments } from '../src/config.js';
import { startServer } from '../src/server.js';
import { createTelegramBot } from '../src/telegram.js';
import { importSession, sessionSources } from '../src/session.js';

export async function runCli(
  argv,
  { stdout = console.log, stderr = console.error, application } = {}
) {
  let app;
  let persistent = false;
  try {
    const options = parseArguments(argv);
    const [command, ...args] = options._;
    if (options.version) {
      stdout(
        JSON.parse(
          readFileSync(new URL('../package.json', import.meta.url), 'utf8')
        ).version
      );
      return 0;
    }
    if (options.help || !command) {
      stdout(HELP);
      return 0;
    }
    const store = new AssociativeStore({ directory: options.dataDir });
    if (command === 'sessions') {
      stdout(JSON.stringify(await sessionSources(), null, 2));
      return 0;
    }
    let imported;
    if (
      options.sessionFrom &&
      !options.offline &&
      ['crawl', 'collect', 'verify', 'bot', 'login'].includes(command)
    ) {
      imported = await importSession({
        directory: store.directory,
        browser: options.sessionFrom,
        profile: options.sessionProfile,
      });
    }
    app =
      application ||
      new LazadaSearch({
        store,
        market: options.market,
        deliveryArea: options.deliveryArea,
        maxImages: options.maxImages,
        offline: options.offline,
        ocr: options.ocr
          ? new TesseractOcr({
              store,
              languages: options.ocrLanguages,
              tessdataDir: options.ocrDataDir || undefined,
            })
          : false,
        browserOptions: {
          headless: command === 'login' ? false : options.headless,
          ...(options.cdpUrl ? { cdpEndpoint: options.cdpUrl } : {}),
          ...(imported ? { seedCookies: imported.cookies } : {}),
          ...(options.executablePath
            ? { executablePath: options.executablePath }
            : {}),
        },
      });
    if (command === 'serve' || command === 'bot') {
      const service =
        command === 'serve'
          ? await startServer({ application: app, port: options.port })
          : createTelegramBot({
              application: app,
              token: process.env.TELEGRAM_BOT_TOKEN,
              allowedUserIds: (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
                .split(',')
                .filter(Boolean)
                .map(Number),
            });
      persistent = true;
      const shutdown = async () => {
        if (command === 'serve') {
          await new Promise((resolve) => service.close(resolve));
        } else if (service.isRunning()) {
          await service.stop();
        }
        await app.close();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      if (command === 'serve') {
        stdout(`Calculator: http://127.0.0.1:${service.address().port}`);
      } else {
        await service.start();
      }
      return 0;
    }
    const result = await executeCommand(app, command, args, options);
    if (command === 'export') {
      if (options.format === 'links') {
        process.stdout.write(result.toBinary());
      } else if (options.format === 'lino') {
        stdout(result.toNotation());
      } else {
        stdout(JSON.stringify(result.links));
      }
    } else {
      stdout(
        options.format === 'lino'
          ? encode({ obj: result ?? null })
          : JSON.stringify(result ?? null, null, 2)
      );
    }
    return 0;
  } catch (error) {
    stderr(error.message);
    return 1;
  } finally {
    if (app && !persistent) {
      await app.close();
    }
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
