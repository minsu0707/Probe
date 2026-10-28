import { useEffect, useState } from 'react';
import { checkForUpdate, getAutoInstall, installUpdate, setAutoInstall, useUpdateState } from '../../core/desktop.ts';
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
    <Row title={`버전 ${current}`} desc={<>
      {line}
      <br />새 버전은 내려받아 두고, 설치는 자동 설치 설정에 따릅니다.
    </>}>
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

/** Off by default: the new version waits for the user's click. */
export function AutoInstallRow() {
  const update = useUpdateState();
  const [auto, setAuto] = useState(false);
  useEffect(() => void getAutoInstall()?.then(setAuto), []);
  if (!update || update.phase === 'unsupported') return null;
  return (
    <Row title="자동 설치" desc="켜면 새 버전을 받은 뒤, 작업이 없고 창이 앞에 없을 때 저절로 설치하고 다시 시작합니다. 끄면 업데이트 버튼을 눌렀을 때만 설치합니다.">
      <label className="case-check">
        <input type="checkbox" checked={auto} onChange={(e) => void setAutoInstall(e.target.checked)?.then(setAuto)} />
        <span>{auto ? '켜짐' : '꺼짐'}</span>
      </label>
    </Row>
  );
}
