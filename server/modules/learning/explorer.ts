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
import { OPERATE_NAME, allowOperateRequest, fillValue, isSaveLabel, isSearchField, newLines, recordToMarkdown, type OperateRecord } from './operate-helpers.ts';

const BASE = process.env.PROBE_EXPLORE_URL ?? '';
const OUT = process.env.PROBE_EXPLORE_OUT ?? '';
/** 실제 조작 학습: after looking, fill in the forms found and save each once. Off unless the owner turned it on for a service that may change data. */
const OPERATE = process.env.PROBE_EXPLORE_OPERATE === '1';
const MAX_OPERATE_FORMS = 25;
const MAX_OPERATE_MS = 8 * 60_000;
interface Account {
  /** Role label for the notes, e.g. ADMIN. Never the ID itself. */
  name: string;
  user: string;
  pass: string;
}
const ACCOUNTS: Account[] = JSON.parse(process.env.PROBE_EXPLORE_ACCOUNTS ?? '[]');
/** Limits are per account, so one account cannot use up the budget of the next. */
const MAX_PAGES = Number(process.env.PROBE_EXPLORE_MAX_PAGES ?? 150);
const MAX_MS = Number(process.env.PROBE_EXPLORE_MAX_MS ?? 15 * 60_000);
const SAMPLES_PER_PATTERN = 2;
const CLICK_PAGES = 15; // menus are explored by clicking on the first screens (a label is clicked once per account, so later screens add only what is new)
const MAX_CLICKS = 300;
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
if (OPERATE) writeFileSync(join(OUT, 'actions.md'), `# 실제 조작 결과\n\n${BASE}에서 입력 화면에 테스트 값(${OPERATE_NAME})을 넣고 저장해 본 기록입니다. 삭제하거나 승인·확정·발송하는 버튼은 누르지 않았습니다.\n\n`);
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

async function exploreAccount(account: Account | null): Promise<{ name: string; signedIn: boolean; pages: number; stoppedBy: 'complete' | 'limit' | 'time'; operated: number }> {
  accountStarted = Date.now();
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1366, height: 800 } });
  // Looking only: reads and sign-in pass, everything else is refused. The operate pass opens the
  // gate for the moment of one save (and never for deleting), then closes it again.
  let writesAllowed = false;
  await context.route('**/*', (route) => {
    const r = route.request();
    const ok = writesAllowed ? allowOperateRequest(r.method(), r.url()) : allowRequest(r.method(), r.url(), r.postData());
    return ok ? route.fallback() : route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  context.on('page', (p) => void (p !== page && p.close().catch(() => undefined)));
  const dialogMessages: string[] = [];
  // A dialog's text is what the page says (required, saved); it is read, then dismissed (a confirm is answered with cancel).
  page.on('dialog', (d) => void (dialogMessages.push(d.message().slice(0, 120)), d.dismiss().catch(() => undefined)));
  const visitedUrls: string[] = [];

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
  visitedUrls.push(page.url());
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
    const texts = await page.locator(MENU_SELECTOR).evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
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
          visitedUrls.push(page.url());
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
    visitedUrls.push(page.url());
    say(`[${who}] 화면 ${visitedCount}: ${page.url()}`);
    await links();
    if (++visitedViaQueue < CLICK_PAGES) await clickMenus();
  }
  if (queue.length && visitedCount >= MAX_PAGES) stoppedBy = 'limit';
  let operated = 0;
  if (OPERATE && signedIn) operated = await operatePass(page, who, visitedUrls, dialogMessages, (on) => (writesAllowed = on));
  await context.close().catch(() => undefined);
  return { name: who, signedIn, pages: visitedCount, stoppedBy, operated };
}

const FIELD_SELECTOR = 'input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select';
const BUTTON_SELECTOR = 'button, input[type=submit], [role=button]';
const MESSAGE_SELECTOR = '[role=alert], [aria-live=assertive], .error, .errors, .invalid-feedback, .help-block, [class*="error"], [class*="invalid"], [class*="toast"], [class*="alert"], [class*="message"]';

/** What the page says right now: error and toast texts, and the browser's own messages for invalid fields. */
async function pageMessages(page: Page): Promise<string[]> {
  return page
    .evaluate((sel) => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const out = new Set<string>();
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 120 && visible(el)) out.add(t);
      }
      for (const el of document.querySelectorAll('input:invalid, select:invalid, textarea:invalid')) {
        const f = el as HTMLInputElement;
        if (visible(f) && f.validationMessage) out.add(`${f.getAttribute('aria-label') || f.name || f.placeholder || '입력칸'}: ${f.validationMessage}`);
      }
      return [...out].slice(0, 10);
    }, MESSAGE_SELECTOR)
    .catch(() => []);
}

/**
 * 실제 조작 학습: on each kind of screen that holds a form, save it empty first (the write is refused
 * in the browser, so only the page's own checks answer), then fill it with test values and save it for
 * real, once. What the page said and what appeared is written to actions.md. A button that approves,
 * confirms, sends, pays or cancels is never pressed, and nothing is ever deleted.
 */
async function operatePass(page: Page, who: string, urls: string[], dialogs: string[], allowWrites: (on: boolean) => void): Promise<number> {
  const patterns = new Set<string>();
  const targets = urls.filter((u) => {
    const key = pageKey(u, origin);
    const pattern = key && pagePattern(key);
    if (!pattern || patterns.has(pattern)) return false;
    patterns.add(pattern);
    return true;
  });
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  appendFileSync(join(OUT, 'actions.md'), `# 계정: ${who}\n\n`);
  say(`[${who}] 실제 조작: 입력 화면을 찾아 값을 넣고 저장해 봅니다`);

  for (const url of targets) {
    if (done >= MAX_OPERATE_FORMS || Date.now() - started > MAX_OPERATE_MS) break;
    const open = async (): Promise<boolean> => {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      } catch {
        return false;
      }
      await settle(page);
      return (await page.locator('input[type=password]:visible').count()) === 0;
    };
    if (!(await open())) continue;

    const form = page.locator('form').filter({ has: page.locator(FIELD_SELECTOR) }).filter({ visible: true }).first();
    const scope = (await form.count()) ? form : page.locator('body');
    const fields = scope.locator(FIELD_SELECTOR).filter({ visible: true });
    const fieldCount = Math.min(await fields.count(), 25);
    const buttons = scope.locator(BUTTON_SELECTOR).filter({ visible: true });
    const buttonCount = Math.min(await buttons.count(), 20);

    let save: ReturnType<typeof buttons.nth> | null = null;
    let saveLabel = '';
    for (let i = 0; i < buttonCount && !save; i++) {
      const b = buttons.nth(i);
      const label = ((await b.innerText({ timeout: 1000 }).catch(() => '')) || (await b.getAttribute('value').catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (label && label.length <= 30 && isSaveLabel(label)) {
        save = b;
        saveLabel = label;
      }
    }
    if (!save) continue;

    const describe = (i: number) =>
      fields.nth(i).evaluate((el) => {
        const f = el as HTMLInputElement;
        const l = (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) || f.closest('label');
        // A wrapping label also holds the control's own text (a select's options): leave the controls out.
        const clone = l ? (l.cloneNode(true) as HTMLElement) : null;
        clone?.querySelectorAll('select, option, input, textarea').forEach((n) => n.remove());
        return { tag: f.tagName, type: f.type || 'text', readOnly: f.readOnly, disabled: f.disabled, label: ((clone && (clone.textContent ?? '')) || f.getAttribute('aria-label') || f.placeholder || f.name || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
      });
    const usable: { index: number; label: string; type: string; tag: string }[] = [];
    for (let i = 0; i < fieldCount; i++) {
      const d = await describe(i).catch(() => null);
      if (d && !d.readOnly && !d.disabled && !isSearchField(d.label, d.type)) usable.push({ index: i, label: d.label || '입력칸', type: d.type, tag: d.tag });
    }
    if (!usable.length) continue;

    const title = (await page.title().catch(() => '')) || url;
    // Saving empty: the write is refused, so what answers is the page's own checking.
    const messagesBefore = await pageMessages(page);
    dialogs.length = 0;
    await save.click({ timeout: 3000 }).catch(() => undefined);
    await settle(page, 3000);
    const emptyMessages = [...new Set([...(await pageMessages(page)).filter((m) => !messagesBefore.includes(m)), ...dialogs])].slice(0, 8);

    // Saving filled in, for real.
    if (!(await open())) continue;
    const filled: string[] = [];
    for (const u of usable) {
      const el = fields.nth(u.index);
      if (u.tag === 'SELECT') {
        const chosen = await el.selectOption({ index: 1 }).then(() => el.evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.text ?? '')).catch(() => '');
        if (chosen) filled.push(`${u.label} = ${chosen.trim()} (선택)`);
      } else {
        const value = fillValue(u.label, u.type, today);
        if (await el.fill(value, { timeout: 2000 }).then(() => true, () => false)) filled.push(`${u.label} = ${value}`);
      }
    }
    const textBefore = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const messagesAfterFill = await pageMessages(page);
    const urlBefore = page.url();
    dialogs.length = 0;
    allowWrites(true);
    try {
      await save.click({ timeout: 3000 }).catch(() => undefined);
      await settle(page, 5000);
    } finally {
      allowWrites(false);
    }
    const messages = [...new Set([...(await pageMessages(page)).filter((m) => !messagesAfterFill.includes(m)), ...dialogs])].slice(0, 8);
    const textAfter = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const shotName = `shots/${String(++shotNumber).padStart(3, '0')}.jpg`;
    const shot = await page.screenshot({ path: join(OUT, shotName), type: 'jpeg', quality: 55, timeout: 5000 }).then(() => shotName).catch(() => null);

    const record: OperateRecord = { n: ++done, title, url, filled, button: saveLabel, emptyMessages, messages, urlAfter: page.url() !== urlBefore ? page.url() : null, appeared: newLines(textBefore, textAfter), shot };
    appendFileSync(join(OUT, 'actions.md'), `${recordToMarkdown(record)}\n\n`);
    say(`[${who}] 조작 ${done}: ${title} (${saveLabel})`);
  }
  if (!done) appendFileSync(join(OUT, 'actions.md'), '저장해 볼 수 있는 입력 화면을 찾지 못했습니다.\n\n');
  return done;
}

const browser = await chromium.launch({ channel: (process.env.PROBE_BROWSER_CHANNEL as 'msedge' | 'chrome' | undefined) || undefined, headless: true });
const results: { name: string; signedIn: boolean; pages: number; stoppedBy: string; operated: number }[] = [];
try {
  // Each account in its own browser session. Without any account the sign-in screen is still read.
  for (const account of ACCOUNTS.length ? ACCOUNTS : [null]) results.push(await exploreAccount(account));
} finally {
  await browser.close().catch(() => undefined);
}
const visitedCount = results.reduce((n, r) => n + r.pages, 0);
const signedIn = results.some((r) => r.signedIn);
const operated = results.reduce((n, r) => n + r.operated, 0);
const stoppedBy = results.find((r) => r.stoppedBy !== 'complete')?.stoppedBy ?? 'complete';

writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ url: BASE, pages: visitedCount, signedIn, stoppedBy, operated, accounts: results, seconds: Math.round((Date.now() - started) / 1000) }));
console.log(JSON.stringify({ type: 'done', pages: visitedCount, signedIn, stoppedBy, operated }));
