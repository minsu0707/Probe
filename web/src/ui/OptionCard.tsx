import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

/**
 * An on/off setting shown as a card: an icon, a short title and summary, a switch on the right,
 * and the long explanation folded away until asked for. It is a real checkbox underneath
 * (announced as a switch), so the keyboard and screen readers behave as they do for any checkbox.
 */
export function OptionCard({ icon, title, summary, details, checked, disabled, onChange }: { icon: IconName; title: string; summary: ReactNode; details?: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={`option-card${checked ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
      <label className="option-main">
        <span className="option-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <span className="option-text">
          <strong>{title}</strong>
          <span className="muted small">{summary}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {details && (
        <details className="option-details">
          <summary>자세히 보기</summary>
          <p className="muted small">{details}</p>
        </details>
      )}
    </div>
  );
}
