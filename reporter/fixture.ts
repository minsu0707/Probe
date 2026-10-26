import { test as base, expect, type Page } from '@playwright/test';
import { connected, send, sendFrame } from './transport.ts';

const FRAME_INTERVAL_MS = 1200;

/**
 * Grab a small JPEG without showing up as a "Screenshot" step in the test's own report.
 * Chromium's DevTools protocol does that; other engines fall back to page.screenshot.
 */
async function frameGrabber(page: Page): Promise<() => Promise<Buffer>> {
  try {
    const cdp = await page.context().newCDPSession(page);
    return async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 })).data, 'base64');
  } catch {
    return () => page.screenshot({ type: 'jpeg', quality: 55, timeout: 1000 });
  }
}

/**
 * Drop-in replacement for Playwright's `test`. In a dashboard run it reports the page the
 * test is on and streams a small live screenshot. Outside one it behaves exactly like `test`.
 */
export const test = base.extend<{ _probe: void }>({
  _probe: [
    async ({ page }, use, testInfo) => {
      if (!connected) return use();
      const id = testInfo.testId;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url() !== 'about:blank') void send([{ type: 'page', id, url: frame.url() }]);
      });
      let grab: (() => Promise<Buffer>) | undefined;
      let busy = false;
      const timer = setInterval(async () => {
        if (busy || page.isClosed() || page.url() === 'about:blank') return;
        busy = true;
        try {
          grab ??= await frameGrabber(page);
          await sendFrame(await grab());
        } catch {
          /* page is navigating or closing; the next tick will catch up */
        } finally {
          busy = false;
        }
      }, FRAME_INTERVAL_MS);
      try {
        await use();
      } finally {
        clearInterval(timer);
      }
    },
    { auto: true },
  ],
});

/**
 * Tell the dashboard which screen or state the test is looking at.
 * `await view('Order list', 'Orders')` shows "Orders › Order list" on the monitor.
 */
export async function view(name: string, feature?: string): Promise<void> {
  await send([{ type: 'view', id: test.info().testId, name, feature }]);
}

export { expect };
