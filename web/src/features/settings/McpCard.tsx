import { useEffect, useState } from 'react';
import { api, type McpResult, type McpStatus } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import { CopyButton, Pill } from '../../ui/index.ts';

/**
 * Register Probe's MCP server with the user's own Claude Code in one click. The server runs the
 * fixed `claude mcp add` command and returns what the CLI printed, which is shown here the way a
 * terminal would show it. The command is also listed for anyone who prefers to paste it.
 */
export function McpCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void api.mcp().then(setStatus, () => setStatus(null)), []);

  const act = async (call: () => Promise<McpResult>) => {
    setBusy(true);
    setOutput('실행 중…');
    const r = await attempt(call);
    setBusy(false);
    if (r) {
      setStatus(r);
      setOutput(r.output);
    } else setOutput(null);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Claude Code에서 Probe 쓰기 (MCP)</h2>
        {status &&
          (!status.installed ? <Pill tone="warn">Claude Code 없음</Pill> : !status.registered ? <Pill>등록 안 됨</Pill> : status.stale ? <Pill tone="warn">경로가 다름</Pill> : <Pill tone="pass">등록됨</Pill>)}
      </div>
      <p>
        평소 터미널에서 쓰는 Claude Code에 Probe를 등록하면 “Probe 열어줘”, “{'{서비스}'} 테스트 돌려줘” 같은 요청으로 이 대시보드가 열리고 테스트가 실행됩니다. 어느 폴더에서 Claude Code를 열어도 쓸 수 있고, 등록 후 Claude Code를 새로 시작해야 보입니다.
      </p>
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || !status?.installed} onClick={() => void act(api.installMcp)}>
          {status?.registered ? '다시 등록' : '등록하기'}
        </button>
        {status?.registered && (
          <button className="btn" disabled={busy} onClick={() => void act(api.removeMcp)}>
            등록 해제
          </button>
        )}
      </div>
      {status?.stale && <p className="muted small">등록된 경로가 지금 설치된 Probe와 다릅니다(폴더를 옮기거나 다시 설치한 경우). “다시 등록”을 누르세요.</p>}
      {output !== null && <pre className="terminal">{output}</pre>}

      <details>
        <summary className="muted small">직접 터미널에서 실행하려면</summary>
        <div className="code-line">
          <code>{status?.command ?? '…'}</code>
          <CopyButton text={status?.command ?? ''} />
        </div>
      </details>
    </section>
  );
}
