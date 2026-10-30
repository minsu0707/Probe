import { useEffect, useRef } from 'react';
import type { SessionMessage } from '../../core/api.ts';
import { labelOfLine } from '../../../../shared/tool-labels.ts';
import { clock } from '../../core/format.ts';
import { Modal } from '../../ui/index.ts';

type NodeKind = 'ask' | 'step' | 'say' | 'error';
export interface FlowNode {
  key: number;
  kind: NodeKind;
  label: string;
  /** How many identical steps in a row this node stands for. */
  count: number;
  ts: number;
}

/** Longest chain drawn; earlier steps collapse into one note so a long turn stays readable. */
const MAX_NODES = 24;

const firstLine = (text: string, max: number): string => {
  const line = text.replace(/[#*`>_-]/g, '').split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** The current turn (everything since the last thing the user said) as a chain of nodes. */
export function flowOfTurn(messages: SessionMessage[]): FlowNode[] {
  const from = messages.findLastIndex((m) => m.role === 'user');
  const nodes: FlowNode[] = [];
  const turn = from < 0 ? messages : messages.slice(from);
  for (const m of turn) {
    if (m.role === 'user') nodes.push({ key: m.id, kind: 'ask', label: firstLine(m.text, 44) || '요청', count: 1, ts: m.ts });
    else if (m.role === 'tool') {
      const label = labelOfLine(m.text);
      const last = nodes.at(-1);
      if (last?.kind === 'step' && last.label === label) last.count++;
      else nodes.push({ key: m.id, kind: 'step', label, count: 1, ts: m.ts });
    } else if (m.role === 'error') nodes.push({ key: m.id, kind: 'error', label: firstLine(m.text, 44) || '오류', count: 1, ts: m.ts });
    else nodes.push({ key: m.id, kind: 'say', label: firstLine(m.text, 44) || '답변', count: 1, ts: m.ts });
  }
  return nodes;
}

/** Steps Claude has taken this turn; the node view is only worth offering once there is something to follow. */
export const stepsOfTurn = (nodes: FlowNode[]): number => nodes.filter((n) => n.kind === 'step').length;

const KIND_NAME: Record<NodeKind, string> = { ask: '요청', step: '작업', say: '답변', error: '오류' };

/** What Claude is doing right now, as nodes: the finished ones sit still, the current one breathes. */
export function NodeMapModal({ messages, running, onClose }: { messages: SessionMessage[]; running: boolean; onClose: () => void }) {
  const all = flowOfTurn(messages);
  const hidden = Math.max(0, all.length - MAX_NODES);
  const nodes = hidden ? all.slice(hidden) : all;
  const current = running ? nodes.length - 1 : -1;
  const active = useRef<HTMLLIElement>(null);

  // Keep the node being worked on in view as new ones arrive.
  useEffect(() => active.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [nodes.length, running]);

  return (
    <Modal title="작업 흐름" onClose={onClose}>
      <div className="flow">
        <p className="flow-state muted small" aria-live="polite">
          {running ? `지금: ${nodes.at(-1)?.label ?? '시작하는 중'}` : `${stepsOfTurn(all)}단계 작업을 마쳤습니다`}
        </p>
        <ol className="flow-chain">
          {hidden > 0 && <li className="flow-more muted small">앞의 {hidden}단계 생략</li>}
          {nodes.map((n, i) => (
            <li key={n.key} ref={i === current ? active : undefined} className={`flow-node flow-${n.kind}${i === current ? ' flow-active' : ''}`} aria-current={i === current ? 'step' : undefined}>
              <span className="flow-port flow-port-in" aria-hidden />
              <span className="flow-kind">{KIND_NAME[n.kind]}</span>
              <span className="flow-label">{n.label}</span>
              {n.count > 1 && <span className="flow-count tabular">×{n.count}</span>}
              <time className="muted small tabular">{clock(n.ts)}</time>
              <span className="flow-port flow-port-out" aria-hidden />
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  );
}
