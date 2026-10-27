/**
 * Runs as its own process (spawned by explore.ts): opens the live service in a browser, signs in
 * as each account it was given (a fresh browser session per account, since each role sees different
 * menus), and walks through its pages and menus, writing what it sees to PROBE_EXPLORE_OUT:
 * pages.md (one section per screen, grouped by account) and shots/NNN.jpg. It only looks. Every request that is not a
 * read (or a sign-in) is refused in the browser, and links or menu items that log out or delete
 * are never touched. Progress goes to stdout as JSON lines.
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { allowRequest } from '../../../reporter/guard.ts';
import { NOT_A_PAGE, isDangerousLabel, isDangerousUrl, pageKey, pagePattern, snapshotToMarkdown, type PageSnapshot } from './explore-helpers.ts';

const BASE = process.env.PROBE_EXPLORE_URL ?? '';
const OUT = process.env.PROBE_EXPLORE_OUT ?? '';
interface Account {
  /** Role label for the notes, e.g. ADMIN. Never the ID itself. */
  name: string;
  user: string;
  pass: string;
}
const ACCOUNTS: Account[] = JSON.parse(process.env.PROBE_EXPLORE_ACCOUNTS ?? '[]');
/** Limits are per account, so one account cannot use up the budget of the next. */
const MAX_PAGES = Number(process.env.PROBE_EXPLORE_MAX_PAGES ?? 50);
const MAX_MS = Number(process.env.PROBE_EXPLORE_MAX_MS ?? 6 * 60_000);
const SAMPLES_PER_PATTERN = 2;
const CLICK_PAGES = 3; // menus are explored by clicking only on the first few screens
const MAX_CLICKS = 90;
const MENU_SELECTOR = [
  'nav button', 'nav [role=button]', 'nav li', 'nav a:not([href])', 'nav [role=menuitem]',
  'aside button', 'aside li', 'aside a:not([href])',
  'header button', 'header [role=tab]',
  '[role=menuitem]', '[role=tab]', '[role=treeitem]',
  '.sidebar li', '.sidebar button', '.gnb li', '.gnb button', '.lnb li', '.lnb button',
].join(', ');

const say = (text: string) => console.log(JSON.stringify({ type: 'progress', text }));
const started = Date.now();
let accountStarted = started;
const timeUp = () => Date.now() - accountStarted > MAX_MS;
/** Section and screenshot numbers run on across accounts. */
let shotNumber = 0;

if (!BASE || !OUT) {
  console.error('PROBE_EXPLORE_URL and PROBE_EXPLORE_OUT are required');
  process.exit(2);
}
const origin = new URL(BASE).origin;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'shots'), { recursive: true });
writeFileSync(join(OUT, 'pages.md'), `# 서비스 직접 둘러보기 결과\n\n${BASE}를 브라우저로 읽기만 하며 둘러본 화면입니다. 값을 입력하거나 저장하지 않았습니다.\n\n`);

async function settle(page: Page, ms = 6000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => undefined);
  await page.waitForTimeout(350);
}

async function snapshot(page: Page, n: number, label?: string): Promise<PageSnapshot> {
  const data = await page.evaluate(() => {
    const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const texts = (sel: string, max: number, maxLen = 40) => [...new Set([...document.querySelectorAll(sel)].filter(visible).map(text).filter((t) => t && t.length <= maxLen))].slice(0, max);
    const labelFor = (el: Element) => {
      const id = el.getAttribute('id');
      const l = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) || el.closest('label');
      return (l && text(l)) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '';
    };
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]), textarea, select')]
      .filter(visible)
      .map((el) => `${labelFor(el)}${el.tagName === 'SELECT' ? ' (선택)' : (el as HTMLInputElement).type && (el as HTMLInputElement).type !== 'text' ? ` (${(el as HTMLInputElement).type})` : ''}`.trim())
      .filter(Boolean);
    const selects = [...document.querySelectorAll('select')]
      .filter(visible)
      .slice(0, 8)
      .map((el) => `${labelFor(el) || '선택'}: ${[...(el as HTMLSelectElement).options].slice(0, 6).map((o) => o.text.trim()).join(', ')}${(el as HTMLSelectElement).options.length > 6 ? ` 외 ${(el as HTMLSelectElement).options.length - 6}개` : ''}`);
    const tables = [...document.querySelectorAll('table')]
      .filter(visible)
      .slice(0, 5)
      .map((t) => [...t.querySelectorAll('thead th, tr:first-child th')].map(text).filter(Boolean))
      .filter((h) => h.length);
    return {
      title: document.title,
      headings: texts('h1, h2, h3', 15, 80),
      nav: texts('nav a, nav button, aside a, [role=menuitem], .sidebar a, .gnb a, .lnb a', 40),
      tabs: texts('[role=tab]', 20),
      tables,
      fields: [...new Set(fields)].slice(0, 30),
      buttons: texts('button, [role=button], input[type=submit], input[type=button]', 25),
      selects,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 900),
    };
  });
  const shotName = `shots/${String(n).padStart(3, '0')}.jpg`;
  const shot = await page
    .screenshot({ path: join(OUT, shotName), type: 'jpeg', quality: 55, timeout: 5000 })
    .then(() => shotName)
    .catch(() => null);
  const snap: PageSnapshot = { url: label ? `${page.url()} (${label})` : page.url(), ...data, title: label ? `${data.title || page.url()} › ${label}` : data.title, shot };
  appendFileSync(join(OUT, 'pages.md'), `${snapshotToMarkdown(n, snap)}\n\n`);
  return snap;
}

async function signIn(page: Page, account: Account | null): Promise<boolean> {
  const pw = page.locator('input[type=password]:visible').first();
  if ((await pw.count()) === 0) return true; // nothing to sign in to
  if (!account || !account.user || !account.pass) {
    say('로그인 정보(ID/비밀번호 변수)가 없어 로그인 전 화면만 둘러봅니다');
    return false;
  }
  const form = pw.locator('xpath=ancestor::form[1]');
  const scope = (await form.count()) ? form : page.locator('body');
  const user = scope.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):visible').first();
  await user.fill(account.user).catch(() => undefined);
  await pw.fill(account.pass).catch(() => undefined);
  await pw.press('Enter').catch(() => undefined);
  await settle(page, 10_000);
  if ((await page.locator('input[type=password]:visible').count()) > 0) {
    await page.getByRole('button', { name: /로그인|login|log in|sign in/i }).first().click({ timeout: 3000 }).catch(() => undefined);
    await settle(page, 10_000);
  }
  const ok = (await page.locator('input[type=password]:visible').count()) === 0;
  say(ok ? `로그인했습니다 (${account.name})` : `로그인하지 못했습니다 (${account.name}). 로그인 전 화면만 둘러봅니다`);
  return ok;
}

async function exploreAccount(account: Account | null): Promise<{ name: string; signedIn: boolean; pages: number; stoppedBy: 'complete' | 'limit' | 'time' }> {
  accountStarted = Date.now();
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1366, height: 800 } });
  // Looking only: reads and sign-in pass, everything else is refused.
  await context.route('**/*', (route) => {
    const r = route.request();
    return allowRequest(r.method(), r.url(), r.postData()) ? route.fallback() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  context.on('page', (p) => void (p !== page && p.close().catch(() => undefined)));
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await settle(page);
  const signedIn = await signIn(page, account);
  let stoppedBy: 'complete' | 'limit' | 'time' = 'complete';
  let visitedCount = 0;
  const who = account?.name ?? '로그인 전';
  appendFileSync(join(OUT, 'pages.md'), `# 계정: ${who}${account ? (signedIn ? '' : ' (로그인 실패)') : ''}

`);

  const seenKeys = new Set<string>();
  const perPattern = new Map<string, number>();
  const queue: string[] = [];

  const consider = (raw: string): void => {
    const key = pageKey(raw, origin);
    if (!key || seenKeys.has(key) || NOT_A_PAGE.test(key) || isDangerousUrl(raw)) return;
    const pattern = pagePattern(key);
    if ((perPattern.get(pattern) ?? 0) >= SAMPLES_PER_PATTERN) return;
    seenKeys.add(key);
    perPattern.set(pattern, (perPattern.get(pattern) ?? 0) + 1);
    queue.push(raw);
  };
  const links = async (): Promise<void> => {
    const found = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim() })));
    for (const l of found) if (!isDangerousLabel(l.text)) consider(l.href);
  };

  // The screen we are on after sign-in is the first page.
  const landing = pageKey(page.url(), origin);
  if (landing) {
    seenKeys.add(landing);
    perPattern.set(pagePattern(landing), 1);
  }
  await snapshot(page, ++shotNumber); visitedCount++;
  say(`[${who}] 화면 ${visitedCount}: ${page.url()}`);
  await links();

  /**
   * Menus that are not links (single-page apps and button bars): click each, and keep a screen when
   * what the page shows changed. Clicking can open submenus, a submenu that appears is walked
   * right away (up to three levels deep). Only navigation areas are clicked; a click that would write is
   * refused by the request guard anyway.
   */
  const signature = () => page.evaluate(() => `${location.href}|${(document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1500)}`);
  const seenSignatures = new Set<string>();
  const clickedLabels = new Set<string>();
  let totalClicks = 0;
  const menuLabels = async (): Promise<Set<string>> => {
    const texts = await page.locator(MENU_SELECTOR).evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/s+/g, ' ').trim()));
    return new Set(texts.filter(Boolean));
  };
  /** `only`: just these labels (the submenu a click opened), so a sibling click cannot close it first. */
  const clickMenus = async (depth = 0, only?: Set<string>): Promise<void> => {
    seenSignatures.add(await signature());
    {
      const menu = page.locator(MENU_SELECTOR);
      const count = Math.min(await menu.count(), 150);
      for (let i = 0; i < count && visitedCount < MAX_PAGES && totalClicks < MAX_CLICKS && !timeUp(); i++) {
        const item = menu.nth(i);
        const label = ((await item.textContent({ timeout: 1500 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
        if (!label || label.length > 40 || (only && !only.has(label)) || clickedLabels.has(label) || isDangerousLabel(label) || !(await item.isVisible().catch(() => false))) continue;
        clickedLabels.add(label);
        totalClicks++;
        const before = page.url();
        const labelsBefore = depth < 3 ? await menuLabels() : new Set<string>();
        await item.click({ timeout: 2500 }).catch(() => undefined);
        await settle(page, 4000);
        // Left the service (an external link) or opened a dialog: undo that and carry on.
        if (!pageKey(page.url(), origin)) await page.goBack().catch(() => undefined);
        else await page.keyboard.press('Escape').catch(() => undefined);
        const key = pageKey(page.url(), origin);
        const sig = await signature();
        if (page.url() !== before && key && !seenKeys.has(key)) {
          seenKeys.add(key);
          perPattern.set(pagePattern(key), (perPattern.get(pagePattern(key)) ?? 0) + 1);
          seenSignatures.add(sig);
          await snapshot(page, ++shotNumber); visitedCount++;
          say(`[${who}] 화면 ${visitedCount}: ${page.url()}`);
          await links();
        } else if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          await snapshot(page, ++shotNumber, label); visitedCount++;
          say(`[${who}] 화면 ${visitedCount}: ${label}`);
        }
        // The click opened a submenu: go through it now, before the next top-level click closes it again.
        if (depth < 3) {
          const opened = new Set([...(await menuLabels())].filter((l) => !labelsBefore.has(l)));
          if (opened.size) await clickMenus(depth + 1, opened);
        }
      }
    }
  };
  await clickMenus();

  let visitedViaQueue = 0;
  while (queue.length && visitedCount < MAX_PAGES) {
    if (timeUp()) {
      stoppedBy = 'time';
      break;
    }
    const url = queue.shift()!;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } catch {
      continue;
    }
    await settle(page);
    // A session that expired sends us back to the login form; sign in again and carry on.
    if ((await page.locator('input[type=password]:visible').count()) > 0 && signedIn) await signIn(page, account);
    await snapshot(page, ++shotNumber); visitedCount++;
    say(`[${who}] 화면 ${visitedCount}: ${page.url()}`);
    await links();
    if (++visitedViaQueue < CLICK_PAGES) await clickMenus();
  }
  if (queue.length && visitedCount >= MAX_PAGES) stoppedBy = 'limit';
  await context.close().catch(() => undefined);
  return { name: who, signedIn, pages: visitedCount, stoppedBy };
}

const browser = await chromium.launch({ channel: (process.env.PROBE_BROWSER_CHANNEL as 'msedge' | 'chrome' | undefined) || undefined, headless: true });
const results: { name: string; signedIn: boolean; pages: number; stoppedBy: string }[] = [];
try {
  // Each account in its own browser session. Without any account the sign-in screen is still read.
  for (const account of ACCOUNTS.length ? ACCOUNTS : [null]) results.push(await exploreAccount(account));
} finally {
  await browser.close().catch(() => undefined);
}
const visitedCount = results.reduce((n, r) => n + r.pages, 0);
const signedIn = results.some((r) => r.signedIn);
const stoppedBy = results.find((r) => r.stoppedBy !== 'complete')?.stoppedBy ?? 'complete';

writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ url: BASE, pages: visitedCount, signedIn, stoppedBy, accounts: results, seconds: Math.round((Date.now() - started) / 1000) }));
console.log(JSON.stringify({ type: 'done', pages: visitedCount, signedIn, stoppedBy }));
