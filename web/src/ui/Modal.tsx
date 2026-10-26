import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * A modal built on the native <dialog>: focus trapping, Escape to close and the backdrop come
 * from the browser. `onClose` fires for every way of closing (button, Escape, backdrop click).
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="modal-body">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-quiet btn-icon" onClick={() => ref.current?.close()} aria-label="닫기">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
