/**
 * How a Claude session runs: permission mode, model and thinking depth. The lists live here so the
 * server (validation, command line) and the web UI (menus, tooltips) cannot disagree.
 * Mode names are the CLI's own, shown in English on purpose; the tooltip explains them in Korean.
 */
export const SESSION_MODES = ['acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const SESSION_MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'] as const;
export type SessionModel = (typeof SESSION_MODELS)[number];

export const SESSION_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type SessionEffort = (typeof SESSION_EFFORTS)[number];

export interface SessionPrefs {
  mode: SessionMode;
  model: SessionModel;
  effort: SessionEffort;
}

export const DEFAULT_PREFS: SessionPrefs = { mode: 'acceptEdits', model: 'default', effort: 'default' };

export const MODE_INFO: Record<SessionMode, { label: string; tip: string; risky?: boolean }> = {
  acceptEdits: { label: 'Accept edits', tip: '파일 읽기·쓰기는 묻지 않고 처리합니다. 셸 명령과 웹 접근은 막혀 있습니다. 기본값입니다.' },
  plan: { label: 'Plan', tip: '파일을 바꾸지 않고 계획만 세워서 보여줍니다. 큰 작업을 시작하기 전에 방향을 맞출 때 좋습니다.' },
  auto: { label: 'Auto', tip: 'Claude가 작업의 위험도를 스스로 판단해 안전하면 바로 진행합니다. 셸과 웹도 쓸 수 있습니다.', risky: true },
  bypassPermissions: { label: 'Bypass permissions', tip: '확인 없이 모든 도구를 실행합니다. 셸과 웹까지 열리므로 신뢰할 수 있는 작업에만 쓰세요.', risky: true },
};

export const MODEL_INFO: Record<SessionModel, { label: string; tip: string }> = {
  default: { label: 'Default', tip: 'Claude 설정의 기본 모델을 씁니다.' },
  fable: { label: 'Fable', tip: '가장 높은 성능의 모델입니다. 복잡한 E2E 시나리오처럼 어려운 작업에 적합합니다.' },
  opus: { label: 'Opus', tip: '깊이 있는 추론이 필요한 작업에 좋은 고성능 모델입니다.' },
  sonnet: { label: 'Sonnet', tip: '속도와 성능의 균형이 좋은 모델입니다. 일반적인 테스트 작성에 적합합니다.' },
  haiku: { label: 'Haiku', tip: '가장 빠르고 가벼운 모델입니다. 간단한 수정이나 질문에 적합합니다.' },
};

export const EFFORT_INFO: Record<SessionEffort, { label: string; tip: string }> = {
  default: { label: 'Default', tip: '모델의 기본 생각 깊이를 씁니다.' },
  low: { label: 'Low', tip: '거의 생각하지 않고 빠르게 답합니다.' },
  medium: { label: 'Medium', tip: '적당히 생각합니다.' },
  high: { label: 'High', tip: '깊게 생각합니다. 대부분의 테스트 작성에 충분합니다.' },
  xhigh: { label: 'Extra high', tip: '아주 깊게 생각합니다. 시간이 더 걸립니다.' },
  max: { label: 'Max', tip: '가장 깊게 생각합니다. 어려운 시나리오에만 쓰세요. 가장 느리고 사용량이 많습니다.' },
};
