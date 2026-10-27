import type { ReactNode } from 'react';

/**
 * Settings are read as a list of rows: what it is and one line about it on the left, the control
 * or the current value on the right. A group is a titled box of such rows.
 */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h2>{title}</h2>}
      <div className="set-rows">{children}</div>
    </section>
  );
}

export function Row({ title, desc, children }: { title: string; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      {children && <div className="set-ctl">{children}</div>}
    </div>
  );
}
