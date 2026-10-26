/**
 * Render the app and tray icons from the logo. Run once after changing the logo:
 *
 *   node scripts/make-icons.ts
 *
 * Output goes to desktop/assets/ and is committed, so building the installer needs no browser.
 * Uses the Playwright Chromium (or Edge) that is already required for running tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'assets');
const ACCENT = '#2554d8';

/** The logo: a ring, a crosshair and a centre dot, on a 32×32 grid. */
const logo = (color: string) => `
  <circle cx="16" cy="16" r="11" fill="none" stroke="${color}" stroke-width="3"/>
  <path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="3.5" fill="${color}"/>`;

/** App icon: white logo on a blue rounded square, so it reads on any taskbar or desktop. */
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${ACCENT}"/><g transform="translate(4 4) scale(.75)">${logo('#fff')}</g></svg>`;
/** Tray icon: blue logo, no background. */
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${logo(ACCENT)}</svg>`;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
const page = await browser.newPage();

async function render(svg: string, size: number, file: string) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body>`);
  writeFileSync(join(OUT, file), await page.screenshot({ omitBackground: true }));
}

await render(appSvg, 512, 'icon.png'); // electron-builder converts this to the .exe's .ico
await render(traySvg, 32, 'tray.png');
await render(traySvg, 64, 'tray@2x.png'); // Windows picks this on high-DPI screens
await browser.close();
console.log('Wrote icon.png, tray.png, tray@2x.png to', OUT);
