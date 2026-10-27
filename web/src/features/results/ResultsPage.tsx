import { useState } from 'react';
import { useStore } from '../../core/store.ts';
import { Empty } from '../../ui/index.ts';
import { DefectList } from './DefectList.tsx';
import { RunList } from './RunList.tsx';

type Tab = 'defects' | 'runs';

/** 결과 · 결함: triage defects, or browse past runs. */
export function ResultsPage() {
  const service = useStore((s) => s.services.find((x) => x.id === s.currentId));
  const [tab, setTab] = useState<Tab>('defects');
  if (!service) return <Empty title="서비스를 먼저 등록하세요">테스트 결과와 결함은 서비스별로 모입니다.</Empty>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>결과 · 결함</h1>
          <p className="muted">{service.name}의 실행 기록과 발견된 결함입니다.</p>
        </div>
        <div className="seg-control" role="tablist">
          <button role="tab" aria-selected={tab === 'defects'} className={tab === 'defects' ? 'on' : ''} onClick={() => setTab('defects')}>
            결함
          </button>
          <button role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'on' : ''} onClick={() => setTab('runs')}>
            실행 기록
          </button>
        </div>
      </div>
      {tab === 'defects' ? <DefectList serviceId={service.id} /> : <RunList serviceId={service.id} />}
    </>
  );
}
