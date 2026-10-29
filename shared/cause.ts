/**
 * Who is probably wrong in a failed test, judged from the error text alone. The rules live here,
 * shared by the server (which stores the guess) and the web UI (which shows exactly what in the
 * error text triggered it), so the explanation can never drift from the decision.
 */
import type { DefectCause } from './models.ts';

interface CauseRule {
  cause: DefectCause;
  pattern: RegExp;
  /** What this match means, in the words shown to the user. */
  why: string;
}

/** Checked in order; the first match wins. */
export const CAUSE_RULES: CauseRule[] = [
  { cause: 'env', pattern: /blockedbyclient/i, why: 'Probe가 조회 전용 서비스에서 데이터를 바꾸는 요청을 막았습니다.' },
  { cause: 'env', pattern: /net::ERR_|ERR_NAME_NOT_RESOLVED|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i, why: '사이트에 연결하지 못했습니다. 네트워크나 서버 상태 문제입니다.' },
  { cause: 'env', pattern: /browser has been closed|Target (?:page|closed)/i, why: '테스트 도중 브라우저나 페이지가 닫혔습니다.' },
  { cause: 'env', pattern: /status(?: code)?:?\s*50[234]/i, why: '서버가 5xx 오류로 응답했습니다. 게이트웨이나 서버 문제입니다.' },
  { cause: 'test', pattern: /strict mode violation/i, why: '하나를 가리켜야 할 선택자가 화면에서 여러 요소와 맞았습니다. 선택자를 더 구체적으로 써야 합니다.' },
  { cause: 'test', pattern: /element\(s\) not found/i, why: '선택자에 맞는 요소를 화면에서 찾지 못했습니다. 선택자가 틀렸거나 화면이 아직 준비되지 않았습니다.' },
  { cause: 'test', pattern: /Test timeout of/i, why: '정해진 시간 안에 테스트가 끝나지 않았습니다. 기다리는 조건이 맞지 않았을 가능성이 큽니다.' },
  { cause: 'test', pattern: /is not a function|SyntaxError|Cannot find (?:module|name)|is not defined/i, why: '테스트 코드 자체에 오류가 있습니다.' },
  { cause: 'app', pattern: /Received/, why: '화면은 응답했지만 기대한 값(Expected)과 실제 값(Received)이 달랐습니다.' },
];

export interface CauseGuess {
  cause: DefectCause;
  /** The part of the error text that triggered the rule, or null when nothing matched. */
  matched: string | null;
  why: string | null;
  /** What the error says about this failure in particular (which selector, how many matches, which values), or null when it has nothing specific. */
  detail: FailureDetail | null;
}

/** A concrete reading of one error, so the screen says what happened instead of only what kind of failure it is. */
export interface FailureDetail {
  /** One sentence: what the test did and what it found. */
  summary: string;
  /** Facts taken from the error, one per line (the elements that matched, the expected and actual value …). */
  points: string[];
  /** What to change to make the test pass, when the error makes that clear. */
  fix: string | null;
}

const clip = (text: string, max = 140): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** What an expect() matcher checks, in words. */
const MATCHERS: Record<string, string> = {
  toBeVisible: '보이는지',
  toBeHidden: '숨겨져 있는지',
  toBeEnabled: '활성화되어 있는지',
  toBeDisabled: '비활성화되어 있는지',
  toBeChecked: '체크되어 있는지',
  toBeEditable: '입력할 수 있는지',
  toBeEmpty: '비어 있는지',
  toHaveText: '텍스트가 기대와 같은지',
  toContainText: '텍스트를 포함하는지',
  toHaveValue: '입력값이 기대와 같은지',
  toHaveCount: '개수가 기대와 같은지',
  toHaveURL: '주소가 기대와 같은지',
  toHaveTitle: '제목이 기대와 같은지',
  toHaveAttribute: '속성값이 기대와 같은지',
  toHaveClass: '클래스가 기대와 같은지',
};

/** Reads the specifics out of Playwright's error text. Null when the text has none of the shapes known here. */
export function describeFailure(error: string): FailureDetail | null {
  const locator = /^\s*Locator:\s*(.+)$/m.exec(error)?.[1]?.trim();
  const matcher = /expect\(\w+\)\.(?:not\.)?(\w+)\(/.exec(error)?.[1];
  const checking = matcher ? MATCHERS[matcher] : undefined;

  const strict = /strict mode violation:\s*(.+?)\s+resolved to (\d+) elements/.exec(error);
  if (strict) {
    const shown = [...error.matchAll(/^\s*(\d+)\)\s+(.+)$/gm)].slice(0, 4).map((m) => `${m[1]}번: ${clip(m[2].replace(/\s+aka\s+.*$/, ''))}`);
    return {
      summary: `${strict[1]} 로 요소를 찾았더니 화면에 ${strict[2]}개가 있어서, 어느 것을 누르거나 확인해야 할지 정할 수 없었습니다.`,
      points: shown.length ? ['맞은 요소:', ...shown] : [],
      fix: '하나만 맞도록 선택자를 구체적으로 바꿔야 합니다. 예: 영역(대화상자, 표의 행)을 먼저 지정하거나, 정확한 이름(exact)으로 찾습니다.',
    };
  }

  if (/element\(s\) not found/i.test(error)) {
    return {
      summary: `${locator ?? '선택자'} 에 맞는 요소를 화면에서 찾지 못했습니다${checking ? ` (${checking} 확인하려던 참이었습니다)` : ''}.`,
      points: [],
      fix: '이 시점에 화면이 아직 바뀌지 않았거나, 이름·글자가 실제 화면과 다릅니다. 실패 화면과 선택자를 맞춰 보세요.',
    };
  }

  const timeout = /Test timeout of (\d+)ms exceeded/.exec(error);
  const waited = /(?:page|locator|frame)\.(\w+): Timeout (\d+)ms exceeded/.exec(error);
  if (timeout || waited) {
    const waitingFor = /waiting for (.+)$/m.exec(error)?.[1]?.trim();
    const sec = Math.round(Number(timeout?.[1] ?? waited?.[2]) / 1000);
    return {
      summary: timeout
        ? `테스트 하나가 ${sec}초 안에 끝나지 않았습니다.`
        : `${waited![1]} 동작이 ${sec}초 동안 기다렸지만 끝나지 않았습니다.`,
      points: waitingFor ? [`기다리던 것: ${clip(waitingFor)}`] : [],
      fix: timeout ? '긴 시나리오라면 test.setTimeout으로 시간을 늘리고, 아니라면 어느 단계에서 멈췄는지 보고 그 단계의 조건을 확인하세요.' : null,
    };
  }

  const expected = /^\s*Expected(?: string| pattern)?:\s*(.+)$/m.exec(error)?.[1];
  const received = /^\s*Received(?: string)?:\s*(.+)$/m.exec(error)?.[1];
  if (expected !== undefined && received !== undefined) {
    return {
      summary: `${locator ? `${locator} 의 ` : ''}${checking ? checking.replace(/지$/, '지 ') : ''}확인에서 기대한 값과 화면의 값이 달랐습니다.`.replace(/\s+/g, ' '),
      points: [`기대한 값: ${clip(expected.trim())}`, `화면의 값: ${clip(received.trim())}`],
      fix: null,
    };
  }
  return null;
}

export function explainCause(error: string): CauseGuess {
  for (const rule of CAUSE_RULES) {
    const m = rule.pattern.exec(error);
    if (m) return { cause: rule.cause, matched: m[0], why: rule.why, detail: describeFailure(error) };
  }
  return { cause: 'unknown', matched: null, why: null, detail: describeFailure(error) };
}
