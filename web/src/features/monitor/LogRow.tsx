import type { LogLine } from '../../core/api.ts';
import { decodeAct, describeAct } from '../../../../shared/actions.ts';
import { clock } from '../../core/format.ts';

/** Leading symbol per log kind. Results get a symbol from their status instead. */
const KIND_MARK: Record<string, string> = { test: '▸', step: '·', stage: '◦', page: '→', view: '◇', action: '✎', system: '!' };

function resultTone(status: string | null | undefined): 'pass' | 'skip' | 'fail' {
  return status === 'passed' ? 'pass' : status === 'skipped' ? 'skip' : 'fail';
}

/** One line of a run's log; also used by the run history's expanded rows. */
export function LogRow({ line }: { line: LogLine }) {
  const tone = line.kind === 'result' ? resultTone(line.status) : undefined;
  const mark = tone ? { pass: '✓', skip: '–', fail: '✕' }[tone] : KIND_MARK[line.kind];
  const act = line.kind === 'action' ? decodeAct(line.text) : null;
  return (
    <li className={`log-row log-${line.kind}${tone ? ` log-${tone}` : ''}`}>
      <time className="tabular">{clock(line.ts)}</time>
      <span className="log-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="log-text">{act ? describeAct(act) : line.text}</span>
    </li>
  );
}
