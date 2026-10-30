/**
 * A run's log, read as a chain of nodes: where the test is (a screen or page) and what it does
 * there (what it types, picks, presses, sends). Only the latest test is drawn; plumbing such as
 * GETs, expectations and context handling never reaches the log as an action, so it never shows.
 */
import { ACT_LABEL, decodeAct, type ActKind } from './actions.ts';
import type { LogLine } from './models.ts';

export interface FlowNode {
  key: string;
  kind: 'stage' | 'act';
  /** Stage: the screen's name (or its path). Act: the field, button or request. */
  label: string;
  /** Stage: the page path. Act: what was typed, picked or sent. */
  detail?: string;
  what?: ActKind;
  /** The same action repeated back to back is one node. */
  count: number;
  ts: number;
  /** Stage only: still waiting for its first action, so a later page or screen line belongs to it. */
  open?: boolean;
}

/** Most nodes drawn; the rest of a long test is summarised as a count. */
export const MAX_FLOW_NODES = 24;

export function flowOfRun(lines: LogLine[]): { title: string | null; nodes: FlowNode[] } {
  const start = lines.findLastIndex((l) => l.kind === 'test');
  const title = start >= 0 ? lines[start].text.split(' › ').at(-1) ?? null : null;
  const nodes: FlowNode[] = [];

  /** The stage that has not seen an action yet, if the chain currently ends in one. */
  const openStage = (): FlowNode | undefined => {
    const last = nodes.at(-1);
    return last?.kind === 'stage' && last.open ? last : undefined;
  };

  for (const [i, l] of lines.slice(start < 0 ? 0 : start + 1).entries()) {
    const key = `${l.id ?? i}`;
    if (l.kind === 'view') {
      const name = l.text.split(' › ').at(-1) ?? l.text;
      const stage = openStage();
      if (stage) {
        // A stage that began as a bare page path keeps the path as its detail once it gets a name.
        if (!stage.detail && stage.label.startsWith('/')) stage.detail = stage.label;
        stage.label = name;
      }
      else nodes.push({ key, kind: 'stage', label: name, count: 1, ts: l.ts, open: true });
    } else if (l.kind === 'page') {
      const stage = openStage();
      if (stage) stage.detail = l.text;
      else nodes.push({ key, kind: 'stage', label: l.text, detail: undefined, count: 1, ts: l.ts, open: true });
    } else if (l.kind === 'action') {
      const act = decodeAct(l.text);
      if (!act) continue;
      const stage = openStage();
      if (stage) stage.open = false;
      const last = nodes.at(-1);
      if (last?.kind === 'act' && last.what === act.what && last.label === act.target && last.detail === act.value) last.count++;
      else nodes.push({ key, kind: 'act', what: act.what, label: act.target, detail: act.value, count: 1, ts: l.ts });
    }
  }
  return { title, nodes };
}

export { ACT_LABEL };
