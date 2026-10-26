import { useEffect, useState, type FormEvent } from 'react';
import { api, type SecretMeta, type ServiceOverview } from '../api.ts';
import { ago } from '../format.ts';
import { attempt, selectService, toast, useStore } from '../store.ts';
import { Empty, FileDrop, Icon, Modal, Pill, useNow } from '../ui.tsx';

const ENC_PREFIX = 'UFJCRU5DMQ'; // base64 of "PRBENC1\n"
const looksEncrypted = (name: string, text: string) => name.toLowerCase().endsWith('.enc') || text.trim().startsWith(ENC_PREFIX);

export function ServicesPage({ go }: { go: (r: 'learn' | 'monitor') => void }) {
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
              <Icon name="plus" size={16} />
              첫 서비스 등록
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
                    <Pill tone={s.lastRun.status === 'passed' ? 'pass' : s.lastRun.status === 'failed' ? 'fail' : 'neutral'}>
                      {s.lastRun.status === 'passed' ? '통과' : s.lastRun.status === 'failed' ? `실패 ${s.lastRun.totals.failed}` : '오류'} · {ago(s.lastRun.startedAt, now)}
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
          {current && <ServiceDetail key={current.id} service={current} go={go} />}
        </div>
      )}
      {adding && <AddServiceModal onClose={() => setAdding(false)} />}
    </>
  );
}

function ServiceDetail({ service, go }: { service: ServiceOverview; go: (r: 'learn' | 'monitor') => void }) {
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
          <button type="button" className="btn" onClick={() => go('learn')}>
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

function EnvPanel({ service }: { service: ServiceOverview }) {
  const version = useStore((s) => s.serviceVersion[service.id] ?? 0);
  const [keys, setKeys] = useState<SecretMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEnc, setPendingEnc] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let live = true;
    api.env(service.id).then((k) => live && setKeys(k), () => live && setKeys([]));
    return () => {
      live = false;
    };
  }, [service.id, version]);

  const importText = async (text: string, passphrase?: string) => {
    setBusy(true);
    const r = await attempt(() => api.importEnv(service.id, text, passphrase));
    setBusy(false);
    if (r) {
      setPendingEnc(null);
      toast(`${r.keys.length}개 변수를 등록했습니다${r.encrypted ? ' (암호화 파일)' : ''}`);
    }
    return Boolean(r);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>환경 변수</h2>
        {keys && keys.length > 0 && (
          <button className="btn btn-quiet btn-sm" onClick={() => setExporting(true)}>
            <Icon name="download" size={14} />
            암호화 파일로 내보내기
          </button>
        )}
      </div>
      <FileDrop
        label=".env 또는 .enc 파일을 끌어다 놓거나 선택"
        hint="같은 이름의 변수는 덮어씁니다. 값은 이 컴퓨터에 암호화되어 저장되고, 화면과 Claude에는 이름만 전달됩니다."
        busy={busy}
        onFiles={async ([file]) => {
          const text = await file.text();
          if (looksEncrypted(file.name, text)) setPendingEnc(text);
          else await importText(text);
        }}
      />
      {keys === null ? null : keys.length === 0 ? (
        <p className="muted small">아직 등록된 변수가 없습니다. 테스트 계정, 토큰 등을 파일로 올리세요.</p>
      ) : (
        <ul className="kv">
          {keys.map((k) => (
            <li key={k.key}>
              <code>{k.key}</code>
              <span className={k.sensitive ? 'masked' : 'plain'}>{k.sensitive ? '••••••••' : k.value}</span>
              <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${k.key} 삭제`} onClick={() => void attempt(() => api.deleteSecret(service.id, k.key))}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {pendingEnc && (
        <PassphraseModal
          title="암호화 파일 열기"
          confirm="가져오기"
          onClose={() => setPendingEnc(null)}
          onSubmit={async (p) => {
            await importText(pendingEnc, p);
          }}
        />
      )}
      {exporting && (
        <PassphraseModal
          title="암호화 파일로 내보내기"
          confirm="내보내기"
          hint="8자 이상. 이 암호를 잊으면 파일을 열 수 없습니다."
          confirmTwice
          onClose={() => setExporting(false)}
          onSubmit={async (p) => {
            const text = await attempt(() => api.exportEnc(service.id, p));
            if (text === undefined) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            a.download = `${service.name.replace(/[^\w가-힣-]+/g, '_')}.enc`;
            a.click();
            URL.revokeObjectURL(a.href);
            setExporting(false);
          }}
        />
      )}
    </section>
  );
}

function PassphraseModal({ title, confirm, hint, confirmTwice, onClose, onSubmit }: { title: string; confirm: string; hint?: string; confirmTwice?: boolean; onClose: () => void; onSubmit: (passphrase: string) => Promise<void> }) {
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirmTwice && p2 !== '' && p !== p2;
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (mismatch || (confirmTwice && p !== p2)) return;
          setBusy(true);
          await onSubmit(p);
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="pp">암호</label>
          <input id="pp" type="password" autoFocus value={p} onChange={(e) => setP(e.target.value)} autoComplete="off" required />
          {hint && <span className="hint">{hint}</span>}
        </div>
        {confirmTwice && (
          <div className="field">
            <label htmlFor="pp2">암호 확인</label>
            <input id="pp2" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="off" required aria-invalid={mismatch} />
            {mismatch && <span className="hint hint-bad">암호가 일치하지 않습니다</span>}
          </div>
        )}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !p || (confirmTwice && p !== p2)}>
            {confirm}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddServiceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const encrypted = file ? looksEncrypted(file.name, file.text) : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const created = await attempt(() => api.createService({ name, baseUrl: url.trim() || undefined }));
    if (created) {
      selectService(created.id);
      if (file) {
        const r = await attempt(() => api.importEnv(created.id, file.text, pass || undefined));
        if (!r) {
          // The service exists; the user can retry the file from its page.
          setBusy(false);
          onClose();
          return;
        }
      }
      toast(`${created.name}을(를) 등록했습니다`);
      onClose();
    }
    setBusy(false);
  };

  return (
    <Modal title="서비스 추가" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="add-name">이름</label>
          <input id="add-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required placeholder="예: 서울F&B 레시피 시스템" />
        </div>
        <div className="field">
          <label htmlFor="add-url">서비스 주소</label>
          <input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" />
          <span className="hint">비워두면 환경 파일의 BASE_URL을 사용합니다.</span>
        </div>
        <div className="field">
          <span className="label">환경 파일 (선택)</span>
          {file ? (
            <div className="file-chip">
              <Icon name="file" size={16} />
              <span className="ellipsis">{file.name}</span>
              <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label="파일 제거" onClick={() => (setFile(null), setPass(''))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : (
            <FileDrop label=".env 또는 .enc 파일 선택" onFiles={async ([f]) => setFile({ name: f.name, text: await f.text() })} />
          )}
        </div>
        {encrypted && (
          <div className="field">
            <label htmlFor="add-pass">.enc 암호</label>
            <input id="add-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" required />
          </div>
        )}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? '등록 중…' : '등록'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
