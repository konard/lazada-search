async function openCdpSession(page) {
  const { createCdpSession } = await import('browser-commander');
  return await createCdpSession(page);
}

// Capture only the visible view. Full-page compositor captures can briefly
// disturb a watched Chrome window even when DOM scroll coordinates stay fixed.
export async function captureViewport(
  page,
  { openSession = openCdpSession, timeoutMs = 15000 } = {}
) {
  const viewport = await page.evaluate(() => ({
    x: globalThis.scrollX,
    y: globalThis.scrollY,
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    deviceScaleFactor: globalThis.devicePixelRatio,
  }));
  let session;
  let timer;
  let bytes;
  let method = 'cdp-view';
  try {
    session = await openSession(page);
    const response = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: false,
        captureBeyondViewport: false,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Viewport capture timed out')),
          timeoutMs
        );
      }),
    ]);
    bytes = Buffer.from(response.data, 'base64');
  } catch {
    // Engines without CDP still use viewport-only capture. Never fall back to
    // a full-page screenshot, viewport resize, or temporary scroll to the top.
    method = 'engine-viewport';
    bytes = await page.screenshot({
      type: 'png',
      fullPage: false,
      timeout: timeoutMs,
    });
  } finally {
    clearTimeout(timer);
    await session?.detach().catch(() => {});
  }
  return { bytes, method, ...viewport };
}

export async function storeViewport(store, page, role) {
  const { bytes, ...viewport } = await captureViewport(page);
  return { role, blob: await store.putBlob(bytes), ...viewport };
}
