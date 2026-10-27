import { useState, type FormEvent } from 'react';
import { api } from '../../core/api.ts';
import { goService } from '../../app/router.ts';
import { attempt, selectService, toast } from '../../core/store.ts';
import { FileDrop, Icon, Modal } from '../../ui/index.ts';
import { looksEncrypted } from './envFile.ts';

/** Register a service in one step: name, URL, and optionally an env file to import with it. */
export function AddServiceModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const encrypted = file ? looksEncrypted(file.name, file.text) : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const created = await attempt(() => api.createService({ name, baseUrl: url.trim() || undefined, readOnly }));
    if (created) {
      selectService(created.id);
      goService(created.id);
      // The service already exists if the file fails; the user can retry it from the service page.
      if (file && !(await attempt(() => api.importEnv(created.id, file.text, passphrase || undefined)))) {
        setBusy(false);
        return onClose();
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
          <input id="add-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required placeholder="예: 쇼핑몰 관리자 페이지" />
        </div>
        <div className="field">
          <label htmlFor="add-url">서비스 주소</label>
          <input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" />
          <span className="hint">비워두면 환경 파일의 BASE_URL을 사용합니다.</span>
        </div>
        <label className="check-field">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          <span>
            <strong>조회 전용</strong>
            <span className="hint">운영 데이터처럼 함부로 바꾸면 안 되는 서비스일 때 켜세요. 테스트가 보기만 하고, 등록·수정·삭제 요청은 테스트 브라우저에서 막습니다. 나중에 서비스 설정에서 바꿀 수 있습니다.</span>
          </span>
        </label>
        <div className="field">
          <span className="label">환경 파일 (선택)</span>
          {file ? (
            <div className="file-chip">
              <Icon name="file" size={16} />
              <span className="ellipsis">{file.name}</span>
              <button type="button" className="btn btn-quiet btn-icon btn-sm" aria-label="파일 제거" onClick={() => (setFile(null), setPassphrase(''))}>
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
            <input id="add-pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" required />
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
