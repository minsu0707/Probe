/**
 * Why a failure needs a person, and what that person should look at. "확인 필요" alone gives
 * nobody anything to do, so each kind of error is read for its specifics: what happened, why
 * Probe cannot decide it, and the concrete things to compare.
 */
import { readableTarget } from './actions.ts';
import { describeFailure } from './cause.ts';

export interface ReviewNeed {
  /** One line naming this failure, used in the list so twelve failures of one test can be told apart. */
  headline: string;
  /** One quiet line under the headline with the particular content (what was printed, what the server said, the two values). */
  peek: string;
  /** What happened, with the particular values. */
  happened: string;
  /** Why Probe cannot settle it itself. */
  why: string;
  /** What to look at or decide, in order. */
  checks: string[];
}

interface Input {
  error: string;
  page: string | null;
  feature: string | null;
  hasScreenshot: boolean;
}

const clip = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
};

const HTTP = /^(?:\w*Error:\s*)?(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+→\s+(\d{3})\s*(.*)$/m;

/** Keys of a test's own dump, e.g. `DOM:`, `NAV:`, `hit=1 ALERTS:` in `Error: PRD=… NAV:[…]`. */
const dumpKeys = (error: string): string[] => {
  const head = error.replace(/^\w*Error:\s*/, '');
  return [...new Set([...head.matchAll(/(?:^|[\s,{[])([A-Z][A-Z0-9_]{1,11})[:=]/g)].map((m) => m[1]))].slice(0, 5);
};

/** What the short names a test prints under mean, so a title reads "버튼 목록" instead of "BTNS". Unknown names stay as written. */
const KEY_LABEL: Record<string, string> = {
  BTNS: '버튼 목록', BUTTONS: '버튼 목록', ALERTS: '알림', TEXT: '화면 글', BODY: '화면 글', DOM: '화면 구조', HTML: '화면 구조', URL: '주소', NAV: '메뉴', CARDS: '카드 내용',
  CTRL: '입력 컨트롤', CTRLS: '입력 컨트롤', SEL: '선택 상자', SELECT: '선택 상자', WHERE: '위치', ROWS: '표 행', ORD: '순서', SAVE: '저장 결과', DLG: '대화상자', ASK: '확인 창', STEPS: '단계',
  FORMULA: '배합', PRD: '제품', REV: '개정', ERR: '오류', HIT: '일치 수', OPTS: '선택지', VAL: '값', VALS: '값',
};
const keyLabel = (key: string): string => KEY_LABEL[key] ?? key;

/** The printed content with the `KEY:` names taken out, so what is left is what the page showed. */
const printedContent = (error: string, firstKey: string): string => {
  const head = error.replace(/^\w*Error:\s*/, '');
  const at = head.search(new RegExp(`${firstKey}[:=]`));
  return clip((at >= 0 ? head.slice(at + firstKey.length + 1) : head).replace(/\b[A-Z][A-Z0-9_]{1,11}[:=]/g, ' · '), 80);
};

const isProbePlumbing =(error: string): boolean => /Expected|Received|Locator:|Timeout \d+ms|strict mode|element\(s\) not found|Call log:/.test(error);

/** A failure that is only the test printing what it saw (DOM, URL, button lists), not a problem it found. */
export const isDiagnosticDump = (error: string): boolean => !HTTP.test(error) && dumpKeys(error).length > 0 && !isProbePlumbing(error);

export function reviewNeed({ error, page, feature, hasScreenshot }: Input): ReviewNeed {
  const where = [feature, page].filter(Boolean).join(' · ');
  const shot = hasScreenshot ? '아래 스크린샷은 실패한 순간의 화면입니다.' : '이 실패에는 스크린샷이 없습니다. 화면은 직접 열어서 확인해야 합니다.';

  // The server answered a request the test made.
  const http = HTTP.exec(error);
  if (http) {
    const [, method, rawPath, status, rest] = http;
    const path = rawPath.split('?')[0];
    const code = /"code":"([^"]+)"/.exec(rest)?.[1];
    const message = /"message":"([^"]+)"/.exec(rest)?.[1];
    const state = /"state":"([^"]+)"/.exec(rest)?.[1];
    const said = [code, message].filter(Boolean).join(' — ');
    const headline = `${method} ${path} → ${status}${code ? ` ${code}` : ''}`;
    const peek = clip(message ?? code ?? `${status} 응답`, 80);
    const happened = `테스트가 ${method} ${path} 를 보냈고 서버가 ${status}${said ? `로, “${clip(said, 160)}”라고` : '로'} 답했습니다.${state ? ` (대상의 현재 상태: ${state})` : ''}`;
    if (status === '501' || code === 'NOT_IMPLEMENTED')
      return { headline, peek, happened, why: '서버가 “아직 구현되지 않은 API”라고 답했습니다. 앱에 기능이 아직 없는 것인지, 테스트가 이른 단계의 API를 부른 것인지는 개발 일정을 아는 사람이 정해야 합니다.', checks: [`${path} 가 지금 구현되어 있어야 하는 API인지 (API 계약·일정 확인)`, '구현 전이 맞다면 ‘오탐’, 구현되어 있어야 한다면 ‘앱 버그’'] };
    if (status.startsWith('5'))
      return { headline, peek, happened, why: '서버 내부 오류입니다. 앱 버그인지 일시적인 서버 문제인지는 로그를 봐야 알 수 있습니다.', checks: ['같은 요청을 다시 보내면 또 실패하는지', '서버 로그에 같은 시각의 오류가 있는지'] };
    return {
      headline,
      peek,
      happened,
      why: '서버가 요청을 거절했습니다. 규칙에 맞는 거절이면 테스트의 순서나 입력이 틀린 것이고, 거절하면 안 되는 상황이면 앱 버그입니다. 어느 쪽인지는 이 기능의 규칙을 아는 사람만 정할 수 있습니다.',
      checks: [`“${clip(message ?? `${status} 응답`, 80)}” 가 이 상황에서 맞는 응답인지${state ? ` (대상이 ${state} 상태일 때)` : ''}`, '맞는 응답이면 ‘테스트가 틀렸어요’, 아니면 ‘앱 버그예요’'],
    };
  }

  // The test threw its own message to print what it saw (DOM, URL, button list …) rather than to report a problem.
  const keys = dumpKeys(error);
  if (keys.length && !isProbePlumbing(error)) {
    const sample = clip(error.replace(/^\w*Error:\s*/, ''), 160);
    return {
      // Two names are enough to tell printouts apart; a long list of them only makes the title wrap.
      headline: `화면 정보 출력 · ${keys.slice(0, 2).map(keyLabel).join('·')}${keys.length > 2 ? ` 외 ${keys.length - 2}` : ''}`,
      peek: printedContent(error, keys[0]),
      happened: `테스트가 ${where || '화면'}에서 찾은 내용을 오류 메시지로 던지고 멈췄습니다. 출력 항목: ${keys.map((k) => (KEY_LABEL[k] ? `${KEY_LABEL[k]}(${k})` : k)).join(', ')}. 시작은 “${sample}”.`,
      why: '앱이 틀린 것이 아니라, 테스트 작성 중 화면 상태를 눈으로 보려고 일부러 실패시킨 코드일 가능성이 큽니다. Probe는 메시지만으로 의도를 알 수 없습니다.',
      checks: ['출력된 내용이 정상 화면의 상태라면 → ‘테스트가 틀렸어요’ 또는 ‘오탐’으로 분류 (테스트 정리가 필요합니다)', shot, '출력 내용에 이상한 점(빠진 항목, 엉뚱한 값)이 있다면 → 어떤 점인지 아래 칸에 적어 주세요'],
    };
  }

  const detail = describeFailure(error);
  if (detail && /Expected/.test(error) && /Received/.test(error)) {
    return {
      headline: `기대값과 화면 값이 다름${detail.points[1] ? ` (${clip(detail.points[1].replace(/^화면의 값:\s*/, ''), 40)})` : ''}`,
      peek: clip(detail.points.map((p) => p.replace(/^기대한 값:\s*/, '기대 ').replace(/^화면의 값:\s*/, '화면 ')).join(' · '), 80),
      happened: detail.summary,
      why: 'Probe는 이 기능의 올바른 값을 모릅니다. 기대값이 틀렸는지 화면(앱)이 틀렸는지는 규칙을 아는 사람이 정해야 합니다.',
      checks: [...detail.points, shot, '어느 쪽이 맞는지 한 줄로 알려 주시면 이후 세션이 기억합니다'],
    };
  }
  if (detail) {
    // A wait that timed out names what it was waiting for as code; say it as a person would.
    const waiting = /^기다리던 것:\s*(.+)$/.exec(detail.points[0] ?? '')?.[1];
    const target = waiting ? readableTarget(waiting) : null;
    const sec = /(\d+)초/.exec(detail.summary)?.[1];
    return { headline: target && sec ? `${sec}초 기다려도 ${clip(target, 40)} 못 찾음` : clip(detail.summary, 70), peek: target ? `기다린 것: ${clip(target, 70)}` : clip(detail.points[0] ?? '', 80), happened: detail.summary, why: detail.fix ?? '오류 내용만으로는 테스트와 앱 중 어느 쪽 문제인지 정하기 어렵습니다.', checks: [...detail.points, shot] };
  }

  const first = clip(error.split('\n').find((l) => l.trim()) ?? '', 90);
  return {
    headline: first || '원인을 알 수 없는 실패',
    peek: '',
    happened: `오류 메시지: ${first}`,
    why: '오류 문구가 알려진 형태가 아니라서 앱 문제인지 테스트 문제인지 구분하지 못했습니다.',
    checks: [shot, where ? `${where} 화면에서 이 동작이 의도대로 되는지` : '이 동작이 의도대로 되는지'],
  };
}
