import { useEffect, useRef } from 'react';
import type { Job } from '../../core/api.ts';
import { duration } from '../../core/format.ts';
import { Markdown, Pill, useNow } from '../../ui/index.ts';

/** 학습 진행: live progress lines while Claude works, then its summary (or the error). */
export function JobCard({ job }: { job: Job }) {
  const now = useNow(1000);
  const logBox = useRef<HTMLOListElement>(null);
  const running = job.status === 'running';

  // Keep the newest line in view as progress arrives.
  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [job.log.length]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>학습 진행</h2>
        {running ? (
          <Pill tone="run" dot>
            {duration(now - job.startedAt)}
          </Pill>
        ) : job.status === 'done' ? (
          <Pill tone="pass">완료 · {duration((job.endedAt ?? now) - job.startedAt)}</Pill>
        ) : (
          <Pill tone={job.status === 'cancelled' ? 'neutral' : 'fail'}>{job.status === 'cancelled' ? '중단됨' : '실패'}</Pill>
        )}
      </div>

      {job.log.length > 0 && (
        <ol className="joblog" ref={logBox}>
          {job.log.map((line, i) => (
            <li key={i} className={running && i === job.log.length - 1 ? 'joblog-now' : undefined}>
              {line}
            </li>
          ))}
        </ol>
      )}

      {!running && job.summary && <div className="job-summary">{job.status === 'done' ? <Markdown source={job.summary} /> : <p className="error-text">{job.summary}</p>}</div>}
    </section>
  );
}
