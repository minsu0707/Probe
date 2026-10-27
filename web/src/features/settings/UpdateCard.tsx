import { useState } from 'react';
import { checkForUpdate, installUpdate, useUpdateState } from '../../core/desktop.ts';
import { attempt } from '../../core/store.ts';
import { Row } from './Rows.tsx';

const when = (ts: number) => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** Version and updates of the installed app. A browser or a source run has nothing to update, and says so. */
export function UpdateRows({ version }: { version: string | undefined }) {
  const update = useUpdateState();
  const [busy, setBusy] = useState(false);

  const current = update?.currentVersion ?? version ?? '…';

  if (!update || update.phase === 'unsupported') {
    return <Row title="버전" desc="설치한 앱에서만 자동 업데이트가 동작합니다. 소스로 실행 중이면 git pull 뒤 다시 실행하세요."><span className="set-val">{current}</span></Row>;
  }

  const line =
    update.phase === 'installing' ? `${update.version} 설치 중` :
    update.phase === 'ready' ? `${update.version} 준비됨` :
    update.phase === 'downloading' ? `${update.version} 내려받는 중` :
    update.phase === 'checking' ? '확인 중…' :
    update.phase === 'error' ? `확인 실패: ${update.message}` :
    update.checkedAt ? `최신 버전 · ${when(update.checkedAt)} 확인` : '아직 확인 전';

  return (
    <Row title={`버전 ${current}`} desc={<>{line}. 작업이 없고 창이 앞에 없을 때 저절로 설치합니다.</>}>
      {update.phase === 'ready' ? (
        <button className="btn btn-primary" onClick={() => void attempt(async () => installUpdate())}>
          재시작해서 설치
        </button>
      ) : (
        <button
          className="btn"
          disabled={busy || update.phase === 'checking' || update.phase === 'downloading' || update.phase === 'installing'}
          onClick={async () => {
            setBusy(true);
            await attempt(async () => checkForUpdate());
            setBusy(false);
          }}
        >
          지금 확인
        </button>
      )}
    </Row>
  );
}
