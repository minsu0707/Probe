import { useState, type ReactNode } from 'react';
import { Modal } from './Modal.tsx';

/** Asks before something is deleted. `onConfirm` does the work; the modal closes when it finishes. */
export function ConfirmModal({ title, children, confirm = '삭제', onConfirm, onClose }: { title: string; children: ReactNode; confirm?: string; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p className="muted">{children}</p>
        <div className="actions">
          <button
            className="btn btn-danger"
            disabled={busy}
            autoFocus
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              onClose();
            }}
          >
            {confirm}
          </button>
          <button className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </Modal>
  );
}
