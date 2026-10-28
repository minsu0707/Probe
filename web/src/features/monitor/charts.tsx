import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { LogLine, RunSummary } from '../../core/api.ts';
import { startTime } from '../../core/format.ts';

/** One finished test, read back from the run's log ("title (1.1s)" with a status). */
export interface Result {
  ts: number;
  kind: 'pass' | 'fail' | 'skip';
  ms: number;
  title: string;
}

const DURATION = /\s*\((\d+(?:\.\d+)?)s\)\s*$/;

export function resultsOf(lines: LogLine[] | undefined): Result[] {
  const out: Result[] = [];
  for (const l of lines ?? []) {
    if (l.kind !== 'result') continue;
    const m = DURATION.exec(l.text);
    out.push({ ts: l.ts, kind: l.status === 'passed' ? 'pass' : l.status === 'skipped' ? 'skip' : 'fail', ms: m ? Number(m[1]) * 1000 : 0, title: l.text.replace(DURATION, '') });
  }
  return out;
}

const clockLabel = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const secLabel = (ms: number): string => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}분` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.round(ms)}ms`);

/** 1, 2, 5 × 10ⁿ at or above v: round axis ends. */
function niceMax(v: number): number {
  if (v <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const M = { l: 34, r: 8, t: 6, b: 18 };

/** What the tooltip says for the point under the pointer; `x` is where to snap the guide line (data units). */
interface Tip {
  x: number;
  head: string;
  rows: { color?: string; label: string; value: string }[];
}

/** Axes and grid; `draw` gets the scales. `tip` turns a pointer position (data x) into a small tooltip. */
function Plot({ height = 130, yMax, xMax, xLabel, yLabel, draw, tip }: { height?: number; yMax: number; xMax: number; xLabel: (v: number) => string; yLabel?: (v: number) => string; draw: (sx: (v: number) => number, sy: (v: number) => number, iw: number, ih: number) => ReactNode; tip?: (v: number) => Tip | null }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<Tip | null>(null);
  const iw = Math.max(0, w - M.l - M.r);
  const ih = height - M.t - M.b;
  const sx = (v: number) => M.l + (xMax ? (v / xMax) * iw : 0);
  const sy = (v: number) => M.t + ih - (yMax ? (v / yMax) * ih : 0);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = iw > 260 ? [0, 0.2, 0.4, 0.6, 0.8, 1] : [0, 0.5, 1];
  return (
    <div ref={ref} className="plot">
      {w > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          onMouseMove={
            tip
              ? (e) => {
                  const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
                  setHover(px < M.l || px > M.l + iw ? null : tip(((px - M.l) / (iw || 1)) * xMax));
                }
              : undefined
          }
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.l} x2={M.l + iw} y1={sy(v)} y2={sy(v)} />
              <text className="axis" x={M.l - 4} y={sy(v) + 3} textAnchor="end">
                {(yLabel ?? ((n: number) => String(Math.round(n * 10) / 10)))(v)}
              </text>
            </g>
          ))}
          {xTicks.map((f) => (
            <g key={f}>
              <line className="grid grid-v" x1={sx(f * xMax)} x2={sx(f * xMax)} y1={M.t} y2={M.t + ih} />
              <text className="axis" x={sx(f * xMax)} y={height - 4} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>
                {xLabel(f * xMax)}
              </text>
            </g>
          ))}
          {draw(sx, sy, iw, ih)}
          {hover && <line className="cross" x1={sx(hover.x)} x2={sx(hover.x)} y1={M.t} y2={M.t + ih} />}
        </svg>
      )}
      {hover && (
        <div className="tip" style={sx(hover.x) > w / 2 ? { right: w - sx(hover.x) + 10, top: 4 } : { left: sx(hover.x) + 10, top: 4 }}>
          <div className="tip-head">{hover.head}</div>
          {hover.rows.map((r) => (
            <div key={r.label} className="tip-row">
              <span>
                {r.color && <span className="swatch" style={{ background: r.color }} />}
                {r.label}
              </span>
              <b className="tabular">{r.value}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ title, hint, className = '', children }: { title: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel chart-card ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: { color: string; label: string; value?: string }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="swatch" style={{ background: i.color }} />
          {i.label}
          {i.value && <b className="tabular">{i.value}</b>}
        </li>
      ))}
    </ul>
  );
}

const C = { pass: 'var(--pass)', fail: 'var(--fail)', skip: 'var(--line-strong)', accent: 'var(--accent)', warn: '#d98a00' };

function NoData({ text = '완료된 테스트가 생기면 표시됩니다.' }: { text?: string }) {
  return <p className="muted small chart-empty">{text}</p>;
}

const KINDS = ['pass', 'fail', 'skip'] as const;

/** 진행 추이: cumulative passed / failed / skipped over the run's time. */
export function ProgressChart({ res, start, end, total }: { res: Result[]; start: number; end: number; total: number }) {
  const span = Math.max(end - start, (res.at(-1)?.ts ?? start) - start, 1000);
  const series = useMemo(() => {
    const acc = { pass: 0, fail: 0, skip: 0 };
    const pts: Record<(typeof KINDS)[number], [number, number][]> = { pass: [[0, 0]], fail: [[0, 0]], skip: [[0, 0]] };
    for (const r of res) {
      acc[r.kind]++;
      for (const k of KINDS) pts[k].push([r.ts - start, acc[k]]);
    }
    for (const k of KINDS) pts[k].push([span, acc[k]]);
    return { pts, acc };
  }, [res, start, span]);
  const yMax = niceMax(Math.max(total, series.acc.pass + series.acc.fail + series.acc.skip, 1));
  return (
    <Card title="진행 추이" hint="누적 테스트 수" className="d-8">
      {res.length === 0 ? (
        <NoData />
      ) : (
        <Plot
          xMax={span}
          yMax={yMax}
          xLabel={clockLabel}
          tip={(v) => {
            const c = { pass: 0, fail: 0, skip: 0 };
            for (const r of res) if (r.ts - start <= v) c[r.kind]++;
            return { x: v, head: `${clockLabel(v)} 시점`, rows: [{ color: C.pass, label: '통과', value: String(c.pass) }, { color: C.fail, label: '실패', value: String(c.fail) }, { color: C.skip, label: '건너뜀', value: String(c.skip) }, { label: '진행', value: total ? `${c.pass + c.fail + c.skip}/${total}` : String(c.pass + c.fail + c.skip) }] };
          }}
          draw={(sx, sy) => (
            <>
              {(['skip', 'fail', 'pass'] as const).map((k) => {
                const d = series.pts[k].map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
                return (
                  <g key={k}>
                    {k === 'pass' && <path d={`${d}L${sx(span)},${sy(0)}L${sx(0)},${sy(0)}Z`} fill={C.pass} opacity="0.12" />}
                    <path d={d} fill="none" stroke={C[k]} strokeWidth="1.6" strokeLinejoin="round" />
                  </g>
                );
              })}
            </>
          )}
        />
      )}
      <Legend items={[{ color: C.pass, label: '통과', value: String(series.acc.pass) }, { color: C.fail, label: '실패', value: String(series.acc.fail) }, { color: C.skip, label: '건너뜀', value: String(series.acc.skip) }]} />
    </Card>
  );
}

/** 통과율 gauge: passed / (passed + failed), skipped tests left out. */
export function PassGauge({ res }: { res: Result[] }) {
  const pass = res.filter((r) => r.kind === 'pass').length;
  const fail = res.filter((r) => r.kind === 'fail').length;
  const rate = pass + fail ? (pass / (pass + fail)) * 100 : null;
  const color = rate === null ? C.skip : rate >= 90 ? C.pass : rate >= 70 ? C.warn : C.fail;
  const r = 52;
  const arc = `M${60 - r},64 A${r},${r} 0 0 1 ${60 + r},64`;
  return (
    <Card title="통과율" hint="건너뜀 제외" className="d-4">
      <div className="gauge">
        <svg viewBox="0 0 120 70" role="img" aria-label={rate === null ? '통과율 없음' : `통과율 ${rate.toFixed(1)}%`}>
          <title>{`통과 ${pass} · 실패 ${fail}`}</title>
          <path d={arc} className="gauge-track" pathLength="100" />
          {rate !== null && rate > 0 && <path d={arc} className="gauge-value" pathLength="100" strokeDasharray={`${rate} 100`} style={{ stroke: color }} />}
        </svg>
        <div className="gauge-num tabular" style={{ color: rate === null ? undefined : color }}>
          {rate === null ? '—' : `${rate.toFixed(rate === 100 || rate === 0 ? 0 : 1)}%`}
        </div>
      </div>
    </Card>
  );
}

/** 처리량: finished tests per slice of the run, stacked by outcome. */
export function ThroughputChart({ res, start, end }: { res: Result[]; start: number; end: number }) {
  const span = Math.max(end - start, (res.at(-1)?.ts ?? start) - start, 1000);
  const n = 24;
  const buckets = useMemo(() => {
    const b = Array.from({ length: n }, () => ({ pass: 0, fail: 0, skip: 0 }));
    for (const r of res) b[Math.min(n - 1, Math.max(0, Math.floor(((r.ts - start) / span) * n)))][r.kind]++;
    return b;
  }, [res, start, span]);
  const yMax = niceMax(Math.max(1, ...buckets.map((b) => b.pass + b.fail + b.skip)));
  return (
    <Card title="처리량" hint={`${secLabel(span / n)}마다`} className="d-6">
      {res.length === 0 ? (
        <NoData />
      ) : (
        <Plot
          xMax={span}
          yMax={yMax}
          xLabel={clockLabel}
          tip={(v) => {
            const i = Math.min(n - 1, Math.max(0, Math.floor((v / span) * n)));
            const b = buckets[i];
            return { x: ((i + 0.5) / n) * span, head: `${clockLabel((i / n) * span)} ~ ${clockLabel(((i + 1) / n) * span)}`, rows: [{ color: C.pass, label: '통과', value: String(b.pass) }, { color: C.fail, label: '실패', value: String(b.fail) }, { color: C.skip, label: '건너뜀', value: String(b.skip) }] };
          }}
          draw={(sx, sy, iw) => {
            const bw = Math.max(2, iw / n - 2);
            return buckets.map((b, i) => {
              let y = 0;
              return (
                <g key={i}>
                  {KINDS.map((k) => {
                    const rect = b[k] ? <rect key={k} x={sx((i / n) * span) + 1} y={sy(y + b[k])} width={bw} height={sy(y) - sy(y + b[k])} fill={C[k]} /> : null;
                    y += b[k];
                    return rect;
                  })}
                </g>
              );
            });
          }}
        />
      )}
      <Legend items={[{ color: C.pass, label: '통과' }, { color: C.fail, label: '실패' }, { color: C.skip, label: '건너뜀' }]} />
    </Card>
  );
}

/** 테스트 소요 시간: how long each finished test took, in the order they finished. */
export function DurationChart({ res }: { res: Result[] }) {
  const timed = res.filter((r) => r.kind !== 'skip');
  const avg = timed.length ? timed.reduce((a, r) => a + r.ms, 0) / timed.length : 0;
  const max = Math.max(0, ...timed.map((r) => r.ms));
  const yMax = niceMax(Math.max(max / 1000, 1)) * 1000;
  const last = Math.max(timed.length - 1, 1);
  return (
    <Card title="테스트 소요 시간" hint="끝난 순서" className="d-6">
      {timed.length === 0 ? (
        <NoData />
      ) : (
        <Plot
          xMax={last}
          yMax={yMax}
          xLabel={(v) => `#${Math.round(v) + 1}`}
          yLabel={secLabel}
          tip={(v) => {
            const i = Math.min(timed.length - 1, Math.max(0, Math.round(v)));
            const r = timed[i];
            return { x: i, head: `#${i + 1} ${r.title}`, rows: [{ color: r.kind === 'fail' ? C.fail : C.accent, label: r.kind === 'fail' ? '실패' : '통과', value: secLabel(r.ms) }, { color: C.warn, label: '평균 대비', value: `${r.ms >= avg ? '+' : '-'}${secLabel(Math.abs(r.ms - avg))}` }] };
          }}
          draw={(sx, sy, iw) => (
            <>
              <line x1={sx(0)} x2={sx(last)} y1={sy(avg)} y2={sy(avg)} className="avg-line" />
              <path d={timed.map((r, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(r.ms).toFixed(1)}`).join('')} fill="none" stroke={C.accent} strokeWidth="1.4" strokeLinejoin="round" />
              {timed.length <= 120 &&
                timed.map((r, i) => (
                  <circle key={i} cx={sx(i)} cy={sy(r.ms)} r={iw / timed.length > 6 ? 2.6 : 1.8} fill={r.kind === 'fail' ? C.fail : C.accent} />
                ))}
            </>
          )}
        />
      )}
      <Legend items={[{ color: C.accent, label: '소요' }, { color: C.fail, label: '실패' }, { color: C.warn, label: '평균', value: timed.length ? secLabel(avg) : '—' }, { color: C.skip, label: '최대', value: timed.length ? secLabel(max) : '—' }]} />
    </Card>
  );
}

/** 실행별 통과율: the last runs of this service; click a bar to open that run. */
export function TrendChart({ runs, currentId, onPick }: { runs: RunSummary[]; currentId: string; onPick: (id: string) => void }) {
  const list = runs
    .filter((r) => r.status !== 'starting' && r.totals.passed + r.totals.failed > 0)
    .slice(0, 24)
    .reverse();
  const rate = (r: RunSummary) => (r.totals.passed / (r.totals.passed + r.totals.failed)) * 100;
  const timeOf = (i: number) => {
    const r = list[Math.min(list.length - 1, Math.max(0, Math.round(i)))];
    return r ? (startTime(r.startedAt).split(' ').at(-1) ?? '') : '';
  };
  return (
    <Card title="실행별 통과율" hint="막대를 누르면 그 실행이 열립니다" className="d-6">
      {list.length < 2 ? (
        <NoData text="실행 기록이 2건 이상 쌓이면 추세가 표시됩니다." />
      ) : (
        <Plot
          xMax={list.length}
          yMax={100}
          xLabel={timeOf}
          yLabel={(v) => `${Math.round(v)}%`}
          tip={(v) => {
            const i = Math.min(list.length - 1, Math.max(0, Math.floor(v)));
            const r = list[i];
            return { x: i + 0.5, head: startTime(r.startedAt), rows: [{ label: '통과율', value: `${rate(r).toFixed(1)}%` }, { color: C.pass, label: '통과', value: String(r.totals.passed) }, { color: C.fail, label: '실패', value: String(r.totals.failed) }, { color: C.skip, label: '건너뜀', value: String(r.totals.skipped) }, { label: '결함', value: String(r.defects) }] };
          }}
          draw={(sx, sy, iw) => {
            const bw = Math.max(3, iw / list.length - 3);
            return list.map((r, i) => {
              const v = rate(r);
              const color = v >= 90 ? C.pass : v >= 70 ? C.warn : C.fail;
              return (
                <g key={r.id} className="bar-hit" onClick={() => onPick(r.id)}>
                  <rect x={sx(i) + 1} y={sy(100)} width={bw} height={sy(0) - sy(100)} fill="transparent" />
                  <rect x={sx(i) + 1} y={sy(v)} width={bw} height={sy(0) - sy(v)} fill={color} opacity={r.id === currentId ? 1 : 0.5} stroke={r.id === currentId ? 'var(--ink)' : 'none'} />
                </g>
              );
            });
          }}
        />
      )}
    </Card>
  );
}

/** 느린 테스트: the slowest finished tests of the run. */
export function SlowestList({ res }: { res: Result[] }) {
  const top = res
    .filter((r) => r.kind !== 'skip')
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6);
  const max = top[0]?.ms || 1;
  return (
    <Card title="느린 테스트 TOP 6" className="d-6">
      {top.length === 0 ? (
        <NoData />
      ) : (
        <ol className="hbars">
          {top.map((r, i) => (
            <li key={i} title={`${r.title} · ${secLabel(r.ms)}`}>
              <span className="hbar-label ellipsis">{r.title}</span>
              <span className="hbar-track">
                <span className="hbar-fill" style={{ width: `${(r.ms / max) * 100}%`, background: r.kind === 'fail' ? C.fail : C.accent }} />
              </span>
              <b className="tabular">{secLabel(r.ms)}</b>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
