import { useState } from 'react';
import type { Defect } from '../../core/api.ts';
import { useStore } from '../../core/store.ts';
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
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(30_000);
  const shown = mine.filter((d) => matches(d, filter));

  return (
    <>
      <div className="filters" role="group" aria-label="결함 필터">
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`filter${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="tabular">{mine.filter((d) => matches(d, f)).length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty title={mine.length === 0 ? '아직 발견된 결함이 없습니다' : '이 조건의 결함이 없습니다'}>
          {mine.length === 0 && '테스트가 실패하면 결함 후보가 자동으로 만들어지고, 같은 원인으로 실패하면 한 건으로 묶여 횟수만 올라갑니다.'}
        </Empty>
      ) : (
        <ul className="defects">
          {shown.map((d) => (
            <DefectRow key={d.id} defect={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}
