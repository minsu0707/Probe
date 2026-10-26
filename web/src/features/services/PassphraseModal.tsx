import { useState } from 'react';
import { Modal } from '../../ui/index.ts';

/** Asks for a passphrase, twice when it will protect a new file (so a typo can't lock the user out). */
export function PassphraseModal({ title, confirm, hint, confirmTwice, onClose, onSubmit }: { title: string; confirm: string; hint?: string; confirmTwice?: boolean; onClose: () => void; onSubmit: (passphrase: string) => Promise<void> }) {
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirmTwice && p2 !== '' && p !== p2;

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (confirmTwice && p !== p2) return;
          setBusy(true);
          await onSubmit(p);
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="pp">암호</label>
          <input id="pp" type="password" autoFocus value={p} onChange={(e) => setP(e.target.value)} autoComplete="off" required />
          {hint && <span className="hint">{hint}</span>}
        </div>
        {confirmTwice && (
          <div className="field">
            <label htmlFor="pp2">암호 확인</label>
            <input id="pp2" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="off" required aria-invalid={mismatch} />
            {mismatch && <span className="hint hint-bad">암호가 일치하지 않습니다</span>}
          </div>
        )}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !p || (confirmTwice && p !== p2)}>
            {confirm}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
