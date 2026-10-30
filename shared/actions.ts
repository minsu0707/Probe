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
  const role = /name:\s*(['"])(.+?)\1/.exec(locator);
  if (role) return role[2];
  const by = /^(?:locator\()?getBy(?:Label|Placeholder|Text|Title|AltText|TestId)\((['"])(.+?)\1/.exec(locator);
  if (by) return by[2];
  return locator.replace(/^locator\((['"])(.*)\1\)$/, '$2');
}

/** A field that holds a secret; whatever is typed there is shown as dots. */
export const isSecretTarget = (target: string): boolean => /password|passwd|비밀번호|암호|\bpw\b/i.test(target);
