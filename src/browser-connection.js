import { connectBrowser } from 'browser-commander';

// A headed Chrome process may remain alive after its final window closes.
// Chrome rejects Playwright's default download override until a page exists.
export async function connectPersistentBrowser(
  options,
  {
    connect = connectBrowser,
    loadChromium = async () => (await import('playwright')).chromium,
  } = {}
) {
  try {
    return await connect(options);
  } catch (error) {
    if (
      !/Browser\.setDownloadBehavior/u.test(error.message) ||
      !/Browser context management is not supported/u.test(error.message)
    ) {
      throw error;
    }
    const chromium = await loadChromium();
    const browser = await chromium.connectOverCDP(options.cdpEndpoint, {
      timeout: options.timeout,
      noDefaults: true,
    });
    try {
      const context = browser.contexts()[0];
      if (!context) {
        throw new Error('Recovered Chrome has no default context');
      }
      if (context.pages().length === 0) {
        await context.newPage();
      }
    } finally {
      // Attached Playwright close disconnects; the owned Chrome stays alive.
      await browser.close();
    }
    return await connect(options);
  }
}
