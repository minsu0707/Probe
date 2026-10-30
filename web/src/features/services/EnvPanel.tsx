import { useEffect, useState } from 'react';
import { api, type SecretMeta, type ServiceOverview } from '../../core/api.ts';
import { attempt, toast, useStore } from '../../core/store.ts';
import { ConfirmModal, FileDrop, Icon } from '../../ui/index.ts';
import { downloadText, FORMAT_LABEL, fileToBase64, looksEncrypted, safeFileName } from './envFile.ts';
import { PassphraseModal } from './PassphraseModal.tsx';

/** A service's environment variables: import from .env/.enc, list (values masked), delete, export. */
export function EnvPanel({ service }: { service: ServiceOverview }) {
  const version = useStore((s) => s.serviceVersion[service.id] ?? 0);
  const [keys, setKeys] = useState<SecretMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** Text of an .enc file waiting for its passphrase. */
  const [pendingEnc, setPendingEnc] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Sensitive values the user chose to show, by key. Dropped whenever the list is reloaded or the service changes. */
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const toggle = async (key: string) => {
    if (revealed[key] !== undefined) return setRevealed(({ [key]: _hide, ...rest }) => rest);
    const value = await attempt(() => api.revealSecret(service.id, key));
    if (value !== undefined) setRevealed((r) => ({ ...r, [key]: value }));
  };

  // Refetch when the server says this service changed (version bump) or the selection changes.
  useEffect(() => {
    let alive = true;
    setRevealed({});
    api.env(service.id).then((k) => alive && setKeys(k), () => alive && setKeys([]));
    return () => {
      alive = false;
    };
  }, [service.id, version]);

  const importText = async (text: string, passphrase?: string) => {
    setBusy(true);
    const result = await attempt(() => api.importEnv(service.id, text, passphrase));
    setBusy(false);
    if (result) {
      setPendingEnc(null);
      toast(`${result.keys.length}개 변수를 등록했습니다${result.encrypted ? ' (암호화 파일)' : ''}`);
    }
  };

  /** Any other file (a spreadsheet, CSV, JSON, a note): the server finds the accounts in it. */
  const importAny = async (file: File) => {
    setBusy(true);
    const result = await attempt(async () => api.importEnvFile(service.id, file.name, await fileToBase64(file)));
    setBusy(false);
    if (result) {
      const names = result.keys.slice(0, 6).join(', ') + (result.keys.length > 6 ? ` 외 ${result.keys.length - 6}개` : '');
      toast(`${FORMAT_LABEL[result.format] ?? '파일'}에서 ${result.keys.length}개 변수를 찾아 암호화해 등록했습니다: ${names}`);
    }
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
        label="계정 정보 파일을 끌어다 놓거나 선택 (.env, .enc, 엑셀, CSV, JSON, 메모)"
        hint="같은 이름의 변수는 덮어씁니다. 값은 이 컴퓨터에 암호화되어 저장되고, Claude에는 이름만 전달되고, 비밀번호처럼 가려진 값은 눈 아이콘을 눌러야 보입니다."
        busy={busy}
        onFiles={async ([file]) => {
          const text = await file.text();
          if (looksEncrypted(file.name, text)) setPendingEnc(text);
          else await importAny(file);
        }}
      />

      {keys === null ? null : keys.length === 0 ? (
        <p className="muted small">아직 등록된 변수가 없습니다. 테스트 계정, 토큰 등을 파일로 올리세요.</p>
      ) : (
        <ul className="kv">
          {keys.map((k) => (
            <li key={k.key}>
              <code>{k.key}</code>
              {k.sensitive && revealed[k.key] === undefined ? <span className="masked">••••••••</span> : <span className="plain">{k.sensitive ? revealed[k.key] : k.value}</span>}
              <span className="kv-actions">
                {k.sensitive && (
                  <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${k.key} ${revealed[k.key] === undefined ? '값 보기' : '값 숨기기'}`} title={revealed[k.key] === undefined ? '값 보기' : '값 숨기기'} onClick={() => void toggle(k.key)}>
                    <Icon name={revealed[k.key] === undefined ? 'eye' : 'eyeOff'} size={14} />
                  </button>
                )}
                <button className="btn btn-quiet btn-icon btn-sm" aria-label={`${k.key} 삭제`} onClick={() => setDeleting(k.key)}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <ConfirmModal title="환경 변수 삭제" onConfirm={() => attempt(() => api.deleteSecret(service.id, deleting))} onClose={() => setDeleting(null)}>
          <code>{deleting}</code> 변수를 삭제합니다. 값은 복구할 수 없어서 다시 쓰려면 파일을 다시 올려야 합니다.
        </ConfirmModal>
      )}
      {pendingEnc &&<PassphraseModal title="암호화 파일 열기" confirm="가져오기" onClose={() => setPendingEnc(null)} onSubmit={(p) => importText(pendingEnc, p)} />}
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
            downloadText(`${safeFileName(service.name)}.enc`, text);
            setExporting(false);
          }}
        />
      )}
    </section>
  );
}
