export interface Section {
  title: string;
  /** Markdown below the heading, up to the next heading of the same level. */
  body: string;
}

export interface SplitDoc {
  /** Everything before the first section: the document title and its lead-in. */
  intro: string;
  sections: Section[];
}

const HEADING = /^(#{1,4})\s+(.*)$/;

/** Heading text without Markdown decoration, for a one-line summary. */
export function plainTitle(raw: string): string {
  return raw.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
}

/**
 * Cuts a knowledge file into foldable sections at its main heading level: the shallowest level
 * that occurs at least twice (a lone "#" title above many "##" flows stays in the intro).
 * Returns null when there is nothing worth folding.
 */
export function splitSections(source: string): SplitDoc | null {
  const lines = source.split(/\r?\n/);
  const heads: { at: number; level: number; title: string }[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && HEADING.exec(line);
    if (m) heads.push({ at, level: m[1].length, title: m[2] });
  });

  const counts = new Map<number, number>();
  for (const h of heads) counts.set(h.level, (counts.get(h.level) ?? 0) + 1);
  const level = [...counts.keys()].sort((a, b) => a - b).find((l) => (counts.get(l) ?? 0) >= 2);
  if (level === undefined || (counts.get(level) ?? 0) < 3) return null;

  // A heading shallower than the section level closes the section before it.
  const cuts = heads.filter((h) => h.level <= level);
  const first = cuts.find((h) => h.level === level)!;
  const sections: Section[] = [];
  cuts.forEach((h, i) => {
    if (h.level !== level) return;
    const end = cuts[i + 1]?.at ?? lines.length;
    sections.push({ title: h.title, body: lines.slice(h.at + 1, end).join('\n').trim() });
  });
  return { intro: lines.slice(0, first.at).join('\n').trim(), sections };
}
