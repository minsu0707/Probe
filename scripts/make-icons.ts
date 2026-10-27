/**
 * Render the app, tray and in-page logo from the logo image. Run once after changing the logo:
 *
 *   node scripts/make-icons.ts [path/to/Probe_logo.png]
 *
 * The source defaults to Probe_logo.png in the Downloads folder. It is a large PNG with empty
 * margin and a soft glow, so the visible tile is found by alpha and cropped to a square first.
 * Output goes to desktop/assets/ and web/public/ and is committed, so building the installer
 * needs no browser. Uses the Playwright Chromium (or Edge) that is already required for tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(process.argv[2] ?? join(homedir(), 'Downloads', 'Probe_logo.png'));
const OUTPUTS = [
  { file: join(ROOT, 'desktop', 'assets', 'icon.png'), size: 512 }, // electron-builder converts this to the .exe's .ico
  { file: join(ROOT, 'desktop', 'assets', 'tray.png'), size: 32 },
  { file: join(ROOT, 'desktop', 'assets', 'tray@2x.png'), size: 64 }, // Windows picks this on high-DPI screens
  { file: join(ROOT, 'web', 'public', 'logo.png'), size: 128 }, // sidebar logo and the page's favicon
];

mkdirSync(join(ROOT, 'web', 'public'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.setContent('<body style="margin:0;background:transparent"></body>');

const dataUrl = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;
const rendered: Record<number, string> = await page.evaluate(
  async ({ dataUrl, sizes }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    // Bounding box of the visible tile (the faint glow is below the threshold).
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth;
    probe.height = img.naturalHeight;
    const pctx = probe.getContext('2d')!;
    pctx.drawImage(img, 0, 0);
    const { data, width, height } = pctx.getImageData(0, 0, probe.width, probe.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 128) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const side = Math.max(x1 - x0, y1 - y0) + 1;
    const sx = Math.round((x0 + x1 + 1) / 2 - side / 2);
    const sy = Math.round((y0 + y1 + 1) / 2 - side / 2);

    const out: Record<number, string> = {};
    for (const size of sizes) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      out[size] = c.toDataURL('image/png');
    }
    return out;
  },
  { dataUrl, sizes: OUTPUTS.map((o) => o.size) },
);

for (const { file, size } of OUTPUTS) writeFileSync(file, Buffer.from(rendered[size].split(',')[1], 'base64'));
await browser.close();
console.log('Wrote', OUTPUTS.map((o) => o.file).join('\n      '));
