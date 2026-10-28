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
}

export function explainCause(error: string): CauseGuess {
  for (const rule of CAUSE_RULES) {
    const m = rule.pattern.exec(error);
    if (m) return { cause: rule.cause, matched: m[0], why: rule.why };
  }
  return { cause: 'unknown', matched: null, why: null };
}
