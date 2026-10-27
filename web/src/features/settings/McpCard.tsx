import { useEffect, useState } from 'react';
import { api, type McpStatus } from '../../core/api.ts';
import { CopyButton, Pill } from '../../ui/index.ts';
import { McpTerminal, type McpAction } from './McpTerminal.tsx';

/**
 * Register Probe's MCP server with the user's own Claude Code. The buttons open a terminal with
 * the command already typed; Enter runs it (see McpTerminal). The command is also listed for
 * anyone who prefers to paste it elsewhere.
 */
export function McpCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [terminal, setTerminal] = useState<McpAction | null>(null);

  useEffect(() => void api.mcp().then(setStatus, () => setStatus(null)), []);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Claude Code에서 Probe 쓰기 (MCP)</h2>
        {status &&
          (!status.installed ? <Pill tone="warn">Claude Code 없음</Pill> : !status.registered ? <Pill>등록 안 됨</Pill> : status.stale ? <Pill tone="warn">경로가 다름</Pill> : <Pill tone="pass">등록됨</Pill>)}
      </div>
      <p>
        평소 터미널에서 쓰는 Claude Code에 Probe를 등록하면 “Probe 열어줘”, “{'{서비스}'} 테스트 돌려줘” 같은 요청으로 이 대시보드가 열리고 테스트가 실행됩니다. 어느 폴더에서 Claude Code를 열어도 쓸 수 있습니다. 버튼을 누르면 터미널이 열리고 명령이 입력되어 있으니 <kbd>Enter</kbd>만 누르세요.
      </p>
      <div className="actions">
        <button className="btn btn-primary" disabled={!status?.installed} onClick={() => setTerminal('install')}>
          {status?.registered ? '다시 등록' : '등록하기'}
        </button>
        {status?.registered && (
          <button className="btn" onClick={() => setTerminal('remove')}>
            등록 해제
          </button>
        )}
      </div>
      {status?.stale && <p className="muted small">등록된 경로가 지금 설치된 Probe와 다릅니다(폴더를 옮기거나 다시 설치한 경우). “다시 등록”을 누르세요.</p>}

      <details>
        <summary className="muted small">직접 터미널에서 실행하려면</summary>
        <div className="code-line">
          <code>{status?.command ?? '…'}</code>
          <CopyButton text={status?.command ?? ''} />
        </div>
      </details>

      {terminal && status && <McpTerminal action={terminal} status={status} onDone={setStatus} onClose={() => setTerminal(null)} />}
    </section>
  );
}
