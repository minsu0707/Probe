import { useEffect, useRef, type ReactNode } from 'react';

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; hint?: string; onSelect: () => void };

/** A right-click menu at the pointer. Closes on a click elsewhere, Escape, scroll or resize. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      // Keep the menu inside the window when opened near an edge.
      el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4))}px`;
      el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4))}px`;
      el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', away, true);
    window.addEventListener('contextmenu', away, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('contextmenu', away, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [x, y, onClose]);

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: x, top: y }}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={`ctx-item${it.danger ? ' ctx-danger' : ''}`}
          disabled={it.disabled}
          title={it.disabled ? it.hint : undefined}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
