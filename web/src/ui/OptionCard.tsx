import type { ReactNode } from 'react';

/**
 * One on/off setting as a plain row: title and a sentence on the left, a switch on the right. It is
 * a real checkbox underneath (announced as a switch), so the keyboard and screen readers behave as
 * they do for any checkbox.
 */
export function OptionRow({ title, desc, checked, disabled, onChange }: { title: string; desc: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`option-row${disabled ? ' is-disabled' : ''}`}>
      <span className="option-text">
        <strong>{title}</strong>
        <span className="muted small">{desc}</span>
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
