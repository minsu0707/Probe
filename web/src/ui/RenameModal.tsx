import { useState } from 'react';
import { Modal } from './Modal.tsx';

/** Asks for a new name. `onSave` does the work; the modal closes when it finishes. */
export function RenameModal({ title, value, onSave, onClose }: { title: string; value: string; onSave: (name: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(value);
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0 && name.trim() !== value;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    await onSave(name.trim());
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input type="text" value={name} maxLength={120} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} aria-label="새 이름" />
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={!ok || busy}>
            저장
          </button>
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
