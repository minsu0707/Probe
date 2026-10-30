import { writeFile } from 'node:fs/promises';
import { test as base, expect, type Page } from '@playwright/test';
import { allowRequest } from './guard.ts';
import { instrument, setCurrentTest } from './instrument.ts';
import { connected, send, sendFrame } from './transport.ts';

/** Fallback polling, used only while the live stream is silent (and for engines without DevTools). */
const FALLBACK_INTERVAL_MS = 1500;
const STREAM_SILENT_MS = 2500;
/** At most this many frames a second leave the browser; the newest one wins, older ones are dropped. */
const MIN_FRAME_GAP_MS = 70;

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
 * Chromium pushes a frame whenever the page repaints (what Playwright's own video uses), so the
 * dashboard follows the test as it happens instead of sampling it. Returns a stop function and
 * the time of the last frame, or null when the browser cannot stream.
 */
async function startStream(page: Page): Promise<{ stop: () => void; lastFrameAt: () => number } | null> {
  try {
    const cdp = await page.context().newCDPSession(page);
    let latest: Buffer | null = null;
    let sending = false;
    let last = 0;
    const pump = async () => {
      if (sending) return;
      sending = true;
      try {
        while (latest) {
          const frame = latest;
          latest = null;
          await sendFrame(frame);
          await new Promise((r) => setTimeout(r, MIN_FRAME_GAP_MS));
        }
      } finally {
        sending = false;
      }
    };
    cdp.on('Page.screencastFrame', (e) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
      if (page.url() === 'about:blank') return;
      last = Date.now();
      latest = Buffer.from(e.data, 'base64');
      void pump();
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 });
    return {
      stop: () => void cdp.send('Page.stopScreencast').then(() => cdp.detach()).catch(() => undefined),
      lastFrameAt: () => last,
    };
  } catch {
    return null;
  }
}

/**
 * Drop-in replacement for Playwright's `test`. In a dashboard run it reports the page the
 * test is on and streams a small live screenshot. Outside one it behaves exactly like `test`.
 */
export const test = base.extend<{ _probe: void }>({
  _probe: [
    async ({ page, browser }, use, testInfo) => {
      // 조회 전용 service: refuse requests that would change data. Applies to the whole context, so popups are covered too.
      if (process.env.PROBE_READ_ONLY === '1') {
        const blocked = new Set<string>();
        await page.context().route('**/*', (route) => {
          const r = route.request();
          if (allowRequest(r.method(), r.url(), r.postData())) return route.fallback();
          const what = `${r.method()} ${new URL(r.url()).pathname}`;
          if (!blocked.has(what) && blocked.size < 20) {
            blocked.add(what);
            testInfo.annotations.push({ type: '조회 전용: 쓰기 요청 차단', description: what });
          }
          return route.abort('blockedbyclient');
        });
      }
      if (!connected) return use();
      const id = testInfo.testId;
      instrument(browser, page);
      setCurrentTest(id);
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url() !== 'about:blank') void send([{ type: 'page', id, url: frame.url() }]);
      });
      const stream = await startStream(page);
      let grab: (() => Promise<Buffer>) | undefined;
      let busy = false;
      // Safety net: if the stream goes quiet (a page the browser does not repaint, or a stream
      // that never started), still send a frame now and then.
      const timer = setInterval(async () => {
        if (busy || page.isClosed() || page.url() === 'about:blank') return;
        if (stream && Date.now() - stream.lastFrameAt() < STREAM_SILENT_MS) return;
        busy = true;
        try {
          grab ??= await frameGrabber(page);
          await sendFrame(await grab());
        } catch {
          /* page is navigating or closing; the next tick will catch up */
        } finally {
          busy = false;
        }
      }, FALLBACK_INTERVAL_MS);
      // Specs often open their own context (to log in through the API first), so the failure
      // screen is whichever real page the test left open, not the unused `page` fixture.
      let lastShot: Buffer | null = null;
      const keepScreen = async () => {
        const pages = [page, ...browser.contexts().flatMap((c) => c.pages())].filter((p) => !p.isClosed() && p.url() !== 'about:blank');
        const current = pages.at(-1);
        if (!current) return;
        try {
          lastShot = await current.screenshot({ type: 'png', timeout: 3000 });
        } catch {
          /* page is navigating or closing; keep the previous one */
        }
      };
      const screenTimer = setInterval(() => void keepScreen(), FALLBACK_INTERVAL_MS);
      try {
        await use();
      } finally {
        clearInterval(timer);
        clearInterval(screenTimer);
        setCurrentTest(null);
        stream?.stop();
        if (testInfo.status !== testInfo.expectedStatus) {
          await keepScreen();
          if (lastShot) {
            // The reporter reads attachments by file path, so a body-only attachment would be invisible to it.
            const path = testInfo.outputPath('probe-screenshot.png');
            await writeFile(path, lastShot);
            await testInfo.attach('probe-screenshot', { path, contentType: 'image/png' });
          }
        }
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
