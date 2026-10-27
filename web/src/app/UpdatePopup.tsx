import { useState } from 'react';
import { installUpdate, useUpdateState } from '../core/desktop.ts';
import { attempt } from '../core/store.ts';

/** Bottom-right card when a new version is downloaded: one click installs it. "나중에" hides it for that version until the next launch. */
export function UpdatePopup() {
  const update = useUpdateState();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (update?.phase !== 'ready' || dismissed === update.version) return null;

  return (
    <div className="update-popup" role="alertdialog" aria-label="새 버전 업데이트">
      <strong>새 버전 {update.version}</strong>
      <p>
        지금 {update.currentVersion}을(를) 쓰고 있습니다. 업데이트하면 앱이 다시 시작됩니다. 진행 중인 작업은 끝난 뒤에 하세요.
      </p>
      <div className="actions">
        <button className="btn btn-primary btn-sm" onClick={() => void attempt(async () => installUpdate())}>
          업데이트
        </button>
        <button className="btn btn-sm" onClick={() => setDismissed(update.version)}>
          나중에
        </button>
      </div>
    </div>
  );
}
