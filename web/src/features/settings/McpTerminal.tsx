import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type McpResult, type McpStatus } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import { Modal } from '../../ui/index.ts';

export type McpAction = 'install' | 'remove';

const REMOVE_COMMAND = 'claude mcp remove --scope user probe';

/**
 * A small terminal for one fixed command. The command is typed in for the user; Enter runs
 * exactly that command on the server (never anything typed here), then shows what the CLI printed.
 * Enter again closes it.
 */
export function McpTerminal({ action, status, onDone, onClose }: { action: McpAction; status: McpStatus; onDone: (r: McpResult) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready');
  const [output, setOutput] = useState('');
  const [ok, setOk] = useState(true);
  const screen = useRef<HTMLDivElement>(null);

  // What will run, as lines. Registering over an old entry removes it first (the server does the same).
  // Fixed when the terminal opens, so the lines don't change once the command has run.
  const [lines] = useState(() => (action === 'remove' ? [REMOVE_COMMAND] : [...(status.registered ? [REMOVE_COMMAND] : []), status.command]));

  useEffect(() => screen.current?.focus(), []);

  const run = async () => {
    setPhase('running');
    const r = await attempt(() => (action === 'remove' ? api.removeMcp() : api.installMcp()));
    if (r) {
      setOutput(r.output);
      setOk(r.ok);
      onDone(r);
    } else {
      setOk(false);
      setOutput('실행하지 못했습니다. 위에 표시된 오류를 확인하세요.');
    }
    setPhase('done');
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (phase === 'ready') void run();
    else if (phase === 'done') onClose();
  };

  return (
    <Modal title={action === 'remove' ? 'Probe 등록 해제' : 'Claude Code에 Probe 등록'} onClose={onClose}>
      <div className="terminal term-screen" ref={screen} tabIndex={0} onKeyDown={onKey} role="group" aria-label="터미널">
        {lines.map((l) => (
          <div key={l}>
            <span className="term-prompt">$ </span>
            {l}
          </div>
        ))}
        {phase === 'ready' && <span className="term-cursor" aria-hidden="true" />}
        {output && <div className={ok ? 'term-out' : 'term-out term-fail'}>{output.replace(/^\$ .*\n/gm, '')}</div>}
      </div>
      <p className="muted small term-hint">
        {phase === 'ready' && (
          <>
            <kbd>Enter</kbd>를 누르면 위 명령이 실행됩니다. <kbd>Esc</kbd>로 취소합니다.
          </>
        )}
        {phase === 'running' && '실행 중…'}
        {phase === 'done' && (
          <>
            {ok ? '완료되었습니다. ' : '실패했습니다. '}
            <kbd>Enter</kbd>로 닫습니다.{ok && action === 'install' ? ' Claude Code를 새로 시작하면 Probe 도구가 보입니다.' : ''}
          </>
        )}
      </p>
      <div className="actions">
        {phase === 'ready' && (
          <button className="btn btn-primary" onClick={() => void run()}>
            실행 (Enter)
          </button>
        )}
        {phase === 'done' && (
          <button className="btn btn-primary" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
    </Modal>
  );
}
