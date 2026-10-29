/**
 * Pure rules for 실제 조작 학습: the explorer's second pass, which fills in the forms it found and
 * saves them once to see what the service really does (validation messages, what appears after a
 * save). Kept apart from the browser code so the safety rules can be tested without a browser.
 */
import { isDangerousLabel, isDangerousUrl } from './explore-helpers.ts';

/** Fixed, recognisable name for everything this pass creates: a rerun finds it again instead of piling up new ones. */
export const OPERATE_NAME = 'QA-AUTO-탐색';

/**
 * Which requests may leave the browser during an attempt to save. Reads pass, anything that deletes
 * is refused (the DELETE method, or a path that says delete/remove/withdraw/logout …), the rest
 * (POST, PUT, PATCH) passes: saving is the point of this pass.
 */
export function allowOperateRequest(method: string, url: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (m === 'DELETE') return false;
  return !isDangerousUrl(url);
}

/** A button that saves what was typed. */
const SAVE_LABEL = /저장|등록|추가|생성|제출|작성|\b(?:save|submit|register|create|add)\b/i;
/**
 * Buttons that move something along or cannot be taken back: approving, confirming, sending, paying,
 * cancelling, asking for a review. Never pressed, even when the label also says "저장".
 */
const IRREVERSIBLE_LABEL = /승인|확정|요청|발송|전송|결제|송금|배포|출고|마감|반려|폐기|취소|인증|\b(?:approve|send|pay|publish|deploy|finali[sz]e|cancel|reject|confirm)\b/i;

export const isSaveLabel = (text: string): boolean => SAVE_LABEL.test(text) && !IRREVERSIBLE_LABEL.test(text) && !isDangerousLabel(text);

/** A search box or filter, not part of a record's form. */
export const isSearchField = (label: string, type: string): boolean => type === 'search' || /검색|조회|search|filter|필터/i.test(label);

/** What to type into a field, judged from its label and type. */
export function fillValue(label: string, type: string, today: string): string {
  const l = label.toLowerCase();
  if (type === 'email' || /이메일|e-?mail/.test(l)) return 'qa-auto@example.com';
  if (type === 'tel' || /전화|연락처|휴대|phone|\btel\b/.test(l)) return '010-0000-0000';
  if (type === 'datetime-local') return `${today}T09:00`;
  if (type === 'time') return '09:00';
  if (type === 'month') return today.slice(0, 7);
  if (type === 'date' || /날짜|일자|date/.test(l)) return today;
  if (type === 'url') return 'https://example.com';
  if (type === 'number' || /수량|금액|가격|비율|함량|중량|함유|개수|%|qty|amount|price|count/.test(l)) return '1';
  return OPERATE_NAME;
}

/** Lines of text that are on the page now and were not before, in order, shortened. */
export function newLines(before: string, after: string, max = 12): string[] {
  const had = new Set(before.split('\n').map((l) => l.trim()));
  const out: string[] = [];
  for (const raw of after.split('\n')) {
    const line = raw.trim();
    if (!line || had.has(line) || out.includes(line)) continue;
    out.push(line.length > 80 ? `${line.slice(0, 80)}…` : line);
    if (out.length >= max) break;
  }
  return out;
}

export interface OperateRecord {
  n: number;
  title: string;
  url: string;
  /** "label = value" for every field that was filled. */
  filled: string[];
  /** The save button that was pressed. */
  button: string;
  /** What the page said when saved empty (without letting the write out); null when it was not tried. */
  emptyMessages: string[] | null;
  /** What the page said after saving the filled form. */
  messages: string[];
  /** The address after saving, when it changed. */
  urlAfter: string | null;
  /** Text that appeared after saving. */
  appeared: string[];
  shot: string | null;
}

export function recordToMarkdown(r: OperateRecord): string {
  const lines = [`## 조작 ${r.n}. ${r.title}`, '', `- 주소: ${r.url}`, `- 입력한 값: ${r.filled.length ? r.filled.join('; ') : '(입력 항목 없음)'}`, `- 누른 버튼: ${r.button}`];
  if (r.emptyMessages) lines.push(`- 비워 둔 채 저장: ${r.emptyMessages.length ? r.emptyMessages.join(' / ') : '화면에 나온 안내 없음'}`);
  lines.push(`- 채워서 저장 후 안내: ${r.messages.length ? r.messages.join(' / ') : '없음'}`);
  if (r.urlAfter) lines.push(`- 저장 후 주소: ${r.urlAfter}`);
  if (r.appeared.length) lines.push(`- 저장 후 새로 보인 글: ${r.appeared.join(' | ')}`);
  if (r.shot) lines.push(`- 저장 후 화면 사진: ${r.shot}`);
  return lines.join('\n');
}
