import { useEffect, useState } from 'react';
import { api, type McpStatus } from '../../core/api.ts';
import { CopyButton } from '../../ui/index.ts';
import { McpTerminal, type McpAction } from './McpTerminal.tsx';
import { Row } from './Rows.tsx';

/**
 * Register Probe's MCP server with the user's own Claude Code. The buttons open a terminal with
 * the command already typed; Enter runs it (see McpTerminal). The command is also listed for
 * anyone who prefers to paste it elsewhere.
 */
export function McpRows() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [terminal, setTerminal] = useState<McpAction | null>(null);

  useEffect(() => void api.mcp().then(setStatus, () => setStatus(null)), []);

  const state = !status ? '확인 중…' : !status.installed ? 'Claude Code 없음' : !status.registered ? '등록 안 됨' : status.stale ? '경로가 다름 · 다시 등록 필요' : '등록됨';

  return (
    <>
      <Row title="Claude Code에서 Probe 쓰기" desc={<>터미널의 Claude Code에서 “Probe 열어줘”, “테스트 돌려줘”가 통하게 합니다. 현재: <strong>{state}</strong></>}>
        {status?.registered && (
          <button className="btn" onClick={() => setTerminal('remove')}>
            해제
          </button>
        )}
        <button className="btn btn-primary" disabled={!status?.installed} onClick={() => setTerminal('install')}>
          {status?.registered ? '다시 등록' : '등록'}
        </button>
      </Row>
      <details className="set-row set-details">
        <summary>직접 터미널에서 실행하려면</summary>
        <div className="code-line">
          <code>{status?.command ?? '…'}</code>
          <CopyButton text={status?.command ?? ''} />
        </div>
      </details>
      {terminal && status && <McpTerminal action={terminal} status={status} onDone={setStatus} onClose={() => setTerminal(null)} />}
    </>
  );
}
