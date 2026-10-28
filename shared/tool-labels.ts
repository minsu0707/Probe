/**
 * Claude's tool names in plain Korean. Used by the server for new progress lines and by the web
 * UI for lines saved earlier (which still carry the raw tool name), so both read the same.
 */
const PROBE_TOOLS: Record<string, string> = {
  list_services: '서비스 목록 조회',
  get_service: '서비스 정보 조회',
  read_knowledge: '지식 문서 읽기',
  list_defects: '결함 목록 조회',
  report_defect: '결함 등록',
  update_defect: '결함 상태 변경',
  delete_defect: '결함 삭제',
  run_tests: '테스트 실행',
  start_learning: '학습 시작',
  open_dashboard: '대시보드 열기',
};

const BUILTIN_TOOLS: Record<string, string> = {
  ToolSearch: '사용할 도구 찾기',
  TodoWrite: '할 일 정리',
  Task: '하위 작업 실행',
  Bash: '명령 실행',
  WebFetch: '웹 페이지 읽기',
  WebSearch: '웹 검색',
};

/** The Korean label for a raw tool name, or null when it is not one we know. */
export function toolLabel(name: string): string | null {
  const probe = /^mcp__probe__(\w+)$/.exec(name);
  if (probe) return PROBE_TOOLS[probe[1]] ?? null;
  return BUILTIN_TOOLS[name] ?? null;
}

/** A progress line that is nothing but a raw tool name (what older sessions stored). */
export const labelOfLine = (line: string): string => toolLabel(line.trim()) ?? line;
