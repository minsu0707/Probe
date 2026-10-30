import { useEffect, useRef } from 'react';
import { ACT_LABEL, MAX_FLOW_NODES, flowOfRun } from '../../../../shared/flow.ts';
import type { LogLine, RunSummary } from '../../core/api.ts';
import { clock } from '../../core/format.ts';
import { loadRun, useStore } from '../../core/store.ts';
import { Modal } from '../../ui/index.ts';

const NO_LINES: LogLine[] = [];

/**
 * What the test is doing in the service right now, as nodes: the screen it is on, then what it
 * types, picks or sends there. Finished nodes sit still; the one in progress breathes.
 */
export function NodeMapModal({ run, onClose }: { run: RunSummary; onClose: () => void }) {
  const lines = useStore((s) => s.logs[run.id] ?? NO_LINES);
  const running = run.status === 'running';
  const { title, nodes: all } = flowOfRun(lines);
  const hidden = Math.max(0, all.length - MAX_FLOW_NODES);
  const nodes = hidden ? all.slice(hidden) : all;
  const current = running ? nodes.length - 1 : -1;
  const active = useRef<HTMLLIElement>(null);

  // The log may not have been fetched yet (the monitor tab was never opened); live lines then follow over the socket.
  useEffect(() => void loadRun(run.id).catch(() => undefined), [run.id]);
  // Keep the node in progress in view as new ones arrive.
  useEffect(() => active.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [nodes.length, running]);

  const doing = all.filter((n) => n.kind === 'act').length;
  return (
    <Modal title="테스트 흐름" onClose={onClose}>
      <div className="flow">
        <p className="flow-state muted small" aria-live="polite">
          {title && <b className="flow-test">{title}</b>}
          {running ? (nodes.length ? ' · 진행 중' : ' · 시작하는 중') : ` · 끝났습니다 (${doing}개 동작)`}
        </p>
        {nodes.length === 0 ? (
          <p className="muted small">{running ? '아직 화면에서 한 동작이 없습니다.' : '이 실행에는 화면에서 한 동작 기록이 없습니다.'}</p>
        ) : (
          <ol className="flow-chain">
            {hidden > 0 && <li className="flow-more muted small">앞의 {hidden}개 생략</li>}
            {nodes.map((n, i) => (
              <li key={n.key} ref={i === current ? active : undefined} className={`flow-node flow-${n.kind}${i === current ? ' flow-active' : ''}`} aria-current={i === current ? 'step' : undefined}>
                <span className="flow-port flow-port-in" aria-hidden />
                <span className="flow-kind">{n.kind === 'stage' ? '화면' : ACT_LABEL[n.what!]}</span>
                <span className="flow-label">{n.label}</span>
                {n.count > 1 && <span className="flow-count tabular">×{n.count}</span>}
                <time className="muted small tabular">{clock(n.ts)}</time>
                {n.detail && <span className={`flow-detail${n.kind === 'stage' ? ' flow-path' : ''}`}>{n.detail}</span>}
                <span className="flow-port flow-port-out" aria-hidden />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
