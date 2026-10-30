/**
 * What a test does inside the service: typing into a field, picking an option, pressing a
 * button, or sending a write request. The fixture reports each one, the run log stores it as
 * one line of text, and the node view in a Claude session reads it back from there.
 */
export type ActKind = 'fill' | 'select' | 'check' | 'click' | 'press' | 'upload' | 'request';

export interface Act {
  what: ActKind;
  /** The field or button (a readable name where one can be found), or `POST /api/path` for a request. */
  target: string;
  /** What was typed, picked or sent. Passwords never get here as typed. */
  value?: string;
}

export const ACT_LABEL: Record<ActKind, string> = {
  fill: '입력',
  select: '선택',
  check: '체크',
  click: '클릭',
  press: '키 입력',
  upload: '파일 첨부',
  request: '저장 요청',
};

const MAX_VALUE = 120;

export const encodeAct = (a: Act): string => JSON.stringify(a);

export function decodeAct(text: string): Act | null {
  try {
    const a = JSON.parse(text) as Act;
    return a && typeof a.what === 'string' && typeof a.target === 'string' ? a : null;
  } catch {
    return null;
  }
}

/** One readable line, for the plain run log. */
export function describeAct(a: Act): string {
  return `${ACT_LABEL[a.what] ?? a.what} · ${a.target}${a.value ? ` → ${a.value}` : ''}`;
}

/** Cut a value down to something that fits on a node. */
export function shorten(value: string, max = MAX_VALUE): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Playwright prints a locator as code, e.g. `getByLabel('제품명')` or
 * `getByRole('button', { name: '저장' })`. The part a person would say is the text inside.
 */
export function readableTarget(locator: string): string {
  const chain = parseChain(locator);
  if (chain && chain.length > 1) return describeChain(chain);
  const role = /name:\s*(['"])(.+?)\1/.exec(locator);
  if (role) return role[2];
  const by = /^(?:locator\()?getBy(?:Label|Placeholder|Text|Title|AltText|TestId)\((['"])(.+?)\1/.exec(locator);
  if (by) return by[2];
  return locator.replace(/^locator\((['"])(.*)\1\)$/, '$2');
}

interface Call {
  name: string;
  args: string;
}

/** `a('x').b(1)` as [{a,'x'},{b,1}], or null when the text is not a plain chain of calls. */
function parseChain(src: string): Call[] | null {
  const calls: Call[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '.') i++;
    const head = /^(\w+)\(/.exec(src.slice(i));
    if (!head) return null;
    let j = i + head[0].length;
    let depth = 1;
    let quote = '';
    for (; j < src.length && depth > 0; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth) return null;
    calls.push({ name: head[1], args: src.slice(i + head[0].length, j - 1) });
    i = j;
  }
  return calls;
}

const CSS_WORDS: Record<string, string> = { table: '표', tr: '행', 'tbody tr': '행', td: '칸', th: '머리칸', input: '입력칸', textarea: '입력칸', select: '선택 상자', button: '버튼', a: '링크', li: '목록 항목', form: '양식' };
const ROLE_WORDS: Record<string, string> = { button: '버튼', textbox: '입력칸', link: '링크', checkbox: '체크박스', combobox: '선택 상자', row: '행', cell: '칸', dialog: '대화상자', table: '표', heading: '제목' };
const firstString = (args: string): string | null => /^\s*(['"`])(.*?)\1/.exec(args)?.[2] ?? null;

/** A chain such as table → filter → last → row → nth → input, said the way a person would: "마지막 ‘경과일’ 표 › 3번째 행 › 입력칸". */
function describeChain(calls: Call[]): string {
  const parts: string[] = [];
  const last = () => parts.length - 1;
  for (const { name, args } of calls) {
    if (name === 'locator') {
      const css = firstString(args) ?? args;
      parts.push(CSS_WORDS[css] ?? css);
    } else if (name === 'getByRole') {
      const label = /name:\s*(['"])(.*?)\1/.exec(args)?.[2];
      parts.push(label ?? ROLE_WORDS[firstString(args) ?? ''] ?? firstString(args) ?? '');
    } else if (/^getBy/.test(name)) parts.push(firstString(args) ?? '');
    else if (name === 'filter' && parts.length) {
      const text = /hasText:\s*(['"])(.*?)\1/.exec(args)?.[2];
      if (text) parts[last()] = `‘${text}’ ${parts[last()]}`;
    } else if (name === 'first' && parts.length) parts[last()] = `첫 번째 ${parts[last()]}`;
    else if (name === 'last' && parts.length) parts[last()] = `마지막 ${parts[last()]}`;
    else if (name === 'nth' && parts.length) parts[last()] = `${Number(args) + 1}번째 ${parts[last()]}`;
  }
  return parts.filter(Boolean).join(' › ');
}

/** A field that holds a secret; whatever is typed there is shown as dots. */
export const isSecretTarget = (target: string): boolean => /password|passwd|비밀번호|암호|\bpw\b/i.test(target);
