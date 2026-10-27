import { useState } from 'react';
import { checkForUpdate, installUpdate, useUpdateState } from '../../core/desktop.ts';
import { attempt } from '../../core/store.ts';
import { Pill } from '../../ui/index.ts';

const when = (ts: number) => new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** The installed app's version and its updates. In a browser or a source run it only explains why there are none. */
export function UpdateCard({ version }: { version: string | undefined }) {
  const update = useUpdateState();
  const [busy, setBusy] = useState(false);

  const status = !update ? null : update.phase === 'ready' ? (
    <Pill tone="pass">새 버전 {update.version} 준비됨</Pill>
  ) : update.phase === 'downloading' ? (
    <Pill tone="run" dot>
      {update.version} 내려받는 중
    </Pill>
  ) : update.phase === 'checking' ? (
    <Pill tone="run" dot>
      확인 중
    </Pill>
  ) : update.phase === 'error' ? (
    <Pill tone="warn">확인 실패</Pill>
  ) : update.phase === 'idle' ? (
    <Pill>{update.checkedAt ? '최신 버전' : '아직 확인 전'}</Pill>
  ) : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>업데이트</h2>
        {status}
      </div>
      <dl className="facts">
        <dt>현재 버전</dt>
        <dd>{update?.currentVersion ?? version ?? '…'}</dd>
        {update?.phase === 'idle' && update.checkedAt && (
          <>
            <dt>마지막 확인</dt>
            <dd>{when(update.checkedAt)}</dd>
          </>
        )}
      </dl>

      {!update ? (
        <p className="muted small">자동 업데이트는 설치한 Probe 앱에서만 동작합니다. 브라우저로 열었거나 소스에서 실행한 경우에는 <code>git pull</code> 후 다시 실행하면 최신 코드가 됩니다.</p>
      ) : update.phase === 'unsupported' ? (
        <p className="muted small">개발용으로 실행 중이라 자동 업데이트를 쓰지 않습니다. 설치한 앱에서는 새 버전이 나오면 백그라운드로 내려받습니다.</p>
      ) : (
        <>
          <p className="muted small">새 버전은 앱을 켠 뒤와 6시간마다 확인해서 백그라운드로 내려받고, 작업(테스트 실행, 학습, Claude 세션)이 없고 Probe 창이 앞에 있지 않을 때 저절로 재시작해서 설치합니다. 지금 바로 설치하려면 아래 버튼을 누르세요. 서비스와 로그인 정보는 그대로 유지됩니다.</p>
          {update.phase === 'error' && <p className="muted small">{update.message}</p>}
          <div className="actions">
            {update.phase === 'ready' ? (
              <button className="btn btn-primary" onClick={() => void attempt(async () => installUpdate())}>
                재시작해서 {update.version} 설치
              </button>
            ) : (
              <button
                className="btn"
                disabled={busy || update.phase === 'checking' || update.phase === 'downloading'}
                onClick={async () => {
                  setBusy(true);
                  await attempt(async () => checkForUpdate());
                  setBusy(false);
                }}
              >
                지금 확인
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
