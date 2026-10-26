import type { LogLine } from '../../core/api.ts';
import { clock } from '../../core/format.ts';

/** Leading symbol per log kind. Results get a symbol from their status instead. */
const KIND_MARK: Record<string, string> = { test: '▸', step: '·', page: '→', view: '◇', system: '!' };

function resultTone(status: string | null | undefined): 'pass' | 'skip' | 'fail' {
  return status === 'passed' ? 'pass' : status === 'skipped' ? 'skip' : 'fail';
}

/** One line of a run's log; also used by the run history's expanded rows. */
export function LogRow({ line }: { line: LogLine }) {
  const tone = line.kind === 'result' ? resultTone(line.status) : undefined;
  const mark = tone ? { pass: '✓', skip: '–', fail: '✕' }[tone] : KIND_MARK[line.kind];
  return (
    <li className={`log-row log-${line.kind}${tone ? ` log-${tone}` : ''}`}>
      <time className="tabular">{clock(line.ts)}</time>
      <span className="log-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="log-text">{line.text}</span>
    </li>
  );
}
