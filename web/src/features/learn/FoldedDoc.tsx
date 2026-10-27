import { useMemo, useState } from 'react';
import { Icon, Markdown } from '../../ui/index.ts';
import { plainTitle, splitSections } from './sections.ts';

/**
 * A long knowledge file as a list of foldable sections, so the page shows an outline first and
 * the reader opens only what they need. Short files render as plain Markdown.
 */
export function FoldedDoc({ source }: { source: string }) {
  const doc = useMemo(() => splitSections(source), [source]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [query, setQuery] = useState('');

  if (!doc) return <Markdown source={source} />;

  const q = query.trim().toLowerCase();
  const shown = doc.sections.map((s, i) => ({ s, i })).filter(({ s }) => !q || `${s.title}\n${s.body}`.toLowerCase().includes(q));
  const allOpen = shown.length > 0 && shown.every(({ i }) => open.has(i));
  const toggle = (i: number, on: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <div className="fold">
      {doc.intro && <Markdown source={doc.intro} />}
      <div className="fold-bar">
        <input type="search" aria-label="섹션 검색" placeholder={`${doc.sections.length}개 섹션에서 찾기`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-quiet btn-sm" onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map(({ i }) => i)))} disabled={!shown.length}>
          {allOpen ? '모두 접기' : '모두 펼치기'}
        </button>
      </div>
      {shown.length === 0 && <p className="muted small">검색 결과가 없습니다.</p>}
      {shown.map(({ s, i }) => {
        // A search opens its matches so the hit is visible without another click.
        const isOpen = open.has(i) || Boolean(q);
        return (
          <details key={i} className="fold-item" open={isOpen} onToggle={(e) => !q && toggle(i, e.currentTarget.open)}>
            <summary>
              <Icon name="chevron" size={14} />
              <span>{plainTitle(s.title)}</span>
            </summary>
            {isOpen && <Markdown source={s.body} />}
          </details>
        );
      })}
    </div>
  );
}
