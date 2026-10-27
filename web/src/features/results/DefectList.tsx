import { Fragment, useState } from 'react';
import type { Defect } from '../../core/api.ts';
import { useStore } from '../../core/store.ts';
import { CAUSE_LABEL } from '../../core/format.ts';
import { Empty, useNow } from '../../ui/index.ts';
import { DefectDetail, DefectItem } from './DefectRow.tsx';

/** "open" is a convenience bucket: anything not yet fixed or dismissed. */
type Filter = 'open' | Defect['status'] | 'all';

const FILTERS: [Filter, string][] = [
  ['all', '전체'],
  ['open', '열린 결함'],
  ['candidate', '확인 필요'],
  ['confirmed', '확정'],
  ['fixed', '수정됨'],
  ['false_positive', '오탐'],
];

const matches = (d: Defect, f: Filter): boolean => (f === 'all' ? true : f === 'open' ? d.status === 'candidate' || d.status === 'confirmed' : d.status === f);

/** Defects for one service: filters and a compact list on the left, the selected one in full on the right. */
export function DefectList({ serviceId }: { serviceId: string }) {
  const allDefects = useStore((s) => s.defects);
  const mine = allDefects.filter((d) => d.serviceId === serviceId);
  const [filter, setFilter] = useState<Filter>('open');
  const [cause, setCause] = useState<Defect['cause'] | 'all'>('all');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const now = useNow(30_000);
  const shown = mine.filter((d) => matches(d, filter) && (cause === 'all' || d.cause === cause));
  // A failure that follows another one in the same file is listed under it, not on its own.
  const byId = new Map(mine.map((d) => [d.id, d]));
  const isChild = (d: Defect) => Boolean(d.followsId && shown.some((p) => p.id === d.followsId));
  const children = (id: string) => shown.filter((d) => d.followsId === id);
  const top = shown.filter((d) => !isChild(d));
  // Nothing picked, or the picked one dropped out of the filter: show the first so the right side is never empty.
  const selected = shown.find((d) => d.id === pickedId) ?? top[0] ?? null;
  const followedFrom = (d: Defect) => (d.followsId ? byId.get(d.followsId)?.title : undefined);

  return (
    <>
      <div className="filters" role="group" aria-label="결함 필터">
        {FILTERS.map(([f, label]) => (
          <Fragment key={f}>
            <button className={`filter${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label} <span className="tabular">{mine.filter((d) => matches(d, f)).length}</span>
            </button>
            {f === 'all' && <span className="filter-sep" aria-hidden="true" />}
          </Fragment>
        ))}
      </div>

      <div className="filters" role="group" aria-label="원인 추정 필터">
        {(['all', 'app', 'test', 'env', 'unknown'] as const).map((c) => (
          <Fragment key={c}>
            <button className={`filter${cause === c ? ' on' : ''}`} aria-pressed={cause === c} onClick={() => setCause(c)}>
              {c === 'all' ? '원인 전체' : CAUSE_LABEL[c]} <span className="tabular">{mine.filter((d) => matches(d, filter) && (c === 'all' || d.cause === c)).length}</span>
            </button>
            {c === 'all' && <span className="filter-sep" aria-hidden="true" />}
          </Fragment>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title={mine.length === 0 ? '아직 발견된 결함이 없습니다' : '이 조건의 결함이 없습니다'}>
          {mine.length === 0 && '테스트가 실패하면 결함 후보가 자동으로 만들어지고, 같은 원인으로 실패하면 한 건으로 묶여 횟수만 올라갑니다.'}
        </Empty>
      ) : (
        <div className="defect-split">
          <ul className="defect-list">
            {top.map((d) => {
              const kids = children(d.id);
              return (
                <li key={d.id} className="defect-group">
                  <ul className="defects">
                    <DefectItem defect={d} selected={selected?.id === d.id} onSelect={() => setPickedId(d.id)} now={now} />
                  </ul>
                  {kids.length > 0 && (
                    <details className="defect-kids" open={kids.some((k) => k.id === selected?.id)}>
                      <summary>이 실패 뒤에 이어서 실패한 {kids.length}건 (앞의 원인의 영향일 수 있음)</summary>
                      <ul className="defects">
                        {kids.map((k) => (
                          <DefectItem key={k.id} defect={k} selected={selected?.id === k.id} onSelect={() => setPickedId(k.id)} now={now} />
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          {selected && (
            <section className="defect-pane" aria-label="선택한 결함">
              <DefectDetail key={selected.id} defect={selected} followedFrom={followedFrom(selected)} />
            </section>
          )}
        </div>
      )}
    </>
  );
}
