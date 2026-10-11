import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LazadaSearch,
  DomainScheduler,
  phoneLoginState,
} from '../src/index.js';
import { configuredStore, parseArguments } from '../src/config.js';
import { resolvePageDialogs } from '../src/page-dialogs.js';
import { storeViewport } from '../src/page-capture.js';
import { classifyPage } from '../src/browser.js';
import {
  dedupeVouchers,
  extractCodeCandidates,
  extractPromotionBlocks,
  findVoucherObjects,
  normalizeApiVoucher,
  parseVoucherText,
} from '../src/promotions.js';
import { renderPromotionReport } from './promotion-report.mjs';

// Collects Lazada campaign pages, voucher hubs and product/shop pages in the
// account's Browser Commander window, plus typed codes listed by public
// coupon sites. Every voucher keeps its source; none is treated as applied.

const ROUTER =
  'https://pages.lazada.vn/wow/gcp/route/lazada/vn/upr_1000345_lazada/channel/vn/upr-router/vn?hybrid=1&data_prefetch=true&prefetch_replace=1&at_iframe=1&wh_pid=';

export const LAZADA_TARGETS = (campaign) => [
  { role: 'homepage', url: 'https://www.lazada.vn/' },
  {
    role: 'campaign',
    url: `${ROUTER}/lazada/megascenario/vn/${campaign}/trang-chinh`,
  },
  {
    role: 'campaign-root',
    url: `${ROUTER}/lazada/megascenario/vn/${campaign}`,
  },
  {
    role: 'voucher-hub',
    url: `${ROUTER}/lazada/channel/vn/voucher/claimvoucher`,
  },
  {
    role: 'payment-offers',
    url: `${ROUTER}/lazada/channel/vn/thanh-toan/uu-dai-thanh-toan`,
  },
  {
    role: 'flash-sale',
    url: `${ROUTER}/lazada/channel/vn/shopping-guide/lazflash`,
  },
  {
    role: 'lazmall',
    url: `${ROUTER}/lazada/channel/vn/lazmall-channel/lazmall-channel-pc`,
  },
  {
    role: 'app-offers',
    url: 'https://www.lazada.vn/wow/i/vn/VNCampaign/uu-dai-tren-lazada-app/',
  },
];

// Public coupon aggregators. Their codes are unverified leads: affiliate
// pages often recycle older campaigns.
export const CODE_SOURCES = [
  'https://iprice.vn/ma-giam-gia/lazada/',
  'https://magiamgia.com/lazada/',
  'https://magiamgia.com/lazada-sale-10-10/',
  'https://magiamgialazada.vn/lazada-10-10/',
  'https://www.picodi.com/vn/lazada',
  'https://anhvoucher.com/ma-giam-gia/lazada/',
];

const OWN_FLAGS = {
  '--campaign': 'campaign',
  '--out': 'out',
  '--max-promo-pages': 'maxPromoPages',
  '--code-source': 'codeSources',
  '--since': 'since',
};
const OWN_SWITCHES = {
  '--skip-lazada': 'skipLazada',
  '--skip-codes': 'skipCodes',
  '--require-login': 'requireLogin',
};

// The shared parser rejects unknown flags, so this script's own options are
// separated first.
export function splitArguments(argv) {
  const own = { codeSources: [] };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split(/=(.*)/su);
    if (OWN_SWITCHES[flag]) {
      own[OWN_SWITCHES[flag]] = inline !== 'false';
    } else if (OWN_FLAGS[flag]) {
      const value = inline ?? argv[++index];
      if (!value) {
        throw new Error(`${flag} requires a value`);
      }
      if (flag === '--code-source') {
        own.codeSources.push(value);
      } else {
        own[OWN_FLAGS[flag]] = value;
      }
    } else {
      rest.push(argv[index]);
    }
  }
  return { own, rest };
}

export function pageStatus(extracted, requestedUrl) {
  const status = classifyPage({
    url: extracted.url,
    title: extracted.title,
    rawText: extracted.observedText,
  });
  if (status !== 'ok' && status !== 'unavailable') {
    return status;
  }
  if (
    /page not found/iu.test(extracted.title) ||
    /we[’']re sorry|lost this page|không tìm thấy trang/iu.test(
      extracted.observedText.slice(0, 2000)
    )
  ) {
    return 'not-found';
  }
  const requested = new URL(requestedUrl);
  const final = new URL(extracted.url);
  if (
    requested.searchParams.get('wh_pid') &&
    !final.searchParams.get('wh_pid') &&
    /^\/?#?$/u.test(final.pathname)
  ) {
    return 'redirected-home';
  }
  return 'ok';
}

// Campaign sub-pages and promo links found on visited pages.
export function campaignLinks(links, campaign) {
  const found = new Map();
  for (const link of links) {
    // Lazada page links carry HTML-escaped ampersands in their href.
    const href = link.href.replace(/&amp;/gu, '&');
    const { text } = link;
    let url;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const pid = url.searchParams.get('wh_pid') || url.pathname;
    if (
      pid.includes(`/megascenario/vn/${campaign}`) ||
      /\/voucher\/|khuyen-mai|thanh-toan|partnership|freeship|flash/iu.test(pid)
    ) {
      const key = `${url.origin}${url.pathname}?wh_pid=${url.searchParams.get('wh_pid') || ''}`;
      if (!found.has(key)) {
        found.set(key, { url: href, text, pid });
      }
    }
  }
  return [...found.values()];
}

async function scrollPage(page, maxSteps) {
  let last = -1;
  for (let step = 0; step < maxSteps; step += 1) {
    const position = await page.evaluate(() => {
      globalThis.scrollBy({
        top: globalThis.innerHeight * 0.85,
        behavior: 'smooth',
      });
      return Math.round(globalThis.scrollY + globalThis.innerHeight);
    });
    await page.waitForTimeout(1200);
    const height = await page.evaluate(
      () => globalThis.document.body.scrollHeight
    );
    if (position === last || position >= height) {
      break;
    }
    last = position;
  }
}

// Lazada's router closes the tab on unknown routes. Calls to window.close
// are ignored, and a closed tab is replaced in the same browser context so
// the rest of the queue continues.
async function promotionPage(collector) {
  await collector.start();
  const { runtime } = collector;
  if (!collector.closeGuarded) {
    await runtime.page.context().addInitScript(() => {
      globalThis.close = () => {};
    });
    collector.closeGuarded = true;
  }
  if (runtime.page.isClosed()) {
    const { makeBrowserCommander } = await import('browser-commander');
    runtime.page = await runtime.page.context().newPage();
    await runtime.page.route('**/*', collector.imageRoute);
    runtime.page.on('response', collector.imageResponse);
    collector.commander = makeBrowserCommander({
      page: runtime.page,
      enableNetworkTracking: false,
    });
  }
  return { runtime, page: runtime.page, commander: collector.commander };
}

// API bodies are JSON or JSONP; truncated bodies stay saved as raw evidence.
export function apiBodyVouchers(text) {
  try {
    return findVoucherObjects(
      JSON.parse(text.replace(/^[^({]*\(|\)\s*;?\s*$/gu, ''))
    ).map(({ path, fields }) => ({ path, ...normalizeApiVoucher(fields) }));
  } catch {
    return [];
  }
}

// Product tiles advertise their own "[Voucher 12%]" titles and markdowns;
// only promotion cards outside product links count as vouchers.
export function pageVouchers(blocks, url, observedAt) {
  return blocks
    .filter((block) => !/\/products\//u.test(block.href || ''))
    .map((block) => ({
      ...parseVoucherText(block.text, { observedAt }),
      hasAction: block.hasAction,
      sources: [url],
    }))
    .filter((voucher) => voucher.isVoucher);
}

async function capturePromotionPage(app, store, target, options) {
  const { runtime, page, commander } = await promotionPage(app.collector);
  const responses = [];
  const pending = new Set();
  const listener = (response) => {
    const url = response.url();
    if (!/\/h5\/mtop\./iu.test(url) || !response.ok()) {
      return;
    }
    const task = (async () => {
      const text = await response.text();
      if (!/voucher|coupon|promotion|benefit|campaign/iu.test(text)) {
        return;
      }
      responses.push({
        api: url.match(/\/h5\/(mtop\.[^/]+)/iu)?.[1],
        blob: await store.putBlob(Buffer.from(text)),
        vouchers: apiBodyVouchers(text),
      });
    })().catch(() => {});
    pending.add(task);
    task.finally(() => pending.delete(task));
  };
  page.on('response', listener);
  const observedAt = new Date().toISOString();
  try {
    await runtime.touch?.();
    await resolvePageDialogs(page);
    await runtime.pace?.(target.url, options.intervalMs);
    await commander.goto({
      url: target.url,
      timeout: 45000,
      waitUntil: 'domcontentloaded',
      waitForNetworkIdle: false,
    });
    await page.waitForTimeout(4000);
    await resolvePageDialogs(page);
    const screenshots = [await storeViewport(store, page, 'before-scroll')];
    await scrollPage(page, options.maxScrolls);
    await page.waitForTimeout(1500);
    await Promise.all(pending);
    const extracted = await page.evaluate(extractPromotionBlocks);
    screenshots.push(await storeViewport(store, page, 'after-scroll'));
    const html = await store.putBlob(Buffer.from(await page.content()));
    const status = pageStatus(extracted, target.url);
    const record = {
      id: `${target.url}#${observedAt}`,
      role: target.role,
      url: target.url,
      finalUrl: extracted.url,
      title: extracted.title,
      observedAt,
      status,
      html,
      screenshots,
      blocks: extracted.blocks,
      links: extracted.links,
      apiResponses: responses,
      session: options.session ?? null,
    };
    await store.put('promotion-page', record);
    return record;
  } finally {
    page.off('response', listener);
  }
}

// Codes some coupon sites keep in copy-button attributes.
function attributeCodes(document) {
  return [
    ...document.querySelectorAll(
      '[data-code],[data-coupon],[data-clipboard-text]'
    ),
  ]
    .map((element) => ({
      code: (
        element.getAttribute('data-code') ||
        element.getAttribute('data-coupon') ||
        element.getAttribute('data-clipboard-text') ||
        ''
      ).trim(),
      text: (element.closest('article,li,section,div') || element).textContent
        .replace(/\s+/gu, ' ')
        .trim(),
    }))
    .filter(({ code }) => /^[A-Z0-9]{4,20}$/u.test(code));
}

function pageDate(document) {
  return (
    document
      .querySelector(
        'meta[property="article:modified_time"],meta[property="article:published_time"]'
      )
      ?.getAttribute('content') ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    null
  );
}

export function codesFromHtml(html, source, fetchedAt, parseHTML) {
  const { document } = parseHTML(html);
  document
    .querySelectorAll('script,style,noscript')
    .forEach((node) => node.remove());
  const codes = new Map();
  const add = (code, text, fromAttribute = false) => {
    if (!codes.has(code)) {
      codes.set(code, {
        code,
        text: text.slice(0, 300),
        ...parseVoucherText(text),
        fromAttribute,
        source,
        fetchedAt,
        verified: false,
      });
    }
  };
  for (const { code, text } of attributeCodes(document)) {
    add(code, text, true);
  }
  for (const element of document.querySelectorAll('li,article,tr,p,div')) {
    const text = element.textContent.replace(/\s+/gu, ' ').trim();
    if (
      text.length > 20 &&
      text.length < 400 &&
      /mã|code|coupon/iu.test(text)
    ) {
      for (const code of extractCodeCandidates(text)) {
        add(code, text);
      }
    }
  }
  const title = document.querySelector('title')?.textContent?.trim() || '';
  const published = pageDate(document);
  return { source, title, published, fetchedAt, codes: [...codes.values()] };
}

async function collectCodes(store, sources, intervalMs) {
  const { parseHTML } = await import('linkedom');
  const scheduler = new DomainScheduler({
    intervalMs: Math.min(intervalMs, 5000),
  });
  const results = [];
  for (const source of sources) {
    const fetchedAt = new Date().toISOString();
    try {
      const response = await scheduler.run(source, () =>
        fetch(source, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
            'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
          },
          signal: AbortSignal.timeout(30000),
        })
      );
      const html = await response.text();
      const blob = await store.putBlob(Buffer.from(html));
      const result = {
        status: response.status,
        html: blob,
        ...codesFromHtml(html, source, fetchedAt, parseHTML),
      };
      await store.put('promotion-code-source', {
        id: `${source}#${fetchedAt}`,
        ...result,
      });
      results.push(result);
      console.log(
        JSON.stringify({
          source,
          status: response.status,
          codes: result.codes.length,
        })
      );
    } catch (error) {
      results.push({ source, fetchedAt, error: error.message, codes: [] });
      console.log(JSON.stringify({ source, error: error.message }));
    }
  }
  return results;
}

function promotionApp(store, options) {
  return new LazadaSearch({
    store,
    market: options.market,
    deliveryArea: options.deliveryArea,
    ocr: false,
    maxImages: 0,
    scheduler: new DomainScheduler({ intervalMs: options.intervalMs }),
    browserOptions: {
      channel: 'chrome',
      headless: options.headless,
      persistentWindow:
        options.persistentBrowser &&
        (Boolean(options.account) || !options.headless),
      idleTimeoutMs: options.browserIdleMs,
      ...(options.cdpUrl ? { cdpEndpoint: options.cdpUrl } : {}),
      ...(options.executablePath
        ? { executablePath: options.executablePath }
        : {}),
    },
  });
}

// Tracking parameters differ per link; the page identity is its path and
// wh_pid.
export function targetKey(url) {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}?${parsed.searchParams.get('wh_pid') || parsed.search}`;
}

async function visitTarget(app, store, target, context) {
  try {
    const record = await capturePromotionPage(app, store, target, {
      intervalMs: context.intervalMs,
      maxScrolls: 25,
      session: context.session,
    });
    console.log(
      JSON.stringify({
        role: target.role,
        status: record.status,
        title: record.title,
        vouchers: pageVouchers(record.blocks, record.url, record.observedAt)
          .length,
        apis: record.apiResponses.map((item) => item.api),
      })
    );
    return { ...record, session: context.session };
  } catch (error) {
    console.log(
      JSON.stringify({
        role: target.role,
        url: target.url,
        error: error.message,
      })
    );
    return {
      role: target.role,
      url: target.url,
      status: 'error',
      error: error.message,
      blocks: [],
      apiResponses: [],
      links: [],
    };
  }
}

async function collectLazada(store, options, own) {
  const app = promotionApp(store, options);
  const campaign = own.campaign || 'sale-10-10-2026';
  const queue = [
    ...LAZADA_TARGETS(campaign),
    ...options._.map((url) => ({ role: 'requested', url })),
  ];
  const visited = new Set();
  const pages = [];
  const limit = Number(own.maxPromoPages || 25);
  let session = null;
  try {
    await app.collector.start();
    await resolvePageDialogs(app.collector.runtime.page);
    session = (await phoneLoginState(app.collector.runtime.page)).status;
    console.log(JSON.stringify({ session }));
    if (own.requireLogin && session !== 'authenticated') {
      throw new Error(
        'Sign in first: node bin/lazada-search.js login --account default'
      );
    }
    while (queue.length && pages.length < limit) {
      const target = queue.shift();
      if (visited.has(targetKey(target.url))) {
        continue;
      }
      visited.add(targetKey(target.url));
      const record = await visitTarget(app, store, target, {
        intervalMs: options.intervalMs,
        session,
      });
      pages.push(record);
      if (/Unresolved .*dialog/iu.test(record.error || '')) {
        break;
      }
      for (const link of campaignLinks(record.links, campaign)) {
        if (!visited.has(targetKey(link.url))) {
          queue.push({ role: 'discovered', url: link.url, text: link.text });
        }
      }
    }
  } finally {
    await app.close();
  }
  return { campaign, session, pages };
}

// Repeated identical API definitions share source pointers. Changes to terms,
// status, amounts or validity remain separately observed eligibility states.
function mergeApiVouchers(pages) {
  const vouchers = [];
  for (const page of pages) {
    for (const response of page.apiResponses || []) {
      for (const voucher of response.vouchers || []) {
        vouchers.push({
          ...voucher,
          api: response.api,
          sources: [page.url],
          observations: [
            {
              sourceUrl: page.url,
              observedAt: page.observedAt,
              api: response.api,
            },
          ],
        });
      }
    }
  }
  return dedupeVouchers(vouchers);
}

function pageSummary(page) {
  return {
    role: page.role,
    url: page.url,
    finalUrl: page.finalUrl,
    title: page.title,
    observedAt: page.observedAt,
    status: page.status,
    error: page.error,
    vouchers: pageVouchers(page.blocks || [], page.url, page.observedAt).length,
    apiVouchers: (page.apiResponses || []).reduce(
      (total, response) => total + (response.vouchers?.length || 0),
      0
    ),
    apis: [...new Set((page.apiResponses || []).map((item) => item.api))],
    htmlSha256: page.html?.sha256,
  };
}

export function summarize({
  campaign,
  session,
  pages,
  codeSources,
  generatedAt,
}) {
  return {
    generatedAt,
    campaign,
    session,
    pages: pages.map(pageSummary),
    vouchers: dedupeVouchers(
      pages.flatMap((page) =>
        pageVouchers(page.blocks || [], page.url, page.observedAt)
      )
    ).map(({ hasAction, ...voucher }) => ({
      ...voucher,
      collectable: Boolean(hasAction),
    })),
    apiVouchers: mergeApiVouchers(pages),
    codes: codeSources.flatMap((source) => source.codes),
    codeSources: codeSources.map(
      ({ source, title, published, fetchedAt, status, error, codes }) => ({
        source,
        title,
        published,
        fetchedAt,
        status,
        error,
        codes: codes.length,
      })
    ),
  };
}

// Rebuilds a run from saved records and blobs with the current parsers,
// without any network request.
async function storedRun(store, since, campaign) {
  const { parseHTML } = await import('linkedom');
  const text = async (blob) =>
    blob ? (await store.blob(blob.sha256))?.toString('utf8') || '' : '';
  const pages = [];
  for (const page of await store.list('promotion-page')) {
    if (page.observedAt >= since) {
      const apiResponses = [];
      for (const response of page.apiResponses || []) {
        apiResponses.push({
          ...response,
          vouchers: apiBodyVouchers(await text(response.blob)),
        });
      }
      pages.push({ ...page, apiResponses });
    }
  }
  const codeSources = [];
  for (const source of await store.list('promotion-code-source')) {
    if (source.fetchedAt >= since && source.html) {
      codeSources.push({
        ...source,
        ...codesFromHtml(
          await text(source.html),
          source.source,
          source.fetchedAt,
          parseHTML
        ),
      });
    }
  }
  pages.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  codeSources.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  return { campaign, session: pages[0]?.session ?? null, pages, codeSources };
}

async function collectRun(store, options, own, campaign) {
  const lazada = own.skipLazada
    ? { campaign, session: null, pages: [] }
    : await collectLazada(store, options, own);
  const codeSources = own.skipCodes
    ? []
    : await collectCodes(
        store,
        [...CODE_SOURCES, ...own.codeSources],
        options.intervalMs
      );
  return { ...lazada, codeSources };
}

async function main() {
  const { own, rest } = splitArguments(process.argv.slice(2));
  const options = parseArguments(rest);
  const store = configuredStore(options);
  const out = resolve(own.out || join(store.directory, 'promotions'));
  const campaign = own.campaign || 'sale-10-10-2026';
  const run = own.since
    ? await storedRun(store, own.since, campaign)
    : await collectRun(store, options, own, campaign);
  const summary = summarize({ ...run, generatedAt: new Date().toISOString() });
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'promotions.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  await writeFile(join(out, 'README.md'), renderPromotionReport(summary));
  console.log(
    JSON.stringify({
      out,
      pages: summary.pages.length,
      vouchers: summary.vouchers.length,
      apiVouchers: summary.apiVouchers.length,
      codes: summary.codes.length,
    })
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
