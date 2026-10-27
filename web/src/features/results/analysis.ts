import type { Defect } from '../../core/api.ts';

const MAX_ERROR_CHARS = 2500;

/** The message that hands a failure to a Claude session: what failed, and how to decide who is wrong. */
export function analysisRequest(d: Defect, followedFrom?: string): string {
  const error = d.error.length > MAX_ERROR_CHARS ? `${d.error.slice(0, MAX_ERROR_CHARS)}\n…(이하 생략)` : d.error;
  const where = [d.feature, d.page].filter(Boolean).join(' · ');
  return `다음 테스트 실패의 원인을 분석해 주세요.

- 테스트: ${d.title}
${where ? `- 기능·화면: ${where}\n` : ''}${followedFrom ? `- 참고: 같은 파일에서 먼저 실패한 "${followedFrom}"의 영향일 수 있습니다.\n` : ''}- 오류:
\`\`\`
${error}
\`\`\`

먼저 tests/specs에서 이 테스트를 찾아 읽고, knowledge 문서가 말하는 기대값과 비교해서 아래 중 어디에 해당하는지 판단해 주세요. 결론을 한 줄로 먼저 말해 주세요.
1. 테스트 문제 (선택자가 모호하거나 대기가 부족하거나 기대값을 잘못 옮김): 스펙을 직접 고쳐 주세요. 단, 기대값을 사이트에 맞춰 바꾸지는 마세요.
2. 문서와 실제 화면이 다름: 문서의 근거와 화면에서 확인된 내용을 나란히 알려 주세요. 어느 쪽이 맞는지는 제가 정합니다.
3. 앱 결함 가능성: 근거와 재현 단계를 정리해 주세요.
4. 환경 문제 (느림, 네트워크, 계정 권한, 남아 있는 데이터): 무엇을 확인해야 하는지 알려 주세요.`;
}
