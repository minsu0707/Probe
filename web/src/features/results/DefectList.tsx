import { useState } from 'react';
import type { Defect } from '../../core/api.ts';
import { useStore } from '../../core/store.ts';
import { CAUSE_LABEL } from '../../core/format.ts';
import { Empty, useNow } from '../../ui/index.ts';
import { DefectRow } from './DefectRow.tsx';

/** "open" is a convenience bucket: anything not yet fixed or dismissed. */
type Filter = 'open' | Defect['status'] | 'all';

const FILTERS: [Filter, string][] = [
  ['open', '열린 결함'],
  ['candidate', '확인 필요'],
  ['confirmed', '확정'],
  ['fixed', '수정됨'],
  ['false_positive', '오탐'],
  ['all', '전체'],
];

const matches = (d: Defect, f: Filter): boolean => (f === 'all' ? true : f === 'open' ? d.status === 'candidate' || d.status === 'confirmed' : d.status === f);

/** Defects for one service with status filters. Newest activity first (the server orders them). */
export function DefectList({ serviceId }: { serviceId: string }) {
  const allDefects = useStore((s) => s.defects);
  const mine = allDefects.filter((d) => d.serviceId === serviceId);
  const [filter, setFilter] = useState<Filter>('open');
  const [cause, setCause] = useState<Defect['cause'] | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(30_000);
  const shown = mine.filter((d) => matches(d, filter) && (cause === 'all' || d.cause === cause));
  // A failure that follows another one in the same file is listed under it, not on its own.
  const byId = new Map(mine.map((d) => [d.id, d]));
  const isChild = (d: Defect) => Boolean(d.followsId && shown.some((p) => p.id === d.followsId));
  const children = (id: string) => shown.filter((d) => d.followsId === id);
  const top = shown.filter((d) => !isChild(d));

  return (
    <>
      <div className="filters" role="group" aria-label="결함 필터">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`filter${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="tabular">{mine.filter((d) => matches(d, f)).length}</span>
          </button>
        ))}
      </div>

      <div className="filters" role="group" aria-label="원인 추정 필터">
        {(['all', 'app', 'test', 'env', 'unknown'] as const).map((c) => (
          <button key={c} className={`filter${cause === c ? ' on' : ''}`} aria-pressed={cause === c} onClick={() => setCause(c)}>
            {c === 'all' ? '원인 전체' : CAUSE_LABEL[c]} <span className="tabular">{mine.filter((d) => matches(d, filter) && (c === 'all' || d.cause === c)).length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title={mine.length === 0 ? '아직 발견된 결함이 없습니다' : '이 조건의 결함이 없습니다'}>
          {mine.length === 0 && '테스트가 실패하면 결함 후보가 자동으로 만들어지고, 같은 원인으로 실패하면 한 건으로 묶여 횟수만 올라갑니다.'}
        </Empty>
      ) : (
        <ul className="defects">
          {top.map((d) => {
            const kids = children(d.id);
            return (
              <li key={d.id} className="defect-group">
                <ul className="defects">
                  <DefectRow defect={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} now={now} followedFrom={d.followsId ? byId.get(d.followsId)?.title : undefined} />
                </ul>
                {kids.length > 0 && (
                  <details className="defect-kids">
                    <summary>이 실패 뒤에 이어서 실패한 {kids.length}건 (앞의 원인의 영향일 수 있음)</summary>
                    <ul className="defects">
                      {kids.map((k) => (
                        <DefectRow key={k.id} defect={k} open={openId === k.id} onToggle={() => setOpenId(openId === k.id ? null : k.id)} now={now} followedFrom={d.title} />
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
