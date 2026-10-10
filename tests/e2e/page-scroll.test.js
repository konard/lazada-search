import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AssociativeStore,
  BrowserCollector,
  EvidenceCache,
  DomainScheduler,
} from '../../src/index.js';
import { scrollProductContent } from '../../src/page-scroll.js';
import { captureViewport } from '../../src/page-capture.js';

async function assertStableCapture(page) {
  await page.evaluate(() => {
    globalThis.captureFrames = [];
    globalThis.captureActive = true;
    const record = () => {
      globalThis.captureFrames.push([
        globalThis.scrollX,
        globalThis.scrollY,
        globalThis.innerWidth,
        globalThis.innerHeight,
        globalThis.visualViewport.pageTop,
        globalThis.visualViewport.height,
      ]);
      if (globalThis.captureActive) {
        globalThis.requestAnimationFrame(record);
      }
    };
    record();
  });
  const capture = await captureViewport(page);
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => {
    globalThis.captureActive = false;
    return globalThis.captureFrames;
  });
  assert.ok(['cdp-view', 'engine-viewport'].includes(capture.method));
  assert.ok(frames.length > 2);
  assert.ok(
    frames.every(
      (frame) => JSON.stringify(frame) === JSON.stringify(frames[0])
    ),
    'capture never scrolls or resizes the view between frames'
  );
  assert.equal(
    capture.bytes.readUInt32BE(16),
    capture.width * capture.deviceScaleFactor
  );
  assert.equal(
    capture.bytes.readUInt32BE(20),
    capture.height * capture.deviceScaleFactor
  );

  // The unsupported-CDP fallback obeys the same no-scroll viewport contract.
  const fallback = await captureViewport(page, {
    openSession: async () => {
      throw new Error('Unsupported protocol');
    },
  });
  assert.equal(fallback.method, 'engine-viewport');
  assert.equal(fallback.y, capture.y);
  assert.equal(
    fallback.bytes.readUInt32BE(20),
    fallback.height * fallback.deviceScaleFactor
  );
  const after = await page.evaluate(() => [
    globalThis.scrollX,
    globalThis.scrollY,
    globalThis.innerWidth,
    globalThis.innerHeight,
  ]);
  assert.deepEqual(after, frames[0].slice(0, 4));
}

test('animated search scrolling keeps the final products and pager visible above the footer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lazada-scroll-'));
  const store = new AssociativeStore({ directory });
  const collector = new BrowserCollector({
    store,
    cache: new EvidenceCache({
      store,
      scheduler: new DomainScheduler({ intervalMs: 0 }),
    }),
    settleMs: 0,
    browserOptions: { launch: 'engine', persistent: false },
  });
  t.after(async () => {
    await collector.close();
    await rm(directory, { recursive: true, force: true });
  });
  await collector.start();
  const page = collector.runtime.page;
  await page.route('https://www.lazada.vn/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<style>body{margin:0}header{position:fixed;top:0;width:100%;height:110px;background:white;z-index:1}main{padding-top:140px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}.card{height:240px}nav{height:50px;margin-top:25px}footer{height:3000px;margin-top:40px}</style><header>Product search</header><main><div class="grid">${Array.from({ length: 40 }, (_, index) => `<article data-product-card class="card"><a href="/products/whey-i${index + 1}.html" title="Whey ${index + 1} 500g">Whey ${index + 1} 500g</a><span data-card-price>100.000 ₫</span></article>`).join('')}</div><nav data-pagination><span aria-current="page">1</span><button data-next-page aria-disabled="true">Next</button></nav></main><footer>Unrelated footer</footer><script>window.scrollPositions=[];addEventListener('scroll',()=>window.scrollPositions.push(scrollY));</script>`,
    })
  );
  const capture = await collector.page('https://www.lazada.vn/catalog/?q=whey');
  assert.equal(capture.snapshot.cards.length, 40);
  assert.equal(capture.scrolling.kind, 'product-grid');
  assert.equal(capture.scrolling.pagerObserved, true);
  assert.equal(capture.scrolling.settled, true);
  assert.equal(capture.screenshotMode, 'viewport');
  assert.deepEqual(
    capture.screenshots.map((view) => view.role),
    ['before-scroll', 'after-scroll']
  );
  assert.equal(capture.screenshots[0].y, 0);
  assert.equal(capture.screenshots[1].y, capture.scrolling.position);
  assert.equal(capture.screenshot.sha256, capture.screenshots[1].blob.sha256);
  for (const view of capture.screenshots) {
    const png = await store.blob(view.blob.sha256);
    assert.equal(png.readUInt32BE(16), view.width * view.deviceScaleFactor);
    assert.equal(png.readUInt32BE(20), view.height * view.deviceScaleFactor);
  }
  const view = await page.evaluate(() => ({
    height: globalThis.innerHeight,
    pager: globalThis.document
      .querySelector('[data-pagination]')
      .getBoundingClientRect()
      .toJSON(),
    lastProduct: globalThis.document
      .querySelector('[data-product-card]:last-child')
      .getBoundingClientRect()
      .toJSON(),
    footerTop: globalThis.document
      .querySelector('footer')
      .getBoundingClientRect().top,
    positions: globalThis.scrollPositions,
  }));
  assert.ok(
    view.lastProduct.top >= 110,
    'final product stays below the sticky header'
  );
  assert.ok(view.pager.bottom <= view.height, 'pager fits inside the viewport');
  assert.ok(view.footerTop > view.height, 'footer stays outside the viewport');
  assert.ok(view.positions.length > 20, 'animation uses intermediate frames');
  assert.ok(
    view.positions.every((position) => position <= capture.scrolling.target + 1)
  );
  assert.ok(
    view.positions
      .slice(1)
      .every(
        (position, index) => Math.abs(position - view.positions[index]) < 100
      ),
    'scroll advances gradually without fixed pixel jumps'
  );

  // Reusing a window that somebody scrolled into the footer corrects its view.
  await page.evaluate(() =>
    globalThis.scrollTo(0, globalThis.document.body.scrollHeight)
  );
  const corrected = await scrollProductContent(page);
  assert.equal(corrected.settled, true);
  assert.ok(Math.abs(corrected.position - capture.scrolling.position) < 2);

  // The real minimized Lazada chat control must not cover the pager.
  await page.evaluate(() => {
    globalThis.document.querySelector('footer').style.marginTop = '120px';
    const chat = globalThis.document.createElement('button');
    chat.className = 'im-app__cont-minimize';
    chat.style.cssText =
      'position:fixed;bottom:0;right:0;width:180px;height:48px';
    chat.textContent = 'Chat';
    globalThis.document.body.append(chat);
  });
  const withChat = await scrollProductContent(page);
  assert.equal(withChat.settled, true);
  assert.equal(withChat.bottomInset, 64);
  const unobstructed = await page.evaluate(() => ({
    pagerBottom: globalThis.document
      .querySelector('[data-pagination]')
      .getBoundingClientRect().bottom,
    chatTop: globalThis.document
      .querySelector('.im-app__cont-minimize')
      .getBoundingClientRect().top,
    footerTop: globalThis.document
      .querySelector('footer')
      .getBoundingClientRect().top,
    height: globalThis.innerHeight,
  }));
  assert.ok(unobstructed.pagerBottom <= unobstructed.chatTop - 16);
  assert.ok(unobstructed.footerTop > unobstructed.height);
  await assertStableCapture(page);

  // Pages without a recognized product region must never seek the body bottom.
  await page.setContent(
    '<header>Empty search</header><footer style="height:5000px">Footer</footer>'
  );
  const unknown = await scrollProductContent(page);
  assert.equal(unknown.known, false);
  assert.equal(unknown.steps, 0);
});
