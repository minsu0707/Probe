import { useState } from 'react';
import { ago, runTone, RUN_STATUS_LABEL } from '../../core/format.ts';
import { selectService, useStore } from '../../core/store.ts';
import { Empty, Icon, Pill, useNow } from '../../ui/index.ts';
import { AddServiceModal } from './AddServiceModal.tsx';
import { ServiceDetail } from './ServiceDetail.tsx';

/** 서비스: pick a service on the left, edit it on the right. */
export function ServicesPage({ onOpenLearn }: { onOpenLearn: () => void }) {
  const services = useStore((s) => s.services);
  const currentId = useStore((s) => s.currentId);
  const [adding, setAdding] = useState(false);
  const now = useNow(30_000);
  const current = services.find((s) => s.id === currentId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>서비스</h1>
          <p className="muted">테스트할 서비스를 등록하고 접속 정보를 관리합니다.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          서비스 추가
        </button>
      </div>

      {services.length === 0 ? (
        <Empty
          title="등록된 서비스가 없습니다"
          action={
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} />첫 서비스 등록
            </button>
          }
        >
          서비스 이름과 주소를 입력하고 <code>.env</code> 또는 <code>.enc</code> 파일을 올리면 바로 테스트할 수 있습니다.
        </Empty>
      ) : (
        <div className="split">
          <section className="panel list" aria-label="서비스 목록">
            {services.map((s) => (
              <button key={s.id} className={`row${s.id === currentId ? ' row-on' : ''}`} onClick={() => selectService(s.id)} aria-pressed={s.id === currentId}>
                <div className="row-main">
                  <strong>{s.name}</strong>
                  <span className="muted small ellipsis">{s.baseUrl ?? '주소 없음'}</span>
                </div>
                <div className="row-meta">
                  {s.activeRun ? (
                    <Pill tone="run" dot>
                      실행 중
                    </Pill>
                  ) : s.lastRun ? (
                    <Pill tone={runTone(s.lastRun.status)}>
                      {s.lastRun.status === 'failed' ? `실패 ${s.lastRun.totals.failed}` : RUN_STATUS_LABEL[s.lastRun.status]} · {ago(s.lastRun.startedAt, now)}
                    </Pill>
                  ) : (
                    <Pill>실행 기록 없음</Pill>
                  )}
                  <span className="small muted tabular">
                    변수 {s.secretCount} · 문서 {s.docCount} · 결함 {s.openDefects}
                  </span>
                </div>
              </button>
            ))}
          </section>
          {/* key remounts the editor per service so its drafts never leak between services */}
          {current && <ServiceDetail key={current.id} service={current} onOpenLearn={onOpenLearn} />}
        </div>
      )}
      {adding && <AddServiceModal onClose={() => setAdding(false)} />}
    </>
  );
}
