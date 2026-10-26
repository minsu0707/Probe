import { useState, type FormEvent } from 'react';
import { api, type ServiceOverview } from '../../core/api.ts';
import { attempt } from '../../core/store.ts';
import { Icon } from '../../ui/index.ts';
import { EnvPanel } from './EnvPanel.tsx';

/** Edit panel for the selected service: basic info, env variables, and deletion. */
export function ServiceDetail({ service, onOpenLearn }: { service: ServiceOverview; onOpenLearn: () => void }) {
  // Local drafts so typing doesn't fight with server pushes; the parent remounts this per service.
  const [name, setName] = useState(service.name);
  const [url, setUrl] = useState(service.baseUrl ?? '');
  const [notes, setNotes] = useState(service.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = name !== service.name || url !== (service.baseUrl ?? '') || notes !== (service.notes ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await attempt(() => api.updateService(service.id, { name, baseUrl: url.trim() || null, notes: notes.trim() || null }), '저장했습니다');
  };

  return (
    <div className="stack">
      <form className="panel" onSubmit={save}>
        <h2>기본 정보</h2>
        <div className="field">
          <label htmlFor="svc-name">이름</label>
          <input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="svc-url">서비스 주소</label>
          <input id="svc-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" />
          <span className="hint">테스트의 baseURL로 쓰입니다. 환경 파일에 BASE_URL이 있으면 처음 한 번 자동으로 채워집니다.</span>
        </div>
        <div className="field">
          <label htmlFor="svc-notes">메모</label>
          <textarea id="svc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="테스트 계정 역할, 주의할 점 등" />
        </div>
        <div className="actions">
          <button className="btn btn-primary" disabled={!dirty}>
            저장
          </button>
          <button type="button" className="btn" onClick={onOpenLearn}>
            문서 · 학습으로
          </button>
        </div>
      </form>

      <EnvPanel service={service} />

      <section className="panel danger-zone">
        <h2>서비스 삭제</h2>
        <p className="muted small">등록 정보, 환경 변수, 올린 문서, 학습 결과, 테스트 코드와 실행 기록이 모두 삭제됩니다.</p>
        {confirmDelete ? (
          <div className="actions">
            <button className="btn btn-danger" onClick={() => void attempt(() => api.deleteService(service.id), '삭제했습니다')}>
              삭제 확인
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              취소
            </button>
          </div>
        ) : (
          <button className="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={16} />
            {service.name} 삭제
          </button>
        )}
      </section>
    </div>
  );
}
