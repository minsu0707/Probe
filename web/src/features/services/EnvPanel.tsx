import { useEffect, useState } from 'react';
import { api, type SecretMeta, type ServiceOverview } from '../../core/api.ts';
import { attempt, toast, useStore } from '../../core/store.ts';
import { FileDrop, Icon } from '../../ui/index.ts';
import { downloadText, looksEncrypted, safeFileName } from './envFile.ts';
import { PassphraseModal } from './PassphraseModal.tsx';

/** A service's environment variables: import from .env/.enc, list (values masked), delete, export. */
export function EnvPanel({ service }: { service: ServiceOverview }) {
  const version = useStore((s) => s.serviceVersion[service.id] ?? 0);
  const [keys, setKeys] = useState<SecretMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** Text of an .enc file waiting for its passphrase. */
  const [pendingEnc, setPendingEnc] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Refetch when the server says this service changed (version bump) or the selection changes.
  useEffect(() => {
    let alive = true;
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

      {pendingEnc && <PassphraseModal title="암호화 파일 열기" confirm="가져오기" onClose={() => setPendingEnc(null)} onSubmit={(p) => importText(pendingEnc, p)} />}
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
