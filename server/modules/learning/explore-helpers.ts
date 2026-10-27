/**
 * Pure rules for "서비스 직접 둘러보기": which credentials to sign in with, which links and
 * menu items are never touched, and how pages are told apart so a thousand detail pages do not
 * eat the whole budget. Kept free of Playwright so it can be unit-tested.
 */

export interface LoginPair {
  userKey: string;
  passKey: string;
}

const PASS = /(^|_)(PW|PWD|PASS|PASSWD|PASSWORD)$/i;
const USER = /(^|_)(ID|USER|USERNAME|USERID|EMAIL|LOGIN|ACCOUNT)$/i;

/**
 * Picks an ID/password pair out of the service's variable names (ADMIN_ID + ADMIN_PW, USER + PASS,
 * …). With several roles the admin pair wins: it sees the most menus. Names only; values stay
 * with the caller.
 */
export function pickLogin(names: string[]): LoginPair | null {
  const pairs: LoginPair[] = [];
  for (const passKey of names.filter((n) => PASS.test(n))) {
    const prefix = passKey.replace(PASS, '');
    const userKey = names.find((n) => USER.test(n) && n.replace(USER, '') === prefix);
    if (userKey) pairs.push({ userKey, passKey });
  }
  if (pairs.length === 0) return null;
  const score = (p: LoginPair) => (/admin|관리/i.test(p.userKey) ? 0 : 1);
  return [...pairs].sort((a, b) => score(a) - score(b) || a.passKey.length - b.passKey.length)[0];
}

/** Things that must never be followed or clicked, even though following them only sends a GET. */
const DANGEROUS_TEXT = /로그아웃|log ?out|sign ?out|탈퇴|withdraw|삭제|delete|remove|초기화|reset|파기|destroy|재인증|re-?auth/i;
const DANGEROUS_PATH = /(^|[/_-])(log-?out|sign-?out|withdraw|delete|remove|destroy|unsubscribe)([/_.?-]|$)/i;

export const isDangerousLabel = (text: string): boolean => DANGEROUS_TEXT.test(text);
export const isDangerousUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return DANGEROUS_PATH.test(u.pathname) || DANGEROUS_PATH.test(u.hash.replace(/^#!?/, ''));
  } catch {
    return true;
  }
};

/**
 * The address to remember a page by. Hash routes ("#/orders") are pages of a single-page app and
 * are kept; plain anchors ("#top") and the query string order are not.
 */
export function pageKey(raw: string, origin: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.origin !== origin || !/^https?:$/.test(u.protocol)) return null;
  const hash = /^#!?\//.test(u.hash) ? u.hash : '';
  const query = [...u.searchParams.keys()].sort().length ? `?${[...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  return `${u.pathname.replace(/\/$/, '') || '/'}${query}${hash}`;
}

/** Files and downloads are not screens. */
export const NOT_A_PAGE = /\.(pdf|zip|xlsx?|docx?|pptx?|csv|png|jpe?g|gif|svg|mp4|exe|msi)(\?|$)/i;

/**
 * "/orders/1042" and "/orders/1043" are the same screen. Numbers, UUIDs and long ids collapse to
 * ":id" so only a couple of samples per screen type are visited.
 */
export function pagePattern(key: string): string {
  return key
    .split('#')
    .map((part) => part.replace(/\/(\d+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,}|[A-Za-z0-9_-]{20,})(?=[/?]|$)/gi, '/:id'))
    .join('#');
}

export interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  nav: string[];
  tabs: string[];
  tables: string[][];
  fields: string[];
  buttons: string[];
  selects: string[];
  text: string;
  shot: string | null;
}

const list = (items: string[]) => items.map((i) => `\`${i.replace(/`/g, "'")}\``).join(', ');

/** One page as Markdown, small enough that a few dozen pages fit in a Claude prompt. */
export function snapshotToMarkdown(n: number, s: PageSnapshot): string {
  const lines = [`## ${n}. ${s.title || s.url}`, '', `- 주소: ${s.url}`];
  if (s.headings.length) lines.push(`- 제목들: ${s.headings.join(' / ')}`);
  if (s.nav.length) lines.push(`- 메뉴: ${s.nav.join(' · ')}`);
  if (s.tabs.length) lines.push(`- 탭: ${s.tabs.join(' · ')}`);
  for (const t of s.tables) lines.push(`- 표 열: ${t.join(' | ')}`);
  if (s.fields.length) lines.push(`- 입력 항목: ${list(s.fields)}`);
  if (s.selects.length) lines.push(`- 선택 목록: ${s.selects.join('; ')}`);
  if (s.buttons.length) lines.push(`- 버튼: ${list(s.buttons)}`);
  if (s.shot) lines.push(`- 화면 사진: ${s.shot}`);
  if (s.text) lines.push('', `> ${s.text.replace(/\s+/g, ' ').slice(0, 700)}`);
  return lines.join('\n');
}
