import { useEffect, useState } from 'react';
import type { RunSummary } from '../../core/api.ts';
import { useStore } from '../../core/store.ts';
import { Pill } from '../../ui/index.ts';

/**
 * 브라우저 화면: the latest frame of the test browser. The server announces each new frame
 * over the WebSocket; changing the `t` query makes the browser fetch it again.
 */
export function LiveFrame({ run, live }: { run: RunSummary; live: boolean }) {
  const tick = useStore((s) => s.frameTick[run.id]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [tick]);
  const showing = live && tick && !failed;

  return (
    <section className="panel frame-panel">
      <div className="panel-head">
        <h2>브라우저 화면</h2>
        {showing && (
          <Pill tone="run" dot>
            라이브
          </Pill>
        )}
      </div>
      <div className="frame">
        {showing ? (
          <img src={`/api/runs/${run.id}/live.jpg?t=${tick}`} alt="테스트 브라우저의 현재 화면" onError={() => setFailed(true)} />
        ) : (
          <div className="frame-empty muted small">{live ? '첫 화면을 기다리는 중…' : '실행이 끝나서 라이브 화면이 없습니다. 실패한 테스트의 화면은 결과 · 결함에서 볼 수 있습니다.'}</div>
        )}
      </div>
    </section>
  );
}
